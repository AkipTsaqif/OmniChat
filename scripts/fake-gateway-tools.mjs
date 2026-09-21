/**
 * Mock OpenAI-compatible gateway that exercises the two-pass tool-calling path.
 * Pass 1: emits a short preamble, then a web_search tool call.
 * Pass 2 (request containing role:"tool"): emits the final answer.
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 20129);
const VALID_KEY = "sk_omniroute_test";

const server = http.createServer(async (req, res) => {
  if ((req.headers.authorization ?? "") !== `Bearer ${VALID_KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    return;
  }

  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "tool-model" }] }));
    return;
  }

  if (req.url?.endsWith("/chat/completions")) {
    const body = await new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => resolve(raw));
    });

    const isFollowUp = body.includes('"role":"tool"');

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });

    const send = (obj) =>
      res.write(`data: ${JSON.stringify(obj)}\n\n`);

    if (!isFollowUp) {
      // Preamble the model says before deciding to search.
      for (const w of ["Let ", "me ", "look ", "that ", "up. "]) {
        send({ choices: [{ delta: { content: w } }] });
        await new Promise((r) => setTimeout(r, 15));
      }
      // Then the tool call.
      send({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_abc",
                  function: { name: "web_search", arguments: '{"query":"x"}' },
                },
              ],
            },
          },
        ],
      });
    } else {
      for (const w of ["FINAL", "-", "ANSWER"]) {
        send({ choices: [{ delta: { content: w } }] });
        await new Promise((r) => setTimeout(r, 15));
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`tool gateway on ${PORT}`));
