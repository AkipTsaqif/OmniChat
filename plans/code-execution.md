# Code execution tool (`run_code`) — handoff

Status: **sandbox built and verified; not yet wired into the app.** Everything below is
written to be picked up cold, without this conversation.

---

## Context

A real turn showed the model pasting a Python one-liner and a `curl` invocation into
the `web_search` query box — it wanted to probe a URL and had no tool for it. The
answer is a code-execution tool.

Unlike `web_search` and `fetch_page`, this is arbitrary code execution, so the
design is driven by safety first. `.env.local` sits beside the app holding
`AUTH_SECRET`, the database URL, and the encryption key for every stored provider
key. Prompt injection is a live path to this tool: `fetch_page` reads arbitrary web
pages, and the memory system replays stored prose into every future turn.

## What is done

**`src/lib/tools/run-code.ts`** — sandboxed JavaScript via `quickjs-emscripten`
(QuickJS compiled to WebAssembly). `runJavaScript(code, timeoutMs)` returns
`{ ok, output, value, error, timedOut, durationMs }`.

Verified behaviour:

| Check | Result |
| --- | --- |
| `while (true) {}` | killed at 1501ms — the interrupt handler works |
| `require('fs').readFileSync('/etc/passwd')` | `blocked: 'require' is not defined` |
| `typeof require` / `typeof process` | `undefined` / `undefined` |
| `globalThis.process.mainModule` | blocked |
| `console.log('hello', {a:1})` | captured as `hello {"a":1}` |
| last-expression value | returned as `value` |
| thrown errors | caught, message + stack, never escapes |

Guest limits: 32 MB memory cap, 512 KB stack, 2 s default timeout, 8 000-char
output cap. User code is embedded as a **JSON string literal** and `eval`'d inside a
wrapper that captures `console.*` into an array and returns it as a plain value —
no host-function bindings are exposed to the guest, which is the first thing a
hostile payload would probe.

## The security finding that shaped this

Python was considered and deliberately **not** shipped. `pyodide` was probed directly:

| Probe | Result |
| --- | --- |
| `os.listdir('.')` | `[]` — does not see the host disk |
| `open('package.json')` / `open('../.env.local')` / `open('/etc/passwd')` | all blocked |
| `urllib.request.urlopen(...)` | blocked |
| **`socket.connect(('1.1.1.1', 80))`** | **`CONNECTED` — network works** |
| **`os.system('whoami')`** | **ran it on the host and printed the username** |

So Pyodide blocks filesystem reads but `os.system` is a full escape. Hardening it
would mean stripping `os.system` / `subprocess` / `socket` / `ctypes` from the
namespace before user code runs — a denylist, not a sandbox. The decision was
**JavaScript only, with a real boundary**, rather than a weaker guarantee shipped
under the same name.

If Python is wanted later: `quickjs-emscripten` proves the WASM approach works, and
the same probe should be re-run against any candidate before trusting it. Docker
is the only route to a real Python sandbox.

## Remaining work

### 1. Tool definition and dispatch (`src/app/api/chat/route.ts`)

Add next to `WEB_SEARCH_TOOL` / `FETCH_PAGE_TOOL`:

```ts
const RUN_CODE_TOOL = {
  type: "function",
  function: {
    name: "run_code",
    description:
      "Execute a JavaScript snippet in a sandbox and return its output. Use for arithmetic, " +
      "data wrangling, formatting, or checking logic. No filesystem, network, or host access. " +
      "Return the value you want, or use console.log.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "JavaScript to run" } },
      required: ["code"],
    },
  },
};
```

Dispatch in the tool loop is currently `const isFetch = tc.name.includes("fetch")`
with everything else treated as search. That binary check must become three-way —
**match `run_code` explicitly**, keeping the existing rule that a mangled name cannot
turn `web_search` into a page read:

```ts
const isRun = /run_code|execute|eval_code/i.test(tc.name);
const isFetch = !isRun && tc.name.includes("fetch");
```

Then `await runJavaScript(subject)` and feed `{ output, value, error }` back as the
tool result. Follow the existing truthfulness rule: the tool result must say whether
code actually ran — "the snippet threw" is a different fact from "the sandbox was
unavailable", and the model must never be told something executed when it did not.

