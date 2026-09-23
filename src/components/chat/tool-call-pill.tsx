"use client";

import * as React from "react";
import {
  AlertCircleIcon,
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

const SOURCE_LABEL: Record<string, string> = {
  tavily: "Tavily",
  searxng: "SearXNG",
  duckduckgo: "DuckDuckGo",
};

export function ToolCallPill({ toolCall }: { toolCall: ToolCallInfo }) {
  const [expanded, setExpanded] = React.useState(false);
  const isSearching = toolCall.state === "running";
  const failed = toolCall.state === "failed";
  const results = toolCall.results ?? [];
  const query = toolCall.query ?? "";
  const source = toolCall.source ? SOURCE_LABEL[toolCall.source] : null;
  const isFetch = !!toolCall.url;
  const domain = toolCall.url ? domainFromUrl(toolCall.url) : "";
  const subject = isFetch ? domain : query;
  const excerpt = toolCall.excerpt ?? "";

  return (
    <div className="my-2 select-none text-xs">
      <button
        type="button"
        disabled={isSearching || failed}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all text-left",
          isSearching
            ? "border-primary/30 bg-primary/5 text-primary animate-pulse"
            : failed
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-border/60 bg-muted/50 text-foreground/80 hover:bg-muted hover:text-foreground cursor-pointer shadow-xs",
        )}
      >
        {isSearching ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        <span className="font-medium">
          {isSearching ? (
            isFetch ? (
              <>
                Reading{" "}
                <strong className="font-semibold text-foreground">
                  “{subject}”
                </strong>
                …
              </>
            ) : (
              <>
                Searching the web for{" "}
                <strong className="font-semibold text-foreground">
                  “{subject}”
                </strong>
                …
              </>
            )
          ) : failed ? (
            <>
              {isFetch ? "Could not read" : "Web search failed for"}{" "}
              <strong className="font-semibold text-foreground">
                “{subject}”
              </strong>
            </>
          ) : isFetch ? (
            <>
              Read{" "}
              <strong className="font-semibold text-foreground">
                “{toolCall.title || subject}”
              </strong>
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

        {/* Which backend actually answered — useful when a fallback fired. */}
        {!isSearching && !failed && source ? (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {source}
          </span>
        ) : null}

        {!isSearching && !failed && (isFetch ? !!excerpt : results.length > 0) ? (
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        ) : null}
      </button>

      {/* A failed search must say so rather than look like an empty success. */}
      {failed ? (
        <p className="mt-1.5 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] leading-relaxed text-destructive">
          {toolCall.error ??
            "The search backend could not be reached, so no live results were checked."}
        </p>
      ) : null}

      {/* Expanded Sources Panel */}
      {expanded && isFetch && excerpt ? (
        <div className="mt-2 max-w-2xl rounded-xl border bg-card p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <GlobeIcon className="size-3 shrink-0" />
            <span className="truncate font-medium">{domain}</span>
            <a
              href={toolCall.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 hover:text-foreground"
            >
              open
              <ExternalLinkIcon className="size-2.5" />
            </a>
          </div>
          <h4 className="mt-1 text-xs font-medium text-foreground">
            {toolCall.title || toolCall.url}
          </h4>
          <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
            {excerpt}
          </p>
        </div>
      ) : null}
      {expanded && !isFetch && results.length > 0 ? (
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
