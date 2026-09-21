import * as React from "react";

import { CodeBlock } from "@/components/chat/code-block";

/**
 * Deliberately tiny markdown renderer — enough for the hardcoded transcript
 * (fenced code, lists, bold, inline code) without pulling in a parser.
 * Swap for `react-markdown` once real model output arrives.
 */

type Block =
  | { kind: "code"; language: string; code: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push({ kind: "code", language, code: code.join("\n") });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ kind: "bullets", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ kind: "numbers", items });
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].startsWith("```") &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

/**
 * Handles `code` and **bold** inside a line of text. Bold is matched first and
 * its body re-entered, so `code` nested inside **bold** renders as both rather
 * than leaking literal backticks.
 */
function Inline({ text }: { text: string }) {
  const tokens = text.split(/(\*\*.+?\*\*|`[^`]+`)/g).filter(Boolean);

  return (
    <>
      {tokens.map((token, i) => {
        if (token.startsWith("**") && token.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              <Inline text={token.slice(2, -2)} />
            </strong>
          );
        }
        if (token.startsWith("`") && token.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
            >
              {token.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={i}>{token}</React.Fragment>;
      })}
    </>
  );
}

export function Markdown({ content }: { content: string }) {
  const blocks = React.useMemo(() => parse(content), [content]);

  return (
    <div className="text-[15px] leading-7 text-foreground/90">
      {blocks.map((block, i) => {
        if (block.kind === "code") {
          return (
            <CodeBlock key={i} language={block.language} code={block.code} />
          );
        }
        if (block.kind === "bullets") {
          return (
            <ul key={i} className="my-2 space-y-1.5 pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="list-disc marker:text-muted-foreground">
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "numbers") {
          return (
            <ol key={i} className="my-2 space-y-1.5 pl-5">
              {block.items.map((item, j) => (
                <li
                  key={j}
                  className="list-decimal marker:text-muted-foreground"
                >
                  <Inline text={item} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className="my-2 first:mt-0 last:mb-0">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
