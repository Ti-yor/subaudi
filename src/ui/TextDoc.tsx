import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationType, Doc, Explanation } from "../contracts";
import { MarkdownView } from "./MarkdownView";
import { Icon } from "./icons";
import { Menu, menuAt, type MenuState, toastError, formatBytes } from "./kit";
import type { ReadingPrefs } from "./Settings";

const api = window.subaudi;
const FORMAT_NAME: Record<string, string> = {
  md: "Markdown",
  txt: "纯文本",
  docx: "Word 文档",
  pptx: "演示文稿",
  ppt: "演示文稿",
  snapshot: "备份快照",
};

export function TextDoc({
  doc,
  size,
  annotations,
  explanations,
  scrollRef,
  outlineOpen,
  setOutlineOpen,
  prefs,
  setPrefs,
  onOverview,
  onOpenExp,
  onScroll,
}: {
  doc: Doc;
  size: number;
  annotations: AnnotationType[];
  explanations: Explanation[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  outlineOpen: boolean;
  setOutlineOpen: (v: boolean) => void;
  prefs: ReadingPrefs;
  setPrefs: (p: ReadingPrefs) => void;
  onOverview: (block?: string) => void;
  onOpenExp: (id: string) => void;
  onScroll: () => void;
}) {
  const [menu, setMenu] = useState<MenuState>(null);
  const [current, setCurrent] = useState<string>("");
  const column = useRef<HTMLDivElement>(null);
  const outline = useMemo(() => {
    const heads = doc.blocks.filter((b) => b.kind === "heading");
    if (heads.length)
      return heads.map((b) => ({
        id: b.id,
        title: b.text.replace(/^#+\s*/, "").split("\n")[0].slice(0, 80),
        lvl: Math.max(0, (b.text.match(/^#+/)?.[0].length ?? 1) - 1),
      }));
    const pages = new Map<number, string>();
    for (const b of doc.blocks)
      if (b.page !== undefined && !pages.has(b.page) && b.kind !== "notes")
        pages.set(b.page, b.id);
    return [...pages].map(([p, id]) => {
      const first = doc.blocks.find((b) => b.id === id)!;
      const title = first.kind === "image" ? "" : first.text.split("\n")[0].slice(0, 40);
      return { id, title: `${p + 1}　${title}`, lvl: 0 };
    });
  }, [doc]);
  const explained = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of explanations)
      if (!e.parent && e.root.doc === doc.id && !m.has(e.root.block)) m.set(e.root.block, e.id);
    return m;
  }, [explanations, doc.id]);

  // Text highlights via the CSS Custom Highlight API (no DOM mutation, selection-safe).
  useEffect(() => {
    const registry = (CSS as any).highlights,
      H = (window as any).Highlight;
    if (!registry || !H) return;
    const colors = ["yellow", "green", "blue", "pink"];
    colors.forEach((c) => registry.delete("note-" + c));
    const groups: Record<string, Range[]> = {};
    const blocks = new Map<string, HTMLElement>();
    column.current?.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => blocks.set(el.dataset.block!, el));
    for (const note of annotations)
      for (const seg of note.anchor.segments ?? [note.anchor]) {
        const el = blocks.get(seg.block);
        if (!el) continue;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT),
          range = document.createRange();
        let node: Node | null,
          offset = 0,
          started = false;
        while ((node = walker.nextNode())) {
          const chars = Array.from(node.textContent ?? "");
          if (!started && seg.start <= offset + chars.length) {
            range.setStart(node, chars.slice(0, seg.start - offset).join("").length);
            started = true;
          }
          if (started && seg.end <= offset + chars.length) {
            range.setEnd(node, chars.slice(0, seg.end - offset).join("").length);
            (groups[note.color] ??= []).push(range);
            break;
          }
          offset += chars.length;
        }
      }
    for (const [c, ranges] of Object.entries(groups)) registry.set("note-" + c, new H(...ranges));
    return () => colors.forEach((c) => registry.delete("note-" + c));
  }, [annotations, doc]);

  const trackCurrent = () => {
    onScroll();
    const top = scrollRef.current!.getBoundingClientRect().top + 80;
    let id = "";
    for (const o of outline) {
      const el = document.getElementById("block-" + o.id);
      if (el && el.getBoundingClientRect().top <= top) id = o.id;
      else if (el) break;
    }
    setCurrent(id);
  };
  const fontLabel = { serif: "宋体", sans: "黑体", kai: "楷体" };
  let lastPage: number | undefined;
  return (
    <>
      <div className="reader-bar" role="toolbar" aria-label="阅读工具">
        <button className="icon-btn" title="目录" aria-pressed={outlineOpen} disabled={!outline.length} onClick={() => setOutlineOpen(!outlineOpen)}>
          <Icon name="toc" />
        </button>
        <span className="sep" />
        <button className="icon-btn" title="缩小字号" disabled={prefs.size <= 14} onClick={() => setPrefs({ ...prefs, size: prefs.size - 1 })}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>A−</span>
        </button>
        <span className="label" style={{ minWidth: 30, textAlign: "center" }}>
          {prefs.size}
        </span>
        <button className="icon-btn" title="放大字号" disabled={prefs.size >= 26} onClick={() => setPrefs({ ...prefs, size: prefs.size + 1 })}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>A＋</span>
        </button>
        <button
          className="btn ghost"
          title="正文字体"
          onClick={(e) =>
            setMenu(
              menuAt(
                e.currentTarget,
                (["serif", "sans", "kai"] as const).map((f) => ({
                  label: fontLabel[f],
                  checked: prefs.font === f,
                  onClick: () => setPrefs({ ...prefs, font: f }),
                })),
              ),
            )
          }
        >
          {fontLabel[prefs.font]}
          <Icon name="chevronD" size={12} />
        </button>
        <span className="grow" />
        <button className="btn ghost" title="AI 导读：这一部分在讲什么、可能卡在哪" onClick={() => onOverview(current || undefined)}>
          <Icon name="guide" />
          导读
        </button>
        <button
          className="icon-btn"
          title="更多"
          onClick={(e) =>
            setMenu(
              menuAt(
                e.currentTarget,
                [{ label: "用系统程序打开原文件", icon: "external", onClick: () => void api.original(doc.id).catch(toastError) }],
                "right",
              ),
            )
          }
        >
          <Icon name="more" />
        </button>
      </div>
      <div className="reader-body">
        {outlineOpen && outline.length > 0 && (
          <nav className="outline" aria-label="目录">
            <h4>目录</h4>
            {outline.map((o) => (
              <button
                key={o.id}
                className={"lvl" + (o.id === current ? " current" : "")}
                style={{ ["--lvl" as any]: o.lvl }}
                onClick={() => {
                  const el = document.getElementById("block-" + o.id);
                  el?.scrollIntoView({ block: "start" });
                  scrollRef.current?.scrollBy(0, -24);
                }}
              >
                {o.title || "（无标题）"}
              </button>
            ))}
          </nav>
        )}
        <div className="scroll" ref={scrollRef} onScroll={trackCurrent}>
          <div className="text-column" ref={column}>
            <h1 className="doc-head">{doc.name.replace(/\.[^.]+$/, "")}</h1>
            <p className="doc-sub">
              {FORMAT_NAME[doc.format] ?? doc.format}
              {size ? "，" + formatBytes(size) : ""}
              {doc.issues.length ? "。" + doc.issues[0] : ""}
              {(() => {
                // Damaged slides/pages are listed, not hidden behind the general format notice.
                const damaged = doc.issues.slice(1).filter((i) => /损坏|无法读取/.test(i));
                return damaged.length ? "。" + damaged.join("；") : "";
              })()}
            </p>
            {doc.blocks.map((b) => {
              const mark =
                b.page !== undefined && b.page !== lastPage && (doc.format === "pptx" || doc.format === "ppt") ? (
                  <div className="slide-mark" key={"m" + b.page}>
                    第 {b.page + 1} 张幻灯片
                  </div>
                ) : null;
              lastPage = b.page;
              const exp = explained.get(b.id);
              if (b.kind === "paragraph" && /^\[此页无可提取正文\]$/.test(b.text)) return mark;
              return (
                <React.Fragment key={b.id}>
                  {mark}
                  <section id={"block-" + b.id} className={"block kind-" + b.kind}>
                    {exp && (
                      <button className="has-exp" title="查看这段的解释" onClick={() => onOpenExp(exp)}>
                        <svg width="18" height="18" viewBox="0 0 18 18">
                          <circle cx="9" cy="9" r="3.5" fill="currentColor" />
                        </svg>
                      </button>
                    )}
                    {b.asset ? (
                      <img className="asset" src={b.asset} alt={b.text} />
                    ) : (
                      <div data-artifact={doc.id} data-block={b.id}>
                        {doc.format === "md" ? <MarkdownView text={b.text} /> : <p>{b.text}</p>}
                      </div>
                    )}
                  </section>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
      <Menu state={menu} close={() => setMenu(null)} />
    </>
  );
}
