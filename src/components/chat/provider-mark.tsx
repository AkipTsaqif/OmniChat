import { cn } from "cn";

import { getProvider } from "@/lib/data";

/** Infers the vendor badge straight from a model id. */
function vendorFor(id: string) {
  const lower = id.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) {
    return "anthropic";
  }
  if (lower.includes("gemini") || lower.includes("google")) return "google";
  if (lower.includes("llama") || lower.includes("meta")) return "meta";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "mistral";
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3")) {
    return "openai";
  }
  return "unknown";
}

export function ProviderMark({
  modelId,
  className,
}: {
  modelId: string;
  className?: string;
}) {
  const provider = getProvider(vendorFor(modelId));

  return (
    <span
      title={modelId || provider.name}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold tracking-tight",
        provider.accent,
        className,
      )}
    >
      {provider.mark}
    </span>
  );
}
