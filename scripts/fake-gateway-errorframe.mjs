// Reproduces a gateway that answers 200, streams keep-alives, then reports the
// real failure as an in-band `data: {"error":...}` frame (observed on OmniRoute).
import http from "node:http";
const PORT = Number(process.argv[2] ?? 20131);
const KEY = "sk_omniroute_test";
http.createServer(async (req, res) => {
  if ((req.headers.authorization ?? "") !== `Bearer ${KEY}`) {
    res.writeHead(401); res.end(JSON.stringify({error:{message:"bad key"}})); return;
  }
  if (req.url?.endsWith("/models")) {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({data:[{id:"broken-model"}]})); return;
  }
  if (req.url?.endsWith("/chat/completions")) {
    res.writeHead(200, {"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform"});
    for (let i = 0; i < 3; i++) {
      res.write(`data: ${JSON.stringify({id:"chatcmpl-keepalive",choices:[{index:0,delta:{},finish_reason:null}]})}\n\n`);
      await new Promise(r => setTimeout(r, 80));
    }
    res.write(`data: ${JSON.stringify({error:{message:"upstream provider exhausted: PROVIDER_POOL_EMPTY",type:"server_error",code:"bad_gateway"}})}\n\n`);
    res.end(); return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log("error-frame gateway on " + PORT));
