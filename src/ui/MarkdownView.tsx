import React from "react";
import Markdown from "react-markdown";
export function MarkdownView({ text }: { text: string }) {
  return (
    <Markdown
      skipHtml
      components={{
        img: () => <em>〔远程图片未加载〕</em>,
        a: ({ children }) => <span>{children}</span>,
      }}
    >
      {text}
    </Markdown>
  );
}
