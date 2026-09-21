import { cn } from "cn";

import { parseModelInfo } from "@/lib/data";

export function ProviderMark({
  modelId,
  className,
}: {
  modelId: string;
  className?: string;
}) {
  const { providerName, providerMark, accent } = parseModelInfo(modelId);

  return (
    <span
      title={modelId ? `${providerName} (${modelId})` : "Model"}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold tracking-tight",
        accent,
        className,
      )}
    >
      {providerMark}
    </span>
  );
}
