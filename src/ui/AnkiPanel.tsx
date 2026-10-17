import React, { useEffect, useRef, useState } from "react";
import type { Doc } from "../contracts";
import type { AnkiCard, AnkiReview, AnkiStatus } from "../anki-contracts";
import { Icon } from "./icons";
import { Menu, menuAt, type MenuState, confirmAction, errText, toast } from "./kit";

/**
 * Renders card markup inside the sandboxed iframe. The CSS is generated here (not in the upstream
 * note type) so the frame matches the reader: same font stack, size and measure, and comfortable
 * padding, in all three themes.
 */
export function cardDocument(markup: string, extra = "") {
  const dom = new DOMParser().parseFromString(markup, "text/html");
  dom.querySelectorAll("script,iframe,object,embed,link,meta,base,form,input,button").forEach((e) => e.remove());
  dom.querySelectorAll("*").forEach((e) => {
    for (const a of [...e.attributes]) {
      if (/^on/i.test(a.name) || ["href", "srcdoc", "action", "formaction", "srcset"].includes(a.name))
        e.removeAttribute(a.name);
      if (a.name === "src" && !/^data:(image|audio|video)\//i.test(a.value)) e.removeAttribute(a.name);
    }
  });
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, fallback = "") => css.getPropertyValue(n).trim() || fallback;
  const body = (extra ? extra + "\n" : "") + dom.body.innerHTML;
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';img-src data:;media-src data:;font-src data:;script-src 'none'"><style>
html,body{background:${v("--raised")}!important;color:${v("--ink")}!important}
body{margin:0;font-family:${v("--read-font", "serif")};font-size:calc(${v("--read-size", "18px")} + 1px);line-height:1.85;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased}
body > *{max-width:34em}
p{margin:0 0 1.1em}
ul,ol{margin:0 0 1.1em;padding-left:1.5em}
li{margin:0.35em 0}
h1,h2,h3{line-height:1.4;margin:1.2em 0 0.6em;font-weight:600}
h1{font-size:1.25em}h2{font-size:1.15em}h3{font-size:1.05em}
code,pre{font-family:${v("--mono", "monospace")};font-size:0.9em}
pre{background:${v("--sunken")};padding:12px 14px;border-radius:6px;white-space:pre-wrap}
code{background:${v("--sunken")};padding:1px 4px;border-radius:4px}
pre code{background:none;padding:0}
table{border-collapse:collapse;margin:0 0 1.1em}
th,td{border:1px solid ${v("--rule")};padding:7px 11px;text-align:left}
th{background:${v("--chrome")}}
blockquote{margin:0 0 1.1em;padding:2px 0 2px 14px;border-left:2px solid ${v("--rule-strong")};color:${v("--ink-2")}}
hr{border:0;border-top:1px solid ${v("--rule")};margin:1.4em 0}
/* The note type's own CSS (.card{padding:24px;font-size:20px;font-family:Segoe UI…}) is injected
   after this block, so the overrides must be !important. They are written as body.card for the frame
   itself (which keeps this file's font and padding) and .card:not(body) for nested elements, so the
   note type's own font/padding rules never reach the outer body. */
body.card{padding:38px 46px!important;max-width:none!important;font-family:${v("--read-font", "serif")}!important;font-size:calc(${v("--read-size", "18px")} + 1px)!important;line-height:1.85!important;background:transparent!important;color:inherit!important;text-align:left!important}
.card:not(body){background:transparent!important;color:inherit!important;font:inherit!important;padding:0!important;max-width:none!important}
.sa-answer{border-top:1px solid ${v("--rule")}!important;margin-top:22px;padding-top:20px}
.sa-source{font-family:${v("--ui", "sans-serif")}!important;font-size:12.5px!important;line-height:1.65!important;color:${v("--ink-3")}!important;margin-top:26px}
img{max-width:100%;height:auto}
a{pointer-events:none}
.sa-q-label,.sa-a-label{font-family:${v("--ui", "sans-serif")};font-size:11.5px;letter-spacing:0.08em;color:${v("--ink-3")};margin:0 0 10px}
.sa-a-label{margin-top:22px}
.sa-q{font-weight:600;font-size:1.06em;line-height:1.6;margin:0 0 1.4em;padding-bottom:1.1em;border-bottom:1px solid ${v("--rule")}}
</style>${dom.head.innerHTML}<body class="card">${body}</body>`;
}
type Row = { id: string; title: string; deck: string; suspended: boolean; reps: number; interval: number };
type Tab = "review" | "browse" | "generate";
const RATINGS = [
  { label: "重来", c: "var(--danger)" },
  { label: "困难", c: "var(--warn)" },
  { label: "良好", c: "var(--ok)" },
  { label: "简单", c: "var(--accent)" },
];
const saved = () => {
  try {
    return JSON.parse(localStorage.getItem("anki-workspace") || "{}");
  } catch {
    return {};
  }
};

export function AnkiPanel({
  doc,
  active,
  navigation,
  close,
  canAsk,
  openSettings,
}: {
  doc?: Doc;
  active: boolean;
  navigation: boolean;
  close: () => void;
  canAsk: boolean;
  openSettings: () => void;
}) {
  const api = window.subaudi,
    initial = useRef(saved());
  const [status, setStatus] = useState<AnkiStatus>();
  const [tab, setTab] = useState<Tab>(["review", "browse", "generate"].includes(initial.current.tab) ? initial.current.tab : "review");
  const [deck, setDeck] = useState<string>(initial.current.deck || "");
  const [query, setQuery] = useState<string>(initial.current.query || "");
  const [offset, setOffset] = useState(0),
    [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0);
  const [card, setCard] = useState<AnkiCard>(),
    [review, setReview] = useState<AnkiReview>(),
    // Browse opens on 问答同屏: skimming a deck is the common case; 复习 starts on the question.
    [answer, setAnswer] = useState(initial.current.tab === "browse");
  const [editing, setEditing] = useState(false),
    [fields, setFields] = useState<string[]>([]),
    [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [generating, setGenerating] = useState(false),
    [progress, setProgress] = useState("");
  const [scheduling, setScheduling] = useState(false),
    [name, setName] = useState("");
  const [rename, setRename] = useState<string | null>(null),
    [moving, setMoving] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const lock = useRef(false);
  async function run(fn: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    const s: AnkiStatus = await api.anki({ op: "status" });
    setStatus(s);
    setDeck((d) => (s.decks.some((x) => x.id === d) ? d : (s.decks.find((x) => x.count)?.id ?? s.decks[0]?.id ?? "")));
    return s;
  }
  const rowIndex = card ? rows.findIndex((r) => r.id === card.id) : -1;
  async function open(id: string) {
    if (!id) return;
    setCard(await api.anki({ op: "card", id }));
    setEditing(false);
    setMoving(null);
  }
  /** ↑/↓ and the toolbar arrows move through the current page of the list. */
  async function step(delta: number) {
    const at = rowIndex + delta;
    if (at < 0 || at >= rows.length) return;
    await run(async () => {
      await open(rows[at].id);
      document.querySelector(".card-list .card-item.active")?.scrollIntoView({ block: "nearest" });
    });
  }
  async function browse(at = 0, d = deck) {
    const r = await api.anki({ op: "browse", query, deck: d || undefined, offset: at });
    setRows(r.cards);
    setTotal(r.total);
    setOffset(at);
    return r.cards as Row[];
  }
  /** After generation: open the browser filtered to cards whose quote could not be verified. */
  function browseReview() {
    clear();
    setQuery("tag:待核对");
    setTab("browse"); // the browse effect runs with the new query on the next render
  }
  function show(r: AnkiReview) {
    setReview(r);
    setCard(r.card ?? undefined);
    setAnswer(false);
    setEditing(false);
  }
  const next = async () => show(await api.anki({ op: "next", deck }));
  function clear() {
    setCard(undefined);
    setReview(undefined);
    setAnswer(false);
    setEditing(false);
    setMoving(null);
  }
  const rate = (rating: number) =>
    run(async () => {
      if (!review?.token || !answer) return;
      show(await api.anki({ op: "answer", token: review.token, rating }));
      await refresh();
    });
  useEffect(() => api.event(setProgress), []);
  useEffect(() => {
    if (active) void run(refresh);
    if (status) void api.anki({ op: "review-visibility", visible: active }).catch(() => {});
  }, [active]);
  useEffect(() => localStorage.setItem("anki-workspace", JSON.stringify({ tab, deck, query })), [tab, deck, query]);
  useEffect(() => {
    if (!generating) setName(doc?.name.replace(/\.[^.]+$/, "") ?? "");
  }, [doc?.id]);
  useEffect(() => {
    if (!active || !status || tab !== "browse") return;
    void run(async () => {
      const list = await browse(0);
      // Open the first card straight away, so ↑ / ↓ can be used without a click.
      if (!card && list[0]) await open(list[0].id);
    });
  }, [deck, tab, active]);
  useEffect(() => {
    if (active && status && tab === "review" && deck && !review) void run(next);
  }, [deck, tab, active, !!status]);
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement).closest("input,textarea,select") || document.querySelector(".scrim") || busy || editing) return;
      if ((e.code === "Space" || e.key === "Enter") && tab === "review" && card && !answer) {
        e.preventDefault();
        setAnswer(true);
      } else if (/^[1-4]$/.test(e.key) && tab === "review" && answer) {
        e.preventDefault();
        void rate(Number(e.key));
      } else if (e.code === "Space" && tab === "review" && answer) {
        e.preventDefault();
        void rate(3);
      } else if (tab === "browse" && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        void step(e.key === "ArrowDown" ? 1 : -1);
      } else if (tab === "browse" && e.code === "Space" && rows.length) {
        e.preventDefault();
        setAnswer((v) => !v); // flip 正面 / 问答同屏 while skimming
      } else if (e.key === "Escape") close();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [active, busy, editing, tab, card, answer, review, rows, rowIndex]);
  const selected = status?.decks.find((d) => d.id === deck);
  const cardMenu = (el: Element, c: AnkiCard) =>
    setMenu(
      menuAt(
        el,
        [
          {
            label: "编辑",
            icon: "pen",
            onClick: () => {
              setFields(c.fields.map((f) => f.value));
              setTags(c.tags.join(" "));
              setEditing(true);
            },
          },
          {
            label: c.suspended ? "恢复复习" : "暂停复习",
            icon: "stop",
            onClick: () =>
              void run(async () => {
                await api.anki({ op: "suspend", id: c.id, suspended: !c.suspended });
                await refresh();
                if (tab === "review") await next();
                else {
                  setCard(await api.anki({ op: "card", id: c.id }));
                  await browse(offset);
                }
              }),
          },
          { label: "移动到牌组…", icon: "folder", onClick: () => setMoving(deck) },
          "sep",
          {
            label: "删除笔记",
            icon: "trash",
            danger: true,
            onClick: async () => {
              if (!(await confirmAction({ title: "删除这条笔记？", body: "它生成的所有卡片和复习记录都会删除。删除前会自动备份卡片库。", confirm: "删除", danger: true })))
                return;
              void run(async () => {
                await api.anki({ op: "delete-note", id: c.id });
                clear();
                await refresh();
                if (tab === "browse") await browse(0);
                else await next();
              });
            },
          },
        ],
        "right",
      ),
    );
  const cardView = (c: AnkiCard, side = answer) =>
    editing ? (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            setCard(await api.anki({ op: "edit", id: c.id, fields, tags: tags.split(/\s+/).filter(Boolean) }));
            setEditing(false);
            await refresh();
            if (tab === "browse") await browse(offset);
          });
        }}
      >
        {c.fields.map((f, i) => (
          <label className="field" key={i}>
            <span>{f.name}</span>
            <textarea rows={3} value={fields[i]} onChange={(e) => setFields((v) => v.map((x, j) => (i === j ? e.target.value : x)))} />
          </label>
        ))}
        <label className="field">
          <span>标签</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用空格分隔" />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" disabled={busy}>
            保存
          </button>
          <button type="button" className="btn" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </form>
    ) : (
      side ? (
        bothSides(c)
      ) : (
        <iframe className="card-frame" title="问题" sandbox="" srcDoc={cardDocument(c.question)} />
      )
    );

  /**
   * Browse mode: one pane holding question and answer together, for skimming a whole deck.
   * Most note types render {{FrontSide}} inside the answer; if this one does not, the question is
   * put above it so the pane is always self-contained.
   */
  const bothSides = (c: AnkiCard) => {
    const text = (html: string) =>
      (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, "");
    const question = text(c.question);
    const repeats = question.length < 12 || text(c.answer).includes(question.slice(0, Math.min(question.length, 40)));
    return (
      <iframe
        className="card-frame"
        title="卡片正面与背面"
        sandbox=""
        srcDoc={cardDocument(repeats ? c.answer : `<div class="sa-q">${c.question}</div>${c.answer}`)}
      />
    );
  };
  const movingForm = card && moving !== null && (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await api.anki({ op: "move", id: card.id, deck: moving });
          clear();
          await refresh();
          if (tab === "browse") await browse(offset);
          else await next();
          toast("已移动");
        });
      }}
    >
      <select className="input" value={moving} onChange={(e) => setMoving(e.target.value)} aria-label="目标牌组">
        {status?.decks.map((d) => (
          <option value={d.id} key={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button className="btn primary">移动</button>
      <button type="button" className="btn" onClick={() => setMoving(null)}>
        取消
      </button>
    </form>
  );
  const remaining = review ? review.counts.new + review.counts.learning + review.counts.review : 0;
  return (
    <div className="cards-shell" hidden={!active} aria-label="卡片库">
      {navigation && (
        <aside className="decks" aria-label="牌组">
          <div className="side-head">
            牌组
            <span>{status ? status.total + " 张" : ""}</span>
          </div>
          <div className="list">
            {status?.decks.map((d) => (
              <button
                key={d.id}
                className={"deck-row" + (d.id === deck ? " active" : "")}
                disabled={busy}
                onClick={() => {
                  setDeck(d.id);
                  clear();
                  setRename(null);
                }}
              >
                <span>{d.name}</span>
                <span className="counts">
                  {d.due > 0 && <span className="due">{d.due}</span>}
                  {d.new > 0 && <span className="new">{d.new}</span>}
                  {!d.due && !d.new && <span style={{ color: "var(--ink-3)" }}>{d.count}</span>}
                </span>
              </button>
            ))}
          </div>
        </aside>
      )}
      <section className="cards-main">
        <div className="cards-bar">
          <div className="segmented" role="tablist">
            {(
              [
                ["review", "复习"],
                ["browse", "浏览"],
                ["generate", "从资料制卡"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-pressed={tab === id}
                disabled={busy && !generating}
                onClick={() => {
                  setTab(id);
                  clear();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="grow" />
          {status?.undoable && tab === "review" && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.anki({ op: "undo" });
                  await next();
                  await refresh();
                })
              }
            >
              <Icon name="undo" />
              撤销评分
            </button>
          )}
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (await api.anki({ op: "import", scheduling })) {
                  const s = await refresh();
                  if (!selected?.count) setDeck(s.decks.find((d) => d.count)?.id ?? deck);
                  clear();
                  if (tab === "browse") await browse();
                  toast("已导入");
                }
              })
            }
          >
            <Icon name="upload" />
            导入
          </button>
          <button
            className="icon-btn"
            title="更多"
            onClick={(e) =>
              setMenu(
                menuAt(
                  e.currentTarget,
                  [
                    { label: "导出当前牌组…", icon: "download", disabled: !deck, onClick: () => void run(async () => (await api.anki({ op: "export", deck, scheduling })) && toast("已导出")) },
                    { label: "导入/导出时包含复习进度", icon: "check", checked: scheduling, onClick: () => setScheduling(!scheduling) },
                    { label: "重命名牌组", icon: "pen", disabled: !deck, onClick: () => setRename(selected?.name ?? "") },
                    "sep",
                    { label: "备份整个卡片库…", icon: "layers", onClick: () => void run(async () => (await api.anki({ op: "backup" })) && (clear(), await refresh(), toast("已备份"))) },
                    { label: "打开卡片库文件夹", icon: "folder", onClick: () => void api.anki({ op: "folder" }) },
                  ],
                  "right",
                ),
              )
            }
          >
            <Icon name="more" />
          </button>
        </div>
        <div className="cards-body">
          {error && (
            <div className="callout" role="alert">
              <Icon name="alert" />
              <div>
                {error}
                <div className="actions">
                  {/Key|设置|AI/.test(error) && (
                    <button className="btn" onClick={openSettings}>
                      打开设置
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => setError("")}>
                    关闭
                  </button>
                </div>
              </div>
            </div>
          )}
          {rename !== null && (
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api.anki({ op: "rename-deck", deck, name: rename });
                  setRename(null);
                  await refresh();
                });
              }}
            >
              <input className="input" autoFocus value={rename} onChange={(e) => setRename(e.target.value)} aria-label="牌组名称" />
              <button className="btn primary" disabled={!rename.trim()}>
                保存
              </button>
              <button type="button" className="btn" onClick={() => setRename(null)}>
                取消
              </button>
            </form>
          )}
          {tab === "generate" ? (
            <div className="generate">
              <h2>从资料制卡</h2>
              <p className="lede">
                逐段梳理{doc ? `《${doc.name.replace(/\.[^.]+$/, "")}》` : "当前资料"}
                的知识点，每个知识点生成至少一张问答卡，并附原文出处。中断后再次生成会跳过已完成的部分。
              </p>
              {!doc ? (
                <p className="hint">先在阅读视图中打开一份资料。</p>
              ) : !canAsk ? (
                <div className="callout info">
                  <Icon name="spark" />
                  <div>
                    制卡需要 AI 服务。
                    <div className="actions">
                      <button className="btn" onClick={openSettings}>
                        设置 AI 服务
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <label className="field">
                    <span>放入牌组</span>
                    <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
                    <small>不存在的牌组会自动创建；用 :: 分隔可建子牌组。</small>
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn primary lg"
                      disabled={busy || !name.trim()}
                      onClick={() =>
                        void run(async () => {
                          setGenerating(true);
                          try {
                            const r = await api.anki({ op: "generate", doc: doc.id, deck: name.trim() });
                            const s = await refresh();
                            setDeck(s.decks.find((d) => d.name === name.trim())?.id ?? deck);
                            const notes: string[] = r.warnings ?? [];
                            toast(
                              `新增 ${r.added} 张卡片，覆盖 ${r.covered}/${r.planned} 个知识点` +
                                (notes.length ? `。注意：${notes.join("；")}` : ""),
                              notes.length && r.warnings.some((w: string) => w.includes("待核对"))
                                ? { action: { label: "查看待核对", run: () => void browseReview() } }
                                : {},
                            );
                          } finally {
                            setGenerating(false);
                          }
                        })
                      }
                    >
                      <Icon name="spark" />
                      开始制卡
                    </button>
                    {generating && (
                      <button className="btn lg" onClick={() => void api.cancel()}>
                        停止
                      </button>
                    )}
                  </div>
                  {generating && (
                    <p className="progress-line" role="status">
                      <span className="spinner" />
                      {progress}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : tab === "browse" ? (
            <div className="browser">
              <div className="card-list">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => browse(0));
                  }}
                >
                  <input className="input" placeholder="搜索卡片（支持 Anki 语法）" value={query} onChange={(e) => setQuery(e.target.value)} />
                  <button className="btn" disabled={busy}>
                    <Icon name="search" />
                  </button>
                </form>
                <div className="items">
                  {rows.map((r) => (
                    <button
                      key={r.id}
                      className={"card-item" + (card?.id === r.id ? " active" : "")}
                      onClick={() => void run(() => open(r.id))}
                    >
                      {r.title || "（无文字）"}
                      <small>{r.suspended ? "已暂停" : r.reps ? `复习 ${r.reps} 次，间隔 ${r.interval} 天` : "新卡"}</small>
                    </button>
                  ))}
                  {!rows.length && <p className="empty-side" style={{ padding: 16 }}>没有卡片。</p>}
                </div>
                <div className="pager">
                  <span className="grow">
                    {total ? `${offset + 1}–${Math.min(offset + 100, total)} / ${total}` : "0 张"}
                  </span>
                  <button className="icon-btn" disabled={busy || offset === 0} onClick={() => void run(() => browse(Math.max(0, offset - 100)))}>
                    <Icon name="chevronL" />
                  </button>
                  <button className="icon-btn" disabled={busy || offset + 100 >= total} onClick={() => void run(() => browse(offset + 100))}>
                    <Icon name="chevronR" />
                  </button>
                </div>
              </div>
              <div className="card-detail">
                {card ? (
                  <>
                    <div className="toolbar">
                      <span className="grow">
                        {card.deck}
                        {card.suspended ? "（已暂停）" : ""}
                      </span>
                      <div className="segmented">
                        <button aria-pressed={!answer} onClick={() => setAnswer(false)} title="只看问题">
                          正面
                        </button>
                        <button aria-pressed={answer} onClick={() => setAnswer(true)} title="问题与答案同屏（默认）">
                          问答同屏
                        </button>
                      </div>
                      <span className="card-nav">
                        <button className="icon-btn" title="上一张（↑）" disabled={busy || !rowIndex} onClick={() => void step(-1)}>
                          <Icon name="chevronL" />
                        </button>
                        <button
                          className="icon-btn"
                          title="下一张（↓）"
                          disabled={busy || rowIndex < 0 || rowIndex + 1 >= rows.length}
                          onClick={() => void step(1)}
                        >
                          <Icon name="chevronR" />
                        </button>
                      </span>
                      <button className="icon-btn" title="卡片操作" onClick={(e) => cardMenu(e.currentTarget, card)}>
                        <Icon name="more" />
                      </button>
                    </div>
                    {movingForm}
                    {cardView(card)}
                  </>
                ) : (
                  <div className="study-done">选择左侧的卡片查看。</div>
                )}
              </div>
            </div>
          ) : (
            <div className="study">
              <div className="study-head">
                <h2>{selected?.name ?? "没有牌组"}</h2>
                <span className="grow" />
                <div className="study-counts">
                  {review ? (
                    <>
                      <span className="n">
                        新 <b>{review.counts.new}</b>
                      </span>
                      <span className="l">
                        学习中 <b>{review.counts.learning}</b>
                      </span>
                      <span className="r">
                        待复习 <b>{review.counts.review}</b>
                      </span>
                    </>
                  ) : (
                    <span>
                      今日已学 {status?.studied ?? 0} 张，评分 {status?.reviewed ?? 0} 次
                    </span>
                  )}
                </div>
                {card && (
                  <button className="icon-btn" title="卡片操作" onClick={(e) => cardMenu(e.currentTarget, card)}>
                    <Icon name="more" />
                  </button>
                )}
              </div>
              {movingForm}
              {card ? (
                <>
                  {cardView(card)}
                  {!editing &&
                    (!answer ? (
                      <div className="rating single">
                        <button className="rate" onClick={() => setAnswer(true)} disabled={busy}>
                          显示答案
                          <small>空格</small>
                        </button>
                      </div>
                    ) : (
                      <div className="rating">
                        {RATINGS.map((r, i) => (
                          <button key={r.label} className="rate" style={{ ["--c" as any]: r.c }} disabled={busy} onClick={() => void rate(i + 1)}>
                            {r.label}
                            <small>
                              {review?.intervals?.[i]} · {i + 1}
                            </small>
                          </button>
                        ))}
                      </div>
                    ))}
                </>
              ) : (
                <div className="study-done">
                  {!status ? (
                    error ? null : <span className="spinner" />
                  ) : !status.decks.length || !selected?.count ? (
                    <>
                      <h3>这里还没有卡片</h3>
                      <p>导入 Anki 牌组（.apkg / .colpkg），或在“从资料制卡”里让 AI 为当前资料生成卡片。</p>
                    </>
                  ) : review && remaining === 0 ? (
                    <>
                      <h3>今天的复习完成了</h3>
                      <p>明天再来。也可以去“浏览”里查看全部卡片。</p>
                    </>
                  ) : (
                    <button className="btn primary lg" disabled={busy || !deck} onClick={() => void run(next)}>
                      开始复习
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      <Menu state={menu} close={() => setMenu(null)} />
    </div>
  );
}
