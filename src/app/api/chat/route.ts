import { and, asc, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { conversations, messages, providerSettings, users } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { searchWeb } from "@/lib/tools/web-search";
import type { SearchResult, ToolCallInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  conversationId: string;
  modelId: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  webSearch?: boolean;
};

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current events, real-time data, fresh documentation, news, facts, scores, or weather. Call this automatically whenever fresh or external information is needed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Specific search query keywords",
        },
      },
      required: ["query"],
    },
  },
};

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** An error the gateway reported inside the SSE body rather than via status. */
class GatewayStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayStreamError";
  }
}

async function readSseStream(
  upstream: Response,
  onDelta: (delta: string) => void,
  onToolCallDelta: (tc: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }) => void,
) {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload);

          // Gateways may answer 200, stream keep-alives, then report the real
          // failure as an error frame inside the body. Surface it instead of
          // letting the stream finish empty.
          if (json.error) {
            const reason =
              typeof json.error === "string"
                ? json.error
                : json.error.message || "The gateway reported an error.";
            throw new GatewayStreamError(String(reason));
          }

          const choice = json.choices?.[0];
          const delta = choice?.delta;

          if (typeof delta?.content === "string" && delta.content) {
            onDelta(delta.content);
          }

          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              onToolCallDelta(tc);
            }
          }
        } catch (error) {
          // Re-throw real gateway errors; ignore keep-alives and partial frames.
          if (error instanceof GatewayStreamError) throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  const { conversationId, modelId, thinkingLevel, webSearch } =
    (await request.json()) as Body;

  const [settings] = await db
    .select()
    .from(providerSettings)
    .where(eq(providerSettings.userId, userId))
    .limit(1);

  if (!settings) {
    return new Response("No provider configured", { status: 428 });
  }

  // Confirm ownership before reading the transcript.
  const [conversation] = await db
    .select({
      id: conversations.id,
      systemPrompt: conversations.systemPrompt,
    })
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    )
    .limit(1);

  if (!conversation) return new Response("Not found", { status: 404 });

  let activeSystemPrompt = conversation.systemPrompt;
  if (!activeSystemPrompt) {
    const [user] = await db
      .select({ systemPrompt: users.systemPrompt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    activeSystemPrompt = user?.systemPrompt ?? null;
  }

  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  const promptMessages: { role: string; content: string }[] = [];
  if (activeSystemPrompt && activeSystemPrompt.trim()) {
    promptMessages.push({
      role: "system",
      content: activeSystemPrompt.trim(),
    });
  }
  for (const m of history) {
    promptMessages.push({ role: m.role, content: m.content });
  }

  const started = Date.now();

  const requestPayload: Record<string, unknown> = {
    model: modelId,
    messages: promptMessages,
    stream: true,
  };

  // Enable web search tools by default unless explicitly turned off
  if (webSearch !== false) {
    requestPayload.tools = [WEB_SEARCH_TOOL];
  }

  if (thinkingLevel && thinkingLevel !== "off") {
    requestPayload.reasoning_effort = thinkingLevel;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${decryptSecret(settings.apiKeyCipher)}`,
      },
      body: JSON.stringify(requestPayload),
      signal: request.signal,
    });
  } catch {
    return new Response("Could not reach the gateway", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(detail || "Gateway error", {
      status: upstream.status || 502,
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let full = "";
      const savedToolCalls: ToolCallInfo[] = [];

      // Persist whatever was streamed so a stop/disconnect still leaves the
      // assistant turn in the transcript instead of a question with no answer.
      const persist = async () => {
        if (!full.trim()) return null;
        const [row] = await db
          .insert(messages)
          .values({
            conversationId,
            role: "assistant",
            content: full,
            modelId,
            toolCalls: savedToolCalls.length > 0 ? savedToolCalls : null,
            latencyMs: Date.now() - started,
          })
          .returning({ id: messages.id });

        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, conversationId));

        return row;
      };

      const toolCallsAccumulator: Record<
        number,
        { id: string; name: string; arguments: string }
      > = {};

      try {
        await readSseStream(
          upstream,
          (delta) => {
            full += delta;
            controller.enqueue(encoder.encode(sse("delta", { delta })));
          },
          (tc) => {
            const idx = tc.index ?? 0;
            if (!toolCallsAccumulator[idx]) {
              toolCallsAccumulator[idx] = {
                id: tc.id || `call_${Date.now()}_${idx}`,
                name: "",
                arguments: "",
              };
            }
            if (tc.id) toolCallsAccumulator[idx].id = tc.id;
            if (tc.function?.name) toolCallsAccumulator[idx].name += tc.function.name;
            if (tc.function?.arguments)
              toolCallsAccumulator[idx].arguments += tc.function.arguments;
          },
        );

        const toolCalls = Object.values(toolCallsAccumulator);

        // If the model requested tool execution (e.g. web search):
        if (toolCalls.length > 0) {
          const toolResultsForGateway: {
            role: "tool";
            tool_call_id: string;
            content: string;
          }[] = [];

          for (const tc of toolCalls) {
            let query = "";
            try {
              const parsed = JSON.parse(tc.arguments);
              query = parsed.query || parsed.q || parsed.search || "";
            } catch {
              query = tc.arguments.replace(/["{}:]/g, "").trim();
            }

            // 1. Notify frontend: live tool execution started
            controller.enqueue(
              encoder.encode(
                sse("tool_start", {
                  id: tc.id,
                  name: tc.name,
                  query,
                  state: "running",
                }),
              ),
            );

            // 2. Perform the web search
            let results: SearchResult[] = [];
            if (tc.name === "web_search" || tc.name.includes("search")) {
              results = await searchWeb(query);
            }

            // 3. Notify frontend: tool results ready
            controller.enqueue(
              encoder.encode(
                sse("tool_done", {
                  id: tc.id,
                  name: tc.name,
                  query,
                  state: "done",
                  results,
                }),
              ),
            );

            const toolContent =
              results.length > 0
                ? JSON.stringify(
                    results.map((r) => ({
                      title: r.title,
                      url: r.url,
                      snippet: r.snippet,
                    })),
                  )
                : "No live web search results were found for this query. Please answer the user's prompt directly based on your knowledge.";

            savedToolCalls.push({
              id: tc.id,
              name: tc.name,
              query,
              state: "done",
              results,
            });

            toolResultsForGateway.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolContent,
            });
          }

          // Any text streamed before the tool call is a preamble ("let me look
          // that up"). Keep it for the gateway's context, but restart `full` so
          // it is not concatenated onto the final answer in the saved message.
          const preamble = full;
          full = "";

          // 4. Send follow-up request to the gateway to generate final answer using tool output
          const followUpPayload: Record<string, unknown> = {
            model: modelId,
            messages: [
              ...promptMessages,
              {
                role: "assistant",
                content: preamble || null,
                tool_calls: toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: {
                    name: tc.name,
                    arguments: tc.arguments,
                  },
                })),
              },
              ...toolResultsForGateway,
            ],
            stream: true,
          };

          if (thinkingLevel && thinkingLevel !== "off") {
            followUpPayload.reasoning_effort = thinkingLevel;
          }

          const followUpUpstream = await fetch(
            `${settings.baseUrl}/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${decryptSecret(settings.apiKeyCipher)}`,
              },
              body: JSON.stringify(followUpPayload),
              signal: request.signal,
            },
          );

          if (!followUpUpstream.ok || !followUpUpstream.body) {
            const errDetail = await followUpUpstream.text().catch(() => "");
            throw new Error(
              errDetail ||
                `Gateway error on tool follow-up ${followUpUpstream.status}`,
            );
          }

          await readSseStream(
            followUpUpstream,
            (delta) => {
              full += delta;
              controller.enqueue(encoder.encode(sse("delta", { delta })));
            },
            () => {},
          );
        }

        if (!full.trim()) {
          throw new Error(
            `${modelId} returned an empty response. The model may be unavailable on your gateway — try a different one.`,
          );
        }

        // Persist once the complete reply and any tool calls are known.
        const saved = await persist();

        controller.enqueue(
          encoder.encode(
            sse("done", {
              id: saved?.id,
              content: full,
              toolCalls: savedToolCalls,
            }),
          ),
        );
      } catch (error) {
        // An abort is the user pressing stop — keep the partial reply rather
        // than discarding work the model already produced. A gateway failure
        // reported mid-stream is NOT an abort, so check the error itself and
        // never let a real reason be reported as "interrupted".
        const isGatewayError = error instanceof GatewayStreamError;
        const aborted =
          !isGatewayError &&
          ((error instanceof Error && error.name === "AbortError") ||
            request.signal.aborted);

        try {
          const saved = await persist();
          if (saved) {
            controller.enqueue(
              encoder.encode(
                sse("done", {
                  id: saved.id,
                  content: full,
                  toolCalls: savedToolCalls,
                  stopped: aborted,
                }),
              ),
            );
          }
        } catch {
          // Saving the partial reply is best-effort.
        }

        if (!aborted) {
          controller.enqueue(
            encoder.encode(
              sse("error", {
                message:
                  error instanceof Error ? error.message : "Stream failed",
              }),
            ),
          );
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed when the client disconnected.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
