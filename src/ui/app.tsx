import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import type { API, AnnotationType, Doc, DocMeta, Explanation, OverviewType, SearchHit, State, Theme } from "../contracts";
import { readSelection } from "./selection";
import { Icon } from "./icons";
import {
  ConfirmHost,
  Menu,
  Scrim,
  Toasts,
  confirmAction,
  errText,
  formatTokens,
  menuAt,
  mod,
  toast,
  toastError,
  type MenuState,
} from "./kit";
import { Pdf, type ReaderStatus } from "./Pdf";
import { TextDoc } from "./TextDoc";
import { Margin, type Failure, type Target } from "./Margin";
import { Palette, type Command } from "./Palette";
import { SettingsDialog, type ReadingPrefs, type SettingsTab } from "./Settings";
import { AnkiPanel } from "./AnkiPanel";
import { highlightColors } from "./PdfPage";

declare global {
  interface Window {
    subaudi: API;
  }
}
const api = window.subaudi;
const COLORS = ["yellow", "green", "blue", "pink"] as const;
const COLOR_NAME = { yellow: "黄", green: "绿", blue: "蓝", pink: "粉" };
const FONT_STACK = { serif: "var(--serif)", sans: "var(--sans-read)", kai: "var(--kai)" };
const loadPrefs = (): ReadingPrefs => {
  try {
    return { font: "serif", size: 18, width: 40, ...JSON.parse(localStorage.getItem("reading") || "{}") };
  } catch {
    return { font: "serif", size: 18, width: 40 };
  }
};
const fmtLabel = (f: string) => (f === "snapshot" ? "快照" : f.toUpperCase());
const needsSettings = (msg: string) => /API Key|设置|401|402|403|模型|服务地址/.test(msg);

type Sel = { target: Target; x: number; y: number; below: boolean };

