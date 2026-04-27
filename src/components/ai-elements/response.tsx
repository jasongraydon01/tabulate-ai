"use client";

import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";

export type ResponseProps = Omit<ComponentProps<"div">, "children"> & {
  children: string;
};

function isMarkdownTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  if (trimmed.startsWith(">")) return false;
  return trimmed.split("|").length >= 3;
}

export function demoteMarkdownTablesToCode(markdown: string): string {
  const lines = markdown.split("\n");
  const output: string[] = [];
  let index = 0;
  let isInFence = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fenceMatch = line.trim().match(/^(```|~~~)/);
    if (fenceMatch) {
      isInFence = !isInFence;
      output.push(line);
      index += 1;
      continue;
    }

    const nextLine = lines[index + 1] ?? "";
    if (
      !isInFence
      && isMarkdownTableLine(line)
      && isMarkdownTableSeparatorLine(nextLine)
    ) {
      const tableLines: string[] = [line, nextLine];
      index += 2;

      while (index < lines.length && isMarkdownTableLine(lines[index] ?? "")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }

      output.push("```text", ...tableLines, "```");
      continue;
    }

    output.push(line);
    index += 1;
  }

  return output.join("\n");
}

export function Response({ children, className, ...props }: ResponseProps) {
  return (
    <div
      className={cn("prose-analysis min-w-0 max-w-none break-words [overflow-wrap:anywhere]", className)}
      {...props}
    >
      <ReactMarkdown
        components={{
          h1: ({ children: headingChildren }) => (
            <div className="analysis-response-heading" data-heading-level="1">
              {headingChildren}
            </div>
          ),
          h2: ({ children: headingChildren }) => (
            <div className="analysis-response-heading" data-heading-level="2">
              {headingChildren}
            </div>
          ),
          h3: ({ children: headingChildren }) => (
            <div className="analysis-response-heading" data-heading-level="3">
              {headingChildren}
            </div>
          ),
          h4: ({ children: headingChildren }) => (
            <div className="analysis-response-heading" data-heading-level="4">
              {headingChildren}
            </div>
          ),
          h5: ({ children: headingChildren }) => (
            <div className="analysis-response-heading" data-heading-level="5">
              {headingChildren}
            </div>
          ),
          h6: ({ children: headingChildren }) => (
            <div className="analysis-response-heading" data-heading-level="6">
              {headingChildren}
            </div>
          ),
          a: ({ children: linkChildren, href }) => (
            <a href={href} rel="noreferrer" target="_blank">
              {linkChildren}
            </a>
          ),
        }}
      >
        {demoteMarkdownTablesToCode(children)}
      </ReactMarkdown>
    </div>
  );
}
