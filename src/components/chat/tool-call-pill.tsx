"use client";

import * as React from "react";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  GlobeIcon,
  Loader2Icon,
} from "lucide-react";

import type { ToolCallInfo } from "@/lib/types";
import { cn } from "cn";

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ToolCallPill({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = React.useState(false);
  const isSearching = toolCall.state === "running";
  const results = toolCall.results ?? [];
  const query = toolCall.query ?? "";

  return (
    <div className="my-2 select-none text-xs">
      <button
        type="button"
        disabled={isSearching}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all text-left",
          isSearching
            ? "border-primary/30 bg-primary/5 text-primary animate-pulse"
            : "border-border/60 bg-muted/50 text-foreground/80 hover:bg-muted hover:text-foreground cursor-pointer shadow-xs",
        )}
      >
        {isSearching ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="font-medium">
          {isSearching ? (
            <>
              Searching the web for{" "}
              <strong className="font-semibold text-foreground">
                “{query}”
              </strong>
              …
            </>
          ) : results.length > 0 ? (
            <>
              Searched {results.length} sources for{" "}
              <strong className="font-semibold text-foreground">
                “{query}”
              </strong>
            </>
          ) : (
            <>
              Searched the web for{" "}
              <strong className="font-semibold text-foreground">
                “{query}”
              </strong>
            </>
          )}
        </span>

        {!isSearching && results.length > 0 ? (
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        ) : null}
      </button>

      {/* Expanded Sources Panel */}
      {expanded && results.length > 0 ? (
        <div className="mt-2 grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
          {results.map((result, idx) => (
            <a
              key={idx}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col justify-between rounded-xl border bg-card p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <GlobeIcon className="size-3 shrink-0" />
                  <span className="truncate font-medium">
                    {domainFromUrl(result.url)}
                  </span>
                  <ExternalLinkIcon className="ml-auto size-2.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <h4 className="mt-1 line-clamp-2 text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                  {result.title}
                </h4>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground leading-relaxed">
                {result.snippet}
              </p>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
