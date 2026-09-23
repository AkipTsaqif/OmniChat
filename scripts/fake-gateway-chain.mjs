/**
 * Mock gateway that exercises TOOL-CALL CHAINING.
 *
 * mode "chain" (default): the turn asks for a second tool call after getting
 *   results, then answers. Guards against the follow-up's tool_calls being
 *   dropped — the bug where the model announced "let me check the FAQ" and the
 *   turn ended mid-thought.
 *
 * mode "loop": every response is another tool call and it never answers, so the
 *   route's round cap and its error message can be asserted.
 *
 * Usage: node scripts/fake-gateway-chain.mjs [port] [chain|loop]
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 20134);
const MODE = (process.argv[3] ?? "chain").toLowerCase();
const VALID_KEY = "sk_omniroute_test";

let followUps = 0;

const toolCall = (id, name, args) => ({
  choices: [
    {
      delta: {
        tool_calls: [
          { index: 0, id, function: { name, arguments: args } },
        ],
      },
    },
  ],
});
const text = (t) => ({ choices: [{ delta: { content: t } }] });

http
  .createServer(async (req, res) => {
    // /faq is a public page for fetch_page to read — it is not a gateway API
    // call, so it must not sit behind the gateway key.
    const isPublicPage = req.url?.endsWith("/faq");

    if (
      !isPublicPage &&
      (req.headers.authorization ?? "") !== `Bearer ${VALID_KEY}`
    ) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }

    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "chain-model" }] }));
      return;
    }

    // A real page for fetch_page to read — this is what makes the chain test
    // cover the page-reading tool end to end rather than just its extractor.
    if (req.url?.endsWith("/faq")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<html><head><title>Syarat &amp; Ketentuan</title></head><body>" +
          "<script>ignore()</script><h1>Syarat &amp; Ketentuan</h1>" +
          "<p>Pembelian 80 tiket tidak membatasi pembelian on the spot.</p>" +
          "</body></html>",
      );
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

    // A follow-up is either the tool round trip (role:"tool") or the flattened
    // fallback that inlines results as text. Both count as "tools were run".
    const isFollowUp =
      body.includes('"role":"tool"') || body.includes("Web search results:");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

    if (!isFollowUp) {
      // Turn opens with a tool call and no preamble.
      send(toolCall("call_1", "web_search", '{"query":"booking faq"}'));
    } else if (MODE === "loop") {
      // Never answers — only ever asks for another tool.
      followUps++;
      send(toolCall(`call_loop_${followUps}`, "web_search", '{"query":"more"}'));
    } else {
      followUps++;
      if (followUps === 1) {
        // Interim note + a SECOND tool call — this time reading a page, which
        // is what the model was trying to do when the turn used to die.
        send(text("Checking the FAQ first. "));
        send(
          toolCall(
            "call_2",
            "fetch_page",
            JSON.stringify({ url: `http://localhost:${PORT}/faq` }),
          ),
        );
      } else {
        send(text("FINAL-"));
        send(text("ANSWER-"));
        send(text("ROUND2"));
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  })
  .listen(PORT, () =>
    console.log(`chain gateway on ${PORT} (mode=${MODE})`),
  );
