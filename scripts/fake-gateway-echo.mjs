/**
 * Mock gateway that echoes the request's system message back as its answer.
 *
 * That makes prompt assembly directly observable: if a memory was injected,
 * the saved assistant reply literally contains it. Absence is just as readable,
 * which is what the clean-room and isolation assertions rely on.
 *
 * A request that looks like the memory extractor gets "null" back, so the
 * post-turn suggestion pass costs nothing and proposes nothing.
 *
 * Usage: node scripts/fake-gateway-echo.mjs [port]
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 20140);
const VALID_KEY = "sk_omniroute_test";

http
  .createServer(async (req, res) => {
    if ((req.headers.authorization ?? "") !== `Bearer ${VALID_KEY}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }

    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "echo-model" }] }));
      return;
    }

    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw));
    });

    const parsed = JSON.parse(body);
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const system = messages.find((m) => m && m.role === "system")?.content;

    // The extraction prompt asks for JSON; answer it honestly with "nothing".
    const isExtraction =
      typeof system === "string" && system.includes("Extract at most ONE fact");

    const content = isExtraction
      ? "null"
      : typeof system === "string" && system.length > 0
        ? system
        : "(no system message)";

    const stream = parsed.stream !== false;

    res.writeHead(200, {
      "Content-Type": stream
        ? "text/event-stream"
        : "application/json",
      "Cache-Control": "no-cache, no-transform",
    });

    if (!stream) {
      res.end(
        JSON.stringify({
          id: "chatcmpl-echo",
          object: "chat.completion",
          model: "echo-model",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content },
            },
          ],
        }),
      );
      return;
    }

    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    // Chunk it so the client exercises its own framing.
    for (let i = 0; i < content.length; i += 40) {
      send({
        choices: [{ delta: { content: content.slice(i, i + 40) } }],
      });
    }
    send({ choices: [{ delta: {}, finish_reason: "stop" }] });
    res.write("data: [DONE]\n\n");
    res.end();
  })
  .listen(PORT, () => console.log(`echo gateway on ${PORT}`));
