// Slow streaming gateway so a mid-stream abort can be exercised.
import http from "node:http";
const PORT = Number(process.argv[2] ?? 20130);
const KEY = "sk_omniroute_test";
http.createServer(async (req, res) => {
  if ((req.headers.authorization ?? "") !== `Bearer ${KEY}`) {
    res.writeHead(401); res.end(JSON.stringify({error:{message:"bad key"}})); return;
  }
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({data:[{id:"slow-model"}]})); return;
  }
  if (req.url?.endsWith("/chat/completions")) {
    res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform"});
    for (let i = 0; i < 40; i++) {
      res.write(`data: ${JSON.stringify({choices:[{delta:{content:`TOKEN${i} `}}]})}\n\n`);
      await new Promise(r => setTimeout(r, 300));
    }
    res.write("data: [DONE]\n\n"); res.end(); return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log("slow gateway on " + PORT));