`src/lib/types.ts` needs `ToolCallInfo` extended for code (e.g. `code?: string;
output?: string`) and `scripts/fake-gateway-*.mjs` will need a mode that emits a
`run_code` call for the smoke test.

### 2. Opt-in gating

**Open question — needs a decision before building.** The chosen behaviour was
"once per turn, then auto", but tool execution happens **server-side mid-stream**, so
asking mid-turn needs a pause channel between client and server. Two options:

- **A. Composer toggle** (recommended): like the existing web-search toggle in
  `src/components/chat/composer.tsx`. Off by default, so `run_code` is not even
  offered to the model unless enabled for that chat. Opt-in *before* the turn, which
  is stronger against prompt injection — a malicious page cannot get code in front
  of you to approve mid-flow. Simpler, no IPC.
- **B. Pause-and-ask**: the model's first `run_code` in a turn returns a
  "needs approval" tool result; the client POSTs the decision; the server resumes.
  Matches the original ask but needs a request/response channel through
  `POST /api/chat`, which is currently one-way.

### 3. UI

`src/components/chat/tool-call-pill.tsx` renders `web_search` and `fetch_page`
already (search shows source + result cards; fetch shows title + excerpt). Add a
`run_code` state showing the snippet and its output in a `<pre>`, plus the `state:
"failed"` styling that already exists. The tool pill is the audit trail — the code
that ran should always be readable after the fact.

## Verification

```bash
bunx tsc --noEmit && bun run lint && bun run build
```

New `scripts/smoke-run-code.mjs` over a mock gateway that emits a `run_code` call,
asserting: (1) output reaches the saved reply, (2) an infinite loop is killed and
reported rather than hanging the turn, (3) `require('fs')` is reported as blocked
and the model is not told the code ran, (4) the pill shows the snippet.

Then the existing suite must stay green: `smoke-stream`, `smoke-tool-retry`,
`smoke-tool-chain`, `smoke-memory`, `smoke-search-parser` (7/7), `smoke-fetch-page`
(15/15).

## Traps that cost time this session

- **`/tmp/ocgw` is ephemeral.** Mock-gateway startup redirects logs there; if the
  directory is gone the gateways silently fail to launch and every smoke test fails
  for reasons that look like app bugs. `mkdir -p /tmp/ocgw` first.
- **The signup rate limiter blocks the smoke suite.** 20 signups/hour/IP in memory;
  a full suite burns through it and the test then crashes with `TypeError: Illegal
  invocation` on `#baseUrl`, which looks like a UI fault. Restart the dev server with
  `OMNICHAT_RATE_SIGNUP_IP_LIMIT=200`.
- **Cold `next dev` recompiles mid-test.** The first request after editing a server
  file triggers compilation and `smoke-stream` (8 s wait) fails spuriously. Warm it:
  `curl -s -o /dev/null http://localhost:3000/`.
- **`server-only` cannot be imported from `scripts/`.** It throws outside the Next.js
  runtime. Inline the crypto or read `.env.local` directly.
- **`IconAction` forwards no ref.** It composes `Tooltip > TooltipTrigger
  render={<Button/>}`, so wrapping it in `PopoverTrigger asChild` is fragile. The
  memory editor went inline for this reason.
- **`sed` on union type strings is order-sensitive.** `"provider" | "prompts" |
  "search"` and `"provider" | "search" | "prompts"` are different strings; grep first.

## Other work still open from earlier

- `smoke-tool-chain`: 5/7. Two round-cap assertions fail — the settings dialog opens
  in that scenario instead of the error banner. Unexplained; **not** assumed unrelated
  to the streaming changes.
- `messages.tokens` is never written by `/api/chat`, so the stats footer's token
  count can never render. Needs `stream_options: {include_usage: true}`.
- Tool-call accumulation uses `name +=` and `id =` (overwrite) in
  `foldToolDelta`. A gateway that resends the name produces `web_searchweb_search`.
  Last known way arguments can be mangled in transit.
