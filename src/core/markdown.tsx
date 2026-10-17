import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownView } from "../ui/MarkdownView";
// Derived only from our safe React renderer. User HTML is skipped before this step.
// The DOM text and these code-point offsets share the same renderer version.
export function markdownText(text: string) {
  const html = renderToStaticMarkup(<MarkdownView text={text} />);
  return html
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(amp|lt|gt|quot|#x27|#\d+|#x[\da-f]+);/gi,
      (_, entity: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          "#x27": "'",
        };
        return (
          named[entity] ??
          String.fromCodePoint(
            entity.startsWith("#x")
              ? parseInt(entity.slice(2), 16)
              : parseInt(entity.slice(1), 10),
          )
        );
      },
    );
}
