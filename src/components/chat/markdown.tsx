"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

// KaTeX ships its own fonts; without this the glyphs fall back to whatever the
// OS has and equations come out misaligned.
import "katex/dist/katex.min.css";

import { CodeBlock } from "@/components/chat/code-block";

class MarkdownErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackText: string },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; fallbackText: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Markdown rendering error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="whitespace-pre-wrap font-sans text-[15px] leading-7">
          {this.props.fallbackText}
        </div>
      );
    }
    return this.props.children;
  }
}

export function Markdown({ content }: { content: string }) {
  if (!content) return null;

  return (
    <MarkdownErrorBoundary fallbackText={content}>
      <div className="text-[15px] leading-7 text-foreground/90">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            [
              rehypeKatex,
              // Malformed maths must degrade to readable text rather than
              // throw — the boundary below would otherwise swallow the entire
              // message because of one bad expression.
              { throwOnError: false, errorColor: "#ef4444" },
            ],
          ]}
          components={{
            pre({ children }) {
              // Unnest pre so CodeBlock's custom container doesn't create invalid <pre><div> nesting
              return <>{children}</>;
            },
            code(props) {
              const { className, children, ...rest } = props;
              delete (rest as Record<string, unknown>).node;
              const match = /language-(\w+)/.exec(className || "");
              const isInline = !match && !String(children).includes("\n");

              if (isInline) {
                return (
                  <code
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
                    {...rest}
                  >
                    {children}
                  </code>
                );
              }

              return (
                <CodeBlock
                  language={match ? match[1] : ""}
                  code={String(children).replace(/\n$/, "")}
                />
              );
            },
            ol({ children, ...props }) {
              return (
                <ol
                  className="my-2 space-y-1.5 pl-6 list-decimal marker:text-muted-foreground"
                  {...props}
                >
                  {children}
                </ol>
              );
            },
            ul({ children, ...props }) {
              return (
                <ul
                  className="my-2 space-y-1.5 pl-6 list-disc marker:text-muted-foreground"
                  {...props}
                >
                  {children}
                </ul>
              );
            },
            li({ children, ...props }) {
              return (
                <li className="leading-7" {...props}>
                  {children}
                </li>
              );
            },
            p({ children, ...props }) {
              return (
                <p className="my-2 first:mt-0 last:mb-0 leading-7" {...props}>
                  {children}
                </p>
              );
            },
            strong({ children, ...props }) {
              return (
                <strong className="font-semibold text-foreground" {...props}>
                  {children}
                </strong>
              );
            },
            a({ href, children, ...props }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4 hover:opacity-80"
                  {...props}
                >
                  {children}
                </a>
              );
            },
            h1({ children, ...props }) {
              return (
                <h1
                  className="mt-4 mb-2 text-xl font-bold tracking-tight text-foreground"
                  {...props}
                >
                  {children}
                </h1>
              );
            },
            h2({ children, ...props }) {
              return (
                <h2
                  className="mt-3 mb-1.5 text-lg font-semibold tracking-tight text-foreground"
                  {...props}
                >
                  {children}
                </h2>
              );
            },
            h3({ children, ...props }) {
              return (
                <h3
                  className="mt-2.5 mb-1 text-base font-semibold text-foreground"
                  {...props}
                >
                  {children}
                </h3>
              );
            },
            blockquote({ children, ...props }) {
              return (
                <blockquote
                  className="my-2 border-l-2 border-primary/40 pl-3 italic text-muted-foreground"
                  {...props}
                >
                  {children}
                </blockquote>
              );
            },
            table({ children, ...props }) {
              return (
                <div className="my-3 overflow-x-auto rounded-lg border">
                  <table className="w-full text-xs text-left" {...props}>
                    {children}
                  </table>
                </div>
              );
            },
            th({ children, ...props }) {
              return (
                <th
                  className="border-b bg-muted/60 px-3 py-2 font-medium"
                  {...props}
                >
                  {children}
                </th>
              );
            },
            td({ children, ...props }) {
              return (
                <td className="border-b border-border/50 px-3 py-2" {...props}>
                  {children}
                </td>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}