function App() {
  const [state, setState] = useState<State | null>(null);
  const [bootError, setBootError] = useState("");
  const [docId, setDocId] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [expId, setExpId] = useState("");
  const [view, setView] = useState<"read" | "cards">("read");
  const [sidebar, setSidebar] = useState(localStorage.getItem("sidebar") !== "0");
  const [panel, setPanel] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(localStorage.getItem("outline") === "1");
  const [sideTab, setSideTab] = useState<"notes" | "exps">("notes");
  const [draft, setDraft] = useState<(Target & { focus?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [overview, setOverview] = useState<OverviewType | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [note, setNote] = useState<AnnotationType | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [palette, setPalette] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [dragging, setDragging] = useState(false);
  const [readerStatus, setReaderStatus] = useState<ReaderStatus>(null);
  const [theme, setThemeState] = useState<Theme>((localStorage.getItem("theme") as Theme) || "light");
  const [prefs, setPrefsState] = useState<ReadingPrefs>(loadPrefs);
  const textScroll = useRef<HTMLDivElement>(null),
    marginScroll = useRef<HTMLDivElement>(null),
    readerRoot = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Record<string, number>>({});
  const generation = useRef(0);
  const initialized = useRef(false);
  const locate = useRef<{ doc: string; block: string } | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ───── theme & reading prefs ───── */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    void api.theme(t);
  };
  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty("--read-font", FONT_STACK[prefs.font]);
    s.setProperty("--read-size", prefs.size + "px");
    s.setProperty("--read-width", prefs.width + "em");
    localStorage.setItem("reading", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => localStorage.setItem("sidebar", sidebar ? "1" : "0"), [sidebar]);
  useEffect(() => localStorage.setItem("outline", outlineOpen ? "1" : "0"), [outlineOpen]);

  /* ───── data ───── */
  const refresh = useCallback(async () => {
    const s = await api.state();
    setState(s);
    if (!initialized.current) {
      initialized.current = true;
      const saved = String(s.session.docId ?? "");
      setDocId(s.docs.some((d) => d.id === saved) ? saved : (s.docs[0]?.id ?? ""));
      const savedExp = String(s.session.expId ?? "");
      if (s.explanations.some((e) => e.id === savedExp)) {
        setExpId(savedExp);
        setPanel(true);
      }
      scrolls.current = (s.session.scrolls ?? {}) as Record<string, number>;
    }
    return s;
  }, []);
  useEffect(() => {
    refresh().catch((e) => setBootError(errText(e)));
    return api.event((s) => {
      setStage(s);
      if (/^部分文件未导入|^部分内容未能读取|^已恢复/.test(s)) toast(s);
    });
  }, []);
  useEffect(() => {
    if (!docId) return setDoc(null);
    let live = true;
    setDoc((d) => (d?.id === docId ? d : null));
    api.doc(docId).then(
      (d) => live && setDoc(d),
      (e) => live && toastError(e),
    );
    return () => {
      live = false;
    };
  }, [docId]);
  const docMeta = state?.docs.find((d) => d.id === docId);
  const exp = state?.explanations.find((e) => e.id === expId);
  const path = useMemo(() => {
    const out: Explanation[] = [];
    let cur = exp;
    while (cur && out.length < 50) {
      out.unshift(cur);
      cur = state?.explanations.find((e) => e.id === cur!.parent);
    }
    return out;
  }, [exp, state?.explanations]);
  const docNotes = useMemo(() => (state?.annotations ?? []).filter((n) => n.doc === docId), [state?.annotations, docId]);
  const docExps = useMemo(
    () =>
      (state?.explanations ?? [])
        .filter((e) => e.root.doc === docId)
        .sort((a, b) => (a.created < b.created ? 1 : -1)),
    [state?.explanations, docId],
  );
  const canAsk = !!state?.hasKey && !!state?.settings.cloud;

  /* ───── session ───── */
  const saveSession = () => {
    clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      void api.session({ docId, expId, scrolls: scrolls.current }).catch(() => {});
    }, 500);
  };
  useEffect(() => {
    if (initialized.current) saveSession();
  }, [docId, expId]);
  // Restore text scroll position once a document is rendered, or perform a pending jump.
  useEffect(() => {
    if (!doc || doc.id !== docId) return;
    requestAnimationFrame(() => {
      const target = locate.current;
      if (target && target.doc === doc.id) {
        locate.current = null;
        locateBlock(doc, target.block);
      } else if (doc.format !== "pdf" && textScroll.current)
        textScroll.current.scrollTop = scrolls.current["doc:" + doc.id] ?? 0;
    });
  }, [doc?.id, docId]);

  /* ───── navigation ───── */
  const openDoc = (id: string) => {
    if (id === docId) return setView("read");
    generation.current++;
    setDocId(id);
    setView("read");
    setDraft(null);
    setOverview(null);
    setFailure(null);
    setSel(null);
    if (exp && exp.root.doc !== id) setExpId("");
  };
  const locateBlock = (d: Doc, block: string) => {
    const b = d.blocks.find((x) => x.id === block);
    if (d.format === "pdf") {
      if (b?.page !== undefined) dispatchEvent(new CustomEvent("subaudi-page", { detail: { doc: d.id, page: b.page } }));
      return;
    }
    const el = document.getElementById("block-" + block);
    if (!el) return toast("没有找到这段原文");
    el.scrollIntoView({ block: "center" });
    el.classList.add("located");
    setTimeout(() => el.classList.remove("located"), 1800);
  };
  const jump = (did: string, block: string) => {
    setView("read");
    if (did === docId && doc) return locateBlock(doc, block);
    if (!state?.docs.some((d) => d.id === did)) return toast("这份资料已不在资料库中");
    locate.current = { doc: did, block };
    openDoc(did);
  };
  const openExp = (id: string) => {
    setExpId(id);
    setDraft(null);
    setOverview(null);
    setFailure(null);
    setPanel(true);
    requestAnimationFrame(() => marginScroll.current?.scrollTo(0, 0));
  };

  /* ───── import ───── */
  const importDocs = async (paths: string[] | null, ref = false) => {
    try {
      const docs = paths ? await api.importPaths(paths, ref) : await api.open(ref);
      if (!docs.length) return;
      await refresh();
      openDoc(docs[docs.length - 1].id);
      toast(docs.length > 1 ? `已导入 ${docs.length} 份资料` : `已打开《${docs[0].name}》`);
    } catch (e) {
      toastError(e);
    }
  };
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => api.pathFor(f)).filter(Boolean);
      if (paths.length) void importDocs(paths);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragleave", leave);
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  /* ───── selection ───── */
  const captureSelection = (e: React.MouseEvent<HTMLElement>, container: HTMLElement) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, summary, .reader-bar")) return;
    const context = e.type === "contextmenu";
    try {
      const found = readSelection(container);
      if (!found) {
        if (!context) setSel(null);
        return;
      }
      if (context) e.preventDefault();
      const range = getSelection()!.getRangeAt(0);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const first = rects[0] ?? range.getBoundingClientRect();
      const x = context ? e.clientX : (first.left + (rects.at(-1)?.right ?? first.right)) / 2;
      const top = context ? e.clientY : first.top;
      const below = top < 110;
      setSel({ target: found, x, y: below ? (rects.at(-1)?.bottom ?? first.bottom) + 10 : top - 10, below });
    } catch (err) {
      toast(errText(err));
    }
  };
  useEffect(() => {
    if (!sel) return;
    const change = () => {
      if (getSelection()?.isCollapsed) setSel(null);
    };
    const hide = () => setSel(null);
    document.addEventListener("selectionchange", change);
    addEventListener("resize", hide);
    const scrollers = document.querySelectorAll(".scroll, .margin-body");
    scrollers.forEach((s) => s.addEventListener("scroll", hide, { passive: true }));
    return () => {
      document.removeEventListener("selectionchange", change);
      removeEventListener("resize", hide);
      scrollers.forEach((s) => s.removeEventListener("scroll", hide));
    };
  }, [sel]);

  /* ───── explain ───── */
  const run = async (target: Target, opts: { question?: string; complex?: boolean; query?: string } = {}) => {
    setSel(null);
    setPanel(true);
    setOverview(null);
    if (!canAsk) {
      setDraft({ ...target });
      setFailure({ text: state?.hasKey ? "AI 解释已关闭。在设置中启用后即可解释。" : "还没有配置 AI 服务。粘贴一个 API Key 即可开始解释。", settings: true });
      return;
    }
    const token = ++generation.current;
    setDraft({ ...target });
    setBusy(true);
    setFailure(null);
    setStage("正在准备…");
    try {
      const e = await api.explain({
        anchor: target.anchor,
        parent: target.parent,
        complex: !!opts.complex,
        query: opts.query?.trim() ?? "",
        question: opts.question?.trim() || undefined,
        mode: "teach",
      });
      await refresh();
      if (generation.current === token) {
        getSelection()?.removeAllRanges();
        setDraft(null);
        openExp(e.id);
      }
    } catch (err) {
      if (generation.current !== token) return;
      const text = errText(err);
      const local = /仅本地/.test(text);
      setFailure({
        text,
        settings: needsSettings(text) && !local,
        retry: local
          ? async () => {
              await api.cloud(target.anchor.doc, true);
              await refresh();
              void run(target, opts);
            }
          : () => void run(target, opts),
      });
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const cancel = () => {
    generation.current++;
    setBusy(false);
    void api.cancel();
  };
  const showOverview = async (block?: string) => {
    if (!doc) return;
    const id = block ?? doc.blocks.find((b) => b.text.trim())?.id;
    if (!id) return toast("这份资料还没有可读取的文字");
    setPanel(true);
    setDraft(null);
    setFailure(null);
    if (!canAsk) return setFailure({ text: "导读需要 AI 服务。配置 API Key 后即可使用。", settings: true });
    const token = ++generation.current;
    setBusy(true);
    setStage("正在生成导读…");
    try {
      const o = await api.overview(doc.id, id);
      if (generation.current === token) setOverview(o);
    } catch (e) {
      if (generation.current === token) setFailure({ text: errText(e), settings: needsSettings(errText(e)), retry: () => void showOverview(block) });
    } finally {
      if (generation.current === token) setBusy(false);
    }
  };
  const explainBlock = (blockId: string, question: string) => {
    if (!doc) return;
    const el = document.querySelector<HTMLElement>(`[data-artifact="${doc.id}"][data-block="${blockId}"]`);
    const raw = doc.format === "pdf" || !el ? doc.blocks.find((b) => b.id === blockId)?.text : el.textContent;
    if (!raw?.trim()) return toast("这段原文暂不可用");
    const quote = Array.from(raw).slice(0, 1500).join("");
    void run(
      { anchor: { doc: doc.id, block: blockId, start: 0, end: Array.from(quote).length, quote }, parent: null },
      { question },
    );
  };

  /* ───── annotations ───── */
  const annotate = async (target: Target, color: AnnotationType["color"], edit: boolean) => {
    setSel(null);
    if (target.parent) return toast("解释内的文字不能高亮");
    const value: AnnotationType = {
      id: crypto.randomUUID(),
      doc: target.anchor.doc,
      anchor: target.anchor,
      note: "",
      color,
      created: new Date().toISOString(),
    };
    if (edit) return setNote(value);
    try {
      await api.annotate(value);
      getSelection()?.removeAllRanges();
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };
  const removeItem = async (kind: "docs" | "explanations" | "annotations", id: string) => {
    try {
      await api.remove(kind, id);
      if (kind === "docs" && id === docId) {
        const next = state?.docs.find((d) => d.id !== id);
        setDocId(next?.id ?? "");
        setExpId("");
      }
      if (kind === "explanations" && (id === expId || path.some((p) => p.id === id))) setExpId("");
      await refresh();
    } catch (e) {
      toastError(e);
    }
  };

  /* ───── hotkeys ───── */
  const commands: Command[] = [
    { id: "open", label: "打开资料…", icon: "plus", keys: mod + "+O", run: () => void importDocs(null) },
    { id: "ref", label: "添加参考资料…", icon: "book", run: () => void importDocs(null, true) },
    { id: "cards", label: view === "cards" ? "回到阅读" : "打开卡片库", icon: "cards", run: () => setView(view === "cards" ? "read" : "cards") },
    { id: "side", label: sidebar ? "隐藏侧栏" : "显示侧栏", icon: "sidebar", keys: mod + "+\\", run: () => setSidebar(!sidebar) },
    { id: "margin", label: panel ? "隐藏解释栏" : "显示解释栏", icon: "panel", keys: mod + "+J", run: () => setPanel(!panel) },
    ...(doc ? [{ id: "guide", label: "AI 导读当前部分", icon: "guide" as const, run: () => void showOverview() }] : []),
    { id: "theme-light", label: "主题：明亮", icon: "sun", run: () => setTheme("light") },
    { id: "theme-sepia", label: "主题：护眼", icon: "sun", run: () => setTheme("sepia") },
    { id: "theme-dark", label: "主题：夜间", icon: "sun", run: () => setTheme("dark") },
    { id: "settings", label: "设置", icon: "settings", keys: mod + "+,", run: () => setSettingsTab("ai") },
    { id: "usage", label: "查看用量", icon: "layers", run: () => setSettingsTab("usage") },
    { id: "export", label: "导出备份…", icon: "download", run: () => void api.export().then((p) => p && toast("已导出到 " + p), toastError) },
  ];
  const hot = useRef<(e: KeyboardEvent) => void>(() => {});
  hot.current = (e: KeyboardEvent) => {
    const m = e.ctrlKey || e.metaKey;
    if (e.key === "Escape" && sel) return setSel(null);
    if (!m) return;
    const k = e.key.toLowerCase();
    if (k === "k" || (k === "f" && !e.shiftKey)) {
      e.preventDefault();
      setPalette(k === "f" ? (getSelection()?.toString().trim().slice(0, 60) ?? "") : "");
    } else if (k === "o") {
      e.preventDefault();
      void importDocs(null);
    } else if (k === ",") {
      e.preventDefault();
      setSettingsTab("ai");
    } else if (k === "\\") {
      e.preventDefault();
      setSidebar((v) => !v);
    } else if (k === "j") {
      e.preventDefault();
      setPanel((v) => !v);
    } else if (k === "e" && sel) {
      e.preventDefault();
      void run(sel.target);
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => hot.current(e);
    addEventListener("keydown", fn);
    return () => removeEventListener("keydown", fn);
  }, []);

  if (!state)
    return (
      <div className="loading-screen" role={bootError ? "alert" : "status"}>
        {bootError || <span className="spinner" />}
      </div>
    );

  const usage = state.usage;
  const usagePct = usage.budget ? usage.spent / usage.budget : 0;
  const showWelcome = !state.docs.length;
  return (
    <>
      <header className="titlebar">
        <div className="left">
          <button className="icon-btn" title={`侧栏（${mod}+\\）`} aria-pressed={sidebar} onClick={() => setSidebar(!sidebar)}>
            <Icon name="sidebar" />
          </button>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Subaudi
          </div>
        </div>
        <div className="doc-title" title={docMeta?.name}>
          {view === "cards" ? "卡片库" : (docMeta?.name ?? "")}
        </div>
        <div className="right">
          <button className="search-trigger" onClick={() => setPalette("")}>
            <Icon name="search" size={14} />
            <span>搜索</span>
            <kbd>{mod}+K</kbd>
          </button>
          <div className="tab-switch" role="group" aria-label="视图">
            <button aria-pressed={view === "read"} onClick={() => setView("read")}>
              <Icon name="book" size={15} />
              阅读
            </button>
            <button aria-pressed={view === "cards"} onClick={() => setView("cards")}>
              <Icon name="cards" size={15} />
              卡片
            </button>
          </div>
          {view === "read" && (
            <button className="icon-btn" title={`解释栏（${mod}+J）`} aria-pressed={panel} onClick={() => setPanel(!panel)}>
              <Icon name="panel" />
            </button>
          )}
          <button className="icon-btn" title={`设置（${mod}+,）`} onClick={() => setSettingsTab("ai")}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <AnkiPanel doc={doc ?? undefined} active={view === "cards"} navigation={sidebar} close={() => setView("read")} canAsk={canAsk} openSettings={() => setSettingsTab("ai")} />

      <div className="shell" hidden={view !== "read"}>
        {sidebar && (
          <aside className="sidebar" aria-label="资料库">
            <div className="side-head">
              资料库
              <button
                className="icon-btn"
                title="添加资料"
                onClick={(e) =>
                  setMenu(
                    menuAt(e.currentTarget, [
                      { label: "打开资料…", icon: "plus", onClick: () => void importDocs(null) },
                      { label: "添加参考资料…", icon: "book", onClick: () => void importDocs(null, true) },
                    ], "right"),
                  )
                }
              >
                <Icon name="plus" />
              </button>
            </div>
            <div className="library">
              {state.docs.map((d) => (
                <DocRow
                  key={d.id}
                  d={d}
                  active={d.id === docId}
                  open={() => openDoc(d.id)}
                  menu={(el) =>
                    setMenu(
                      menuAt(el, [
                        { label: "用系统程序打开", icon: "external", onClick: () => void api.original(d.id).catch(toastError) },
                        {
                          label: "允许 AI 读取这份资料",
                          icon: "spark",
                          checked: d.cloud,
                          onClick: async () => {
                            await api.cloud(d.id, !d.cloud);
                            await refresh();
                            toast(d.cloud ? "已设为仅本地：不会发送给 AI" : "已允许 AI 读取这份资料");
                          },
                        },
                        "sep",
                        {
                          label: "从资料库移除",
                          icon: "trash",
                          danger: true,
                          onClick: async () => {
                            if (
                              await confirmAction({
                                title: `移除《${d.name}》？`,
                                body: "相关的批注和解释也会一并删除。你电脑上的原文件不受影响。",
                                confirm: "移除",
                                danger: true,
                              })
                            )
                              void removeItem("docs", d.id);
                          },
                        },
                      ]),
                    )
                  }
                />
              ))}
              {!state.docs.length && <p className="empty-side">还没有资料。把文件拖进窗口，或点右上角的 ＋。</p>}
            </div>
            {docMeta && (
              <>
                <div className="side-tabs" role="group">
                  <button aria-pressed={sideTab === "notes"} onClick={() => setSideTab("notes")}>
                    批注 {docNotes.length || ""}
                  </button>
                  <button aria-pressed={sideTab === "exps"} onClick={() => setSideTab("exps")}>
                    解释 {docExps.length || ""}
                  </button>
                </div>
                <div className="side-list">
                  {sideTab === "notes" ? (
                    docNotes.length ? (
                      docNotes.map((n) => (
                        <button
                          key={n.id}
                          className="note-row"
                          style={{ ["--hl" as any]: highlightColors[n.color] }}
                          onClick={() => jump(n.doc, n.anchor.block)}
                          onDoubleClick={() => setNote(n)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMenu({
                              x: e.clientX,
                              y: e.clientY,
                              items: [
                                { label: "编辑批注", icon: "pen", onClick: () => setNote(n) },
                                { label: "删除", icon: "trash", danger: true, onClick: () => void removeItem("annotations", n.id) },
                              ],
                            });
                          }}
                        >
                          <q>{n.anchor.quote}</q>
                          {n.note && <p>{n.note}</p>}
                        </button>
                      ))
                    ) : (
                      <p className="empty-side">选中原文后点色块即可高亮；双击列表项可编辑批注。</p>
                    )
                  ) : docExps.length ? (
                    docExps.map((e) => (
                      <button
                        key={e.id}
                        className={"note-row" + (e.stale ? " stale" : "")}
                        style={{ ["--hl" as any]: e.parent ? "var(--rule-strong)" : "var(--cinnabar)" }}
                        aria-current={e.id === expId}
                        onClick={() => openExp(e.id)}
                        onContextMenu={(ev) => {
                          ev.preventDefault();
                          setMenu({
                            x: ev.clientX,
                            y: ev.clientY,
                            items: [{ label: "删除解释", icon: "trash", danger: true, onClick: () => void removeItem("explanations", e.id) }],
                          });
                        }}
                      >
                        <p style={{ marginTop: 0 }}>{e.draft.title}</p>
                        <small>
                          {e.parent ? "追问 · " : ""}
                          {e.stale ? "已标记有误 · " : ""}
                          {new Date(e.created).toLocaleDateString("zh-CN")}
                        </small>
                      </button>
                    ))
                  ) : (
                    <p className="empty-side">在原文中选中一句话并点“解释”，记录会出现在这里。</p>
                  )}
                </div>
              </>
            )}
          </aside>
        )}

        <main className="reader" ref={readerRoot} onMouseUp={(e) => captureSelection(e, readerRoot.current!)} onContextMenu={(e) => captureSelection(e, readerRoot.current!)}>
          {showWelcome ? (
            <Welcome open={() => void importDocs(null)} />
          ) : !doc ? (
            <div className="loading-screen">
              <span className="spinner" />
            </div>
          ) : doc.format === "pdf" ? (
            <Pdf
              key={doc.id}
              doc={doc}
              annotations={docNotes}
              onNote={setNote}
              onOverview={(b) => void showOverview(b)}
              onDoc={(d) => {
                setDoc(d);
                void refresh();
              }}
              onStatus={setReaderStatus}
              outlineOpen={outlineOpen}
              setOutlineOpen={setOutlineOpen}
            />
          ) : (
            <TextDoc
              key={doc.id}
              doc={doc}
              size={docMeta?.size ?? 0}
              annotations={docNotes}
              explanations={docExps}
              scrollRef={textScroll}
              outlineOpen={outlineOpen}
              setOutlineOpen={setOutlineOpen}
              prefs={prefs}
              setPrefs={setPrefsState}
              onOverview={(b) => void showOverview(b)}
              onOpenExp={openExp}
              onScroll={() => {
                scrolls.current["doc:" + doc.id] = textScroll.current?.scrollTop ?? 0;
                saveSession();
              }}
            />
          )}
        </main>

        {panel && !showWelcome && (
          <Margin
            exp={exp}
            path={path}
            draft={draft}
            busy={busy}
            stage={stage}
            failure={failure}
            overview={overview}
            canAsk={canAsk}
            hasSearch={!!state.settings.searx}
            scrollRef={marginScroll}
            onRun={(o) => draft && void run(draft, o)}
            onCancel={cancel}
            onSelect={(e) => captureSelection(e, marginScroll.current!)}
            onJump={jump}
            onOpen={openExp}
            onFlag={async () => {
              if (!exp) return;
              await api.flag(exp.id);
              await refresh();
              toast("已标记有误，相关追问也不会再被复用");
            }}
            onDelete={async () => {
              if (exp && (await confirmAction({ title: "删除这条解释？", body: "从它继续追问的解释也会一并删除。", confirm: "删除", danger: true })))
                void removeItem("explanations", exp.id);
            }}
            onClose={() => setPanel(false)}
            onSettings={() => setSettingsTab("ai")}
            onDismissDraft={() => {
              setDraft(null);
              setFailure(null);
            }}
            onExplainObstacle={explainBlock}
            onDismissOverview={() => setOverview(null)}
          />
        )}
      </div>

      <footer className="statusbar">
        {readerStatus?.active || (busy && view === "read") ? <span className="pulse" /> : null}
        <span className="grow">{view === "read" ? (busy ? stage : (readerStatus?.text ?? "")) : ""}</span>
        {view === "read" && readerStatus?.action && (
          <button className="link" onClick={readerStatus.action.run}>
            {readerStatus.action.label}
          </button>
        )}
        {canAsk ? (
          <button title="本月 AI 用量" onClick={() => setSettingsTab("usage")}>
            {usage.budget > 0 && (
              <span className={"meter" + (usagePct > 0.9 ? " hot" : "")}>
                <i style={{ width: Math.min(100, usagePct * 100) + "%" }} />
              </span>
            )}
            本月 {formatTokens(usage.spent)}
            {usage.budget > 0 ? " / " + formatTokens(usage.budget) : ""} tokens
          </button>
        ) : (
          <button className="link" onClick={() => setSettingsTab("ai")}>
            <Icon name="spark" size={12} />
            设置 AI 服务
          </button>
        )}
      </footer>

      {sel && view === "read" && (
        <div
          className="selbar"
          role="toolbar"
          aria-label="选区操作"
          style={{ left: Math.max(8, Math.min(sel.x - 170, innerWidth - 348)), top: sel.below ? sel.y : undefined, bottom: sel.below ? undefined : innerHeight - sel.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button className="main" title={`解释（${mod}+E）`} onClick={() => void run(sel.target)}>
            <Icon name="spark" size={15} />
            解释
          </button>
          <button
            onClick={() => {
              setSel(null);
              setOverview(null);
              setFailure(null);
              setDraft({ ...sel.target, focus: true });
              setPanel(true);
            }}
          >
            <Icon name="ask" size={15} />
            提问
          </button>
          {!sel.target.parent && (
            <>
              <span className="div" />
              {COLORS.map((c) => (
                <button key={c} className="swatch" title={`${COLOR_NAME[c]}色高亮`} style={{ ["--c" as any]: highlightColors[c] }} onClick={() => void annotate(sel.target, c, false)}>
                  <i />
                </button>
              ))}
              <button title="添加批注" onClick={() => void annotate(sel.target, "yellow", true)}>
                <Icon name="pen" size={15} />
              </button>
            </>
          )}
          <span className="div" />
          <button
            title="复制"
            onClick={() => {
              void navigator.clipboard.writeText(sel.target.anchor.quote);
              setSel(null);
              toast("已复制");
            }}
          >
            <Icon name="copy" size={15} />
          </button>
        </div>
      )}

      {note && (
        <NoteEditor
          note={note}
          exists={state.annotations.some((n) => n.id === note.id)}
          close={() => setNote(null)}
          save={async (n) => {
            try {
              await api.annotate(n);
              setNote(null);
              getSelection()?.removeAllRanges();
              await refresh();
            } catch (e) {
              toastError(e);
            }
          }}
          remove={async () => {
            await removeItem("annotations", note.id);
            setNote(null);
          }}
        />
      )}
      {palette !== null && (
        <Palette
          initial={palette}
          close={() => setPalette(null)}
          commands={commands}
          docId={doc?.id}
          docName={doc?.name}
          onHit={(h: SearchHit) => jump(h.doc, h.block)}
        />
      )}
      {settingsTab && (
        <SettingsDialog
          state={state}
          initialTab={settingsTab}
          close={() => setSettingsTab(null)}
          refresh={async () => {
            await refresh();
            setFailure((f) => (f?.settings ? null : f));
          }}
          theme={theme}
          setTheme={setTheme}
          prefs={prefs}
          setPrefs={setPrefsState}
        />
      )}
      <Menu state={menu} close={() => setMenu(null)} />
      {dragging && <div className="dropzone">松开即可导入</div>}
      <ConfirmHost />
      <Toasts />
    </>
  );
}

function DocRow({ d, active, open, menu }: { d: DocMeta; active: boolean; open: () => void; menu: (el: Element) => void }) {
  return (
    <div className={"doc-row" + (active ? " active" : "")} role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} onContextMenu={(e) => (e.preventDefault(), menu(e.currentTarget))}>
      <span className={"fmt " + d.format}>{fmtLabel(d.format)}</span>
      <span className="name" title={d.name}>
        {d.name.replace(/\.[^.]+$/, "")}
        {(d.reference || !d.cloud || d.pages) && (
          <small>
            {[d.pages ? d.pages + " 页" : "", d.reference ? "参考资料" : "", !d.cloud ? "仅本地" : ""].filter(Boolean).join("，")}
          </small>
        )}
      </span>
      <button
        className="icon-btn row-menu"
        aria-label="资料操作"
        onClick={(e) => {
          e.stopPropagation();
          menu(e.currentTarget);
        }}
      >
        <Icon name="more" size={14} />
      </button>
    </div>
  );
}

function NoteEditor({
  note,
  exists,
  close,
  save,
  remove,
}: {
  note: AnnotationType;
  exists: boolean;
  close: () => void;
  save: (n: AnnotationType) => void;
  remove: () => void;
}) {
  const [value, setValue] = useState(note);
  return (
    <Scrim onClose={close} label="批注">
      <div className="dialog">
        <h2>{exists ? "编辑批注" : "添加批注"}</h2>
        <blockquote style={{ ["--hl" as any]: highlightColors[value.color] }}>{note.anchor.quote}</blockquote>
        <div className="color-pick" role="group" aria-label="高亮颜色">
          {COLORS.map((c) => (
            <button key={c} aria-label={COLOR_NAME[c] + "色"} aria-pressed={value.color === c} style={{ ["--c" as any]: highlightColors[c] }} onClick={() => setValue({ ...value, color: c })} />
          ))}
        </div>
        <label className="field">
          <textarea
            autoFocus
            aria-label="批注内容"
            placeholder="写下你的想法…"
            value={value.note}
            onChange={(e) => setValue({ ...value, note: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && save(value)}
            style={{ minHeight: 110 }}
          />
        </label>
        <div className="actions">
          {exists && (
            <button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={remove}>
              删除
            </button>
          )}
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary" onClick={() => save(value)}>
            保存
          </button>
        </div>
      </div>
    </Scrim>
  );
}

function Welcome({ open }: { open: () => void }) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>读原著，不再卡在省略处</h1>
        <p className="lede">
          教材常常默认你知道某个前提、记得某一步推导。打开一本书，选中读不懂的句子，Subaudi 会在页边补上作者没写出的部分，再带你回到原句。
        </p>
        <button className="drop-target" onClick={open}>
          <Icon name="plus" size={28} />
          <span>
            <b>打开资料，或把文件拖到这里</b>
            <small>PDF、Word、PowerPoint、Markdown、TXT，可一次选多份</small>
          </span>
        </button>
        <ul className="steps">
          <li>
            <b>选中</b>划选任意词句，或按 {mod}+F 搜索原文
          </li>
          <li>
            <b>解释</b>补上前提、步骤和适用条件，并标出依据
          </li>
          <li>
            <b>追问</b>在解释里继续划选，层层深入
          </li>
        </ul>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
