import { Fragment } from "react";
import { cn } from "~/lib/utils";

/**
 * Lightweight structured-text renderer for product/content copy stored as
 * plain text. Conventions (also produced by the Shopify sync's HTML→text
 * conversion, and usable in admin textareas):
 *   - blank line          → new paragraph
 *   - line starting "## " → sub-heading
 *   - line starting "• " (or "- " / "* ") → bullet list item
 */

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "para"; lines: string[] };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] | null = null;
  let para: string[] | null = null;
  const flush = () => {
    if (list) blocks.push({ kind: "list", items: list });
    if (para) blocks.push({ kind: "para", lines: para });
    list = null;
    para = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^##\s+/.test(line)) {
      flush();
      blocks.push({ kind: "heading", text: line.replace(/^##\s+/, "") });
      continue;
    }
    if (/^[•\-*]\s+/.test(line)) {
      if (para) flush();
      (list ??= []).push(line.replace(/^[•\-*]\s+/, ""));
      continue;
    }
    if (list) flush();
    (para ??= []).push(line);
  }
  flush();
  return blocks;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h3 key={i} className="pt-2 text-lg font-semibold tracking-tight text-foreground">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="space-y-1.5 pl-1">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="leading-relaxed">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
