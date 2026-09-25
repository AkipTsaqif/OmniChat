import { getQuickJS } from "quickjs-emscripten";

/**
 * Sandboxed JavaScript execution.
 *
 * QuickJS compiled to WebAssembly. The guest shares no object model with the
 * host: no `require`, no `process`, no filesystem, no network — those bindings
 * simply do not exist inside the isolate, which the probe that motivated this
 * module confirmed directly (`typeof require` and `typeof process` are both
 * `undefined` in there).
 *
 * This is a real boundary rather than a filtered one. Python was deliberately
 * not shipped alongside it: Pyodide blocks filesystem reads but
 * `os.system('whoami')` reached the host and raw `socket.connect` succeeded, so
 * it would have needed a denylist rather than a sandbox. JS-only is the honest
 * version of this feature.
 */

const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
export const CODE_TIMEOUT_MS = 2_000;
/** Cap what reaches the model and the UI. */
export const MAX_OUTPUT_CHARS = 8_000;

export type CodeRunResult = {
  ok: boolean;
  /** stdout — everything passed to console.log/warn/error. */
  output: string;
  /** The value of the last expression, when there was one. */
  value: string | null;
  error: string | null;
  timedOut: boolean;
  /** Milliseconds of wall clock the guest used. */
  durationMs: number;
};

/**
 * The user code is embedded as a JSON string literal, never concatenated, so it
 * cannot break out of the wrapper. The wrapper captures console output into an
 * array and returns it as a plain value — that avoids needing host-function
 * bindings inside the isolate at all, which would be the first thing a hostile
 * payload went looking for.
 */
function wrap(code: string): string {
  return `(() => {
  const __fmt = (x) => {
    try {
      if (x === undefined) return "undefined";
      if (x === null) return "null";
      return typeof x === "object" ? JSON.stringify(x) : String(x);
    } catch (e) {
      return String(x);
    }
  };
  const __out = [];
  const console = {
    log: (...a) => __out.push(a.map(__fmt).join(" ")),
    info: (...a) => __out.push(a.map(__fmt).join(" ")),
    warn: (...a) => __out.push(a.map(__fmt).join(" ")),
    error: (...a) => __out.push(a.map(__fmt).join(" ")),
  };
  let __value = "undefined";
  let __error = null;
  try {
    __value = __fmt(eval(${JSON.stringify(code)}));
  } catch (e) {
    const msg = e && e.message ? __fmt(e.message) : __fmt(e);
    const stack = e && e.stack ? __fmt(e.stack) : "";
    __error = stack ? msg + "\n" + stack : msg;
  }
  return { out: __out, value: __value, error: __error };
})()`;
}

export async function runJavaScript(
  code: string,
  timeoutMs: number = CODE_TIMEOUT_MS,
): Promise<CodeRunResult> {
  const trimmed = code.trim();
  if (!trimmed) {
    return {
      ok: false,
      output: "",
      value: null,
      error: "No code was supplied.",
      timedOut: false,
      durationMs: 0,
    };
  }
  if (trimmed.length > 20_000) {
    return {
      ok: false,
      output: "",
      value: null,
      error: "The code is too long to run.",
      timedOut: false,
      durationMs: 0,
    };
  }

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);

  const started = Date.now();
  let timedOut = false;
  runtime.setInterruptHandler(() => {
    if (Date.now() - started > timeoutMs) {
      timedOut = true;
      return true;
    }
    return false;
  });

  const vm = runtime.newContext();
  try {
    const result = vm.evalCode(wrap(trimmed));

    if (result.error) {
      const message = vm.dump(result.error);
      result.error.dispose();
      return {
        ok: false,
        output: "",
        value: null,
        error:
          timedOut
            ? `The code ran for longer than ${timeoutMs}ms and was stopped.`
            : String(message),
        timedOut,
        durationMs: Date.now() - started,
      };
    }

    const payload = vm.dump(result.value) as {
      out?: unknown;
      value?: unknown;
      error?: unknown;
    };
    result.value.dispose();

    const output = Array.isArray(payload.out)
      ? payload.out.map((line) => String(line)).join("\n")
      : "";
    const error =
      typeof payload.error === "string" && payload.error
        ? payload.error
        : timedOut
          ? `The code ran for longer than ${timeoutMs}ms and was stopped.`
          : null;

    return {
      ok: !error,
      output: output.slice(0, MAX_OUTPUT_CHARS),
      value:
        typeof payload.value === "string" &&
        payload.value !== "undefined" &&
        payload.value !== "null"
          ? payload.value.slice(0, MAX_OUTPUT_CHARS)
          : null,
      error,
      timedOut,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    // A host-side failure (the runtime blowing its memory cap, for instance)
    // must not surface as a guest error and must never escape as a throw.
    return {
      ok: false,
      output: "",
      value: null,
      error:
        timedOut
          ? `The code ran for longer than ${timeoutMs}ms and was stopped.`
          : error instanceof Error
            ? error.message
            : "The sandbox could not run that code.",
      timedOut,
      durationMs: Date.now() - started,
    };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
