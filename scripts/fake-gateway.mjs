/**
 * Minimal OpenAI-compatible gateway for local verification.
 * Mimics OmniRoute: /v1/models and a streaming /v1/chat/completions.
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 20128);
const VALID_KEY = "sk_omniroute_test";

const server = http.createServer(async (req, res) => {
  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${VALID_KEY}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    return;
  }

  if (req.url?.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: [{ id: "claude-sonnet-4.5" }, { id: "gpt-5.2" }],
      }),
    );
    return;
  }

  if (req.url?.endsWith("/chat/completions")) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });
    const words = "Streaming works end to end from the gateway.".split(" ");
    for (const word of words) {
      res.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: word + " " } }],
        })}\n\n`,
      );
      await new Promise((r) => setTimeout(r, 40));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`fake gateway on ${PORT}`));
