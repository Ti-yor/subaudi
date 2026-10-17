import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "../contracts";
import { Icon, type IconName } from "./icons";
import { Scrim } from "./kit";

export type Command = { id: string; label: string; icon: IconName; keys?: string; run: () => void };

export function Palette({
  close,
  commands,
  docId,
  docName,
  onHit,
  initial = "",
}: {
  close: () => void;
  commands: Command[];
  docId?: string;
  docName?: string;
  onHit: (hit: SearchHit, query: string) => void;
  initial?: string;
}) {
  const [q, setQ] = useState(initial);
  const [scope, setScope] = useState<"doc" | "all">(docId ? "doc" : "all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      window.subaudi
        .find(query, scope === "doc" ? docId : undefined)
        .then(setHits, () => setHits([]))
        .finally(() => setLoading(false));
    }, 140);
    return () => clearTimeout(t);
  }, [q, scope, docId]);
  const cmds = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? commands.filter((c) => c.label.toLowerCase().includes(k)) : commands;
  }, [q, commands]);
  const items: ({ kind: "cmd"; c: Command } | { kind: "hit"; h: SearchHit })[] = [
    ...cmds.slice(0, q.trim() ? 4 : 12).map((c) => ({ kind: "cmd" as const, c })),
    ...hits.map((h) => ({ kind: "hit" as const, h })),
  ];
  useEffect(() => setActive(0), [q, scope, hits.length]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    close();
    if (it.kind === "cmd") it.c.run();
    else onHit(it.h, q.trim());
  };
  const mark = (h: SearchHit) => {
    let chars = Array.from(h.snippet),
      at = h.at;
    const n = Array.from(q.trim()).length;
    const lead = /^#{1,6}\s+/.exec(h.snippet)?.[0].length ?? 0;
    if (lead && at >= lead) {
      chars = chars.slice(lead);
      at -= lead;
    }
    h = { ...h, at };
    return (
      <>
        {chars.slice(0, h.at).join("")}
        <mark>{chars.slice(h.at, h.at + n).join("")}</mark>
        {chars.slice(h.at + n).join("")}
      </>
    );
  };
  return (
    <Scrim top onClose={close} label="搜索与命令">
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={q}
            placeholder={docId ? "搜索原文，或输入命令…" : "搜索全部资料，或输入命令…"}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(active);
              } else if (e.key === "Tab" && docId) {
                e.preventDefault();
                setScope((s) => (s === "doc" ? "all" : "doc"));
              }
            }}
          />
          {loading && <span className="spinner" />}
        </div>
        {docId && q.trim() && (
          <div className="palette-scope">
            <div className="segmented">
              <button aria-pressed={scope === "doc"} onClick={() => setScope("doc")}>
                {docName && docName.length > 18 ? docName.slice(0, 18) + "…" : docName || "当前资料"}
              </button>
              <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
                全部资料
              </button>
            </div>
          </div>
        )}
        <div className="palette-list" ref={list} role="listbox">
          {cmds.length > 0 && <div className="palette-group">命令</div>}
          {items.map((it, i) =>
            it.kind === "cmd" ? (
              <button
                key={"c" + it.c.id}
                role="option"
                aria-selected={i === active}
                className="palette-item"
                onMouseMove={() => setActive(i)}
                onClick={() => choose(i)}
              >
                <Icon name={it.c.icon} />
                <span className="main">
                  <div>{it.c.label}</div>
                </span>
                {it.c.keys && <kbd>{it.c.keys}</kbd>}
              </button>
            ) : (
              <React.Fragment key={"h" + it.h.doc + it.h.block}>
                {i === cmds.slice(0, q.trim() ? 4 : 12).length && <div className="palette-group">原文 · {hits.length} 处</div>}
                <button
                  role="option"
                  aria-selected={i === active}
                  className="palette-item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(i)}
                >
                  <Icon name="text" />
                  <span className="main">
                    <div className="snip">{mark(it.h)}</div>
                    <small>
                      {scope === "all" ? it.h.name + "，" : ""}
                      {it.h.locator}
                    </small>
                  </span>
                </button>
              </React.Fragment>
            ),
          )}
          {q.trim() && !loading && !hits.length && (
            <div className="palette-empty">没有找到“{q.trim()}”。{scope === "doc" && docId ? "按 Tab 改为搜索全部资料。" : ""}</div>
          )}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          {docId && (
            <span>
              <kbd>Tab</kbd> 切换范围
            </span>
          )}
          <span>
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </Scrim>
  );
}
