/**
 * Reproduces a gateway whose tool FOLLOW-UP intermittently returns empty
 * (observed on Sonnet via OmniRoute). Fails the first N follow-ups, then
 * succeeds — so a retry should recover.
 *
 * Usage: node scripts/fake-gateway-flaky.mjs [port] [failCount]
 */
import http from "node:http";
const PORT = Number(process.argv[2] ?? 20132);
const FAIL_TIMES = Number(process.argv[3] ?? 2);
const KEY = "sk_omniroute_test";
let followUps = 0;

http.createServer(async (req, res) => {
  if ((req.headers.authorization ?? "") !== `Bearer ${KEY}`) {
    res.writeHead(401); res.end(JSON.stringify({error:{message:"bad key"}})); return;
  }
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({data:[{id:"flaky-sonnet"}]})); return;
  }
  if (req.url?.endsWith("/chat/completions")) {
    const body = await new Promise(r => { let s=""; req.on("data",c=>s+=c); req.on("end",()=>r(s)); });
    const isFollowUp = body.includes('"role":"tool"');
    res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform"});
    const send = o => res.write(`data: ${JSON.stringify(o)}\n\n`);

    if (!isFollowUp) {
      send({ choices:[{ delta:{ tool_calls:[{ index:0, id:"toolu_flaky", function:{ name:"web_search", arguments:'{"query":"indonesia news"}' } }] } }] });
    } else {
      followUps++;
      if (followUps <= FAIL_TIMES) {
        // Empty content, reported the way the real gateway does.
        send({ error: { message: "Provider returned empty content" } });
      } else {
        for (const w of ["RECOVERED", "-", "ANSWER"]) { send({ choices:[{ delta:{ content:w } }] }); await new Promise(r=>setTimeout(r,15)); }
      }
    }
    res.write("data: [DONE]\n\n"); res.end(); return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`flaky gateway on ${PORT} (fails first ${FAIL_TIMES} follow-ups)`));
