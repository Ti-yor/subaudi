import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { Block, Doc, AnnotationType } from "../contracts";
import { PdfPage } from "./PdfPage";
import { Icon } from "./icons";
import { Menu, menuAt, type MenuState, errText, toast, toastError, mod } from "./kit";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", location.href).href;
const api = window.subaudi;
export type ReaderStatus = { text: string; active: boolean; action?: { label: string; run: () => void } } | null;
const ZOOMS = [50, 75, 100, 125, 150, 200, 300];

export function Pdf({
  doc,
  annotations,
  onNote,
  onOverview,
  onDoc,
  onStatus,
  outlineOpen,
  setOutlineOpen,
}: {
  doc: Doc;
  annotations: AnnotationType[];
  onNote: (n: AnnotationType) => void;
  onOverview: (block?: string) => void;
  onDoc: (d: Doc) => void;
  onStatus: (s: ReaderStatus) => void;
  outlineOpen: boolean;
  setOutlineOpen: (v: boolean) => void;
}) {
  const surface = useRef<HTMLDivElement>(null),
    pdf = useRef<any>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const [page, setPage] = useState(Number(localStorage.getItem("pdf-page-" + doc.id)) || 1),
    [pageInput, setPageInput] = useState(String(page));
  const requestedPage = useRef(page);
  requestedPage.current = page;
  const [count, setCount] = useState(0),
    [scale, setScale] = useState(1),
    [fit, setFit] = useState<"width" | "page" | "manual">(
      (localStorage.getItem("pdf-fit") as any) || "width",
    ),
    [rotation, setRotation] = useState(0);
  const [mode, setMode] = useState(localStorage.getItem("pdf-mode") || "continuous"),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [base, setBase] = useState([612, 792]);
  const [outline, setOutline] = useState<any[]>([]),
    [history, setHistory] = useState<number[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>(() =>
    JSON.parse(localStorage.getItem("pdf-bookmarks-" + doc.id) || "[]"),
  );
  const [menu, setMenu] = useState<MenuState>(null);
  const [transcript, setTranscript] = useState(false),
    [editing, setEditing] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState<number | null>(null);
  const [scanned, setScanned] = useState<Set<number>>(
    () => new Set(doc.blocks.filter((b) => !b.text.trim() && !b.regions).map((b) => b.page!)),
  );
  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null);
  const batchStop = useRef(false);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const indexed = useRef(new Set(doc.blocks.map((b) => b.page))),
    enriched = useRef(
      new Set(
        doc.blocks
          .filter((b) => b.readingText !== undefined || b.regions || b.issues.some((i) => i.startsWith("人工修订")))
          .map((b) => b.page),
      ),
    );
  const ensurePage = useRef<(n: number, enrich?: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    const observer = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    observer.observe(surface.current!);
    return () => observer.disconnect();
  }, []);
  const actualScale =
    fit === "manual"
      ? scale
      : fit === "page"
        ? Math.min(Math.max(100, size.width - 48) / base[0], Math.max(100, size.height - 48) / base[1])
        : Math.min(Math.max(100, size.width - 48) / base[0], 3);
  const pendingGo = useRef<number | null>(null);
  const scrollAnchor = useRef({ page, fraction: 0 });
  const pageEl = (n: number) => surface.current?.querySelector<HTMLElement>('[data-page-number="' + n + '"]');
  const go = (n: number, remember = false) => {
    n = Math.max(1, Math.min(count || 1, n));
    if (remember && n !== page) setHistory((h) => [...h.slice(-30), page]);
    pendingGo.current = n;
    scrollAnchor.current = { page: n, fraction: 0 };
    setPage(n);
    requestAnimationFrame(() => {
      const el = pageEl(n);
      if (el) {
        surface.current!.scrollTop = el.offsetTop - 24;
        pendingGo.current = null;
      }
    });
  };
  useEffect(() => {
    localStorage.setItem("pdf-page-" + doc.id, String(page));
    setPageInput(String(page));
  }, [page, doc.id]);
  useEffect(() => {
    if (count) go(page);
  }, [count, mode]);
  useEffect(() => {
    const fn = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.doc !== doc.id) return;
      go(d.page + 1, true);
      setTimeout(() => {
        const el = pageEl(d.page + 1);
        el?.classList.add("located");
        setTimeout(() => el?.classList.remove("located"), 1600);
      }, 120);
    };
    addEventListener("subaudi-page", fn);
    return () => removeEventListener("subaudi-page", fn);
  }, [count, page, mode, doc.id]);
  const zoomFocus = useRef<{ page: number; x: number; y: number; cx: number; cy: number } | null>(null);
  useLayoutEffect(() => {
    if (zoomFocus.current) return;
    const anchor = scrollAnchor.current,
      el = pageEl(anchor.page);
    if (el) surface.current!.scrollTop = el.offsetTop + anchor.fraction * el.offsetHeight;
  }, [actualScale, rotation]);
  const zoomTo = (value: number, cx?: number, cy?: number) => {
    const outer = surface.current!.getBoundingClientRect(),
      el = pageEl(page);
    if (el) {
      const r = el.getBoundingClientRect(),
        x = cx ?? outer.left + outer.width / 2,
        y = cy ?? outer.top + outer.height / 2;
      zoomFocus.current = {
        page,
        x: (x - r.left) / r.width,
        y: (y - r.top) / r.height,
        cx: x - outer.left,
        cy: y - outer.top,
      };
    }
    setFit("manual");
    setScale(Math.max(0.25, Math.min(5, value)));
  };
  useEffect(() => {
    const f = zoomFocus.current;
    if (!f) return;
    zoomFocus.current = null;
    requestAnimationFrame(() => {
      const el = pageEl(f.page);
      if (!el) return;
      const r = el.getBoundingClientRect(),
        s = surface.current!.getBoundingClientRect();
      surface.current!.scrollBy(r.left + f.x * r.width - s.left - f.cx, r.top + f.y * r.height - s.top - f.cy);
    });
  }, [actualScale]);
  useEffect(() => localStorage.setItem("pdf-fit", fit), [fit]);
  useEffect(() => {
    const el = surface.current!;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomTo(actualScale * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
      }
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable=true],.margin,.scrim,.menu") || document.querySelector(".scrim"))
        return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        if (e.key === "0") setFit("width");
        else zoomTo(actualScale * (e.key === "-" ? 1 / 1.15 : 1.15));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        go(page + (e.key === "ArrowRight" ? 1 : -1));
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        go(e.key === "Home" ? 1 : count);
      } else if (["PageDown", "PageUp", " "].includes(e.key) && !t.closest("button")) {
        e.preventDefault();
        const dir = e.key === "PageUp" || (e.key === " " && e.shiftKey) ? -1 : 1;
        if (mode === "single") go(page + dir);
        else el.scrollBy({ top: dir * el.clientHeight * 0.88, behavior: "smooth" });
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    addEventListener("keydown", key);
    return () => {
      el.removeEventListener("wheel", wheel);
      removeEventListener("keydown", key);
    };
  }, [actualScale, page, count, mode]);
  const follow = async (dest: any) => {
    const d = typeof dest === "string" ? await pdf.current.getDestination(dest) : dest;
    if (!d) throw Error("链接目标不存在");
    go((typeof d[0] === "number" ? d[0] : await pdf.current.getPageIndex(d[0])) + 1, true);
  };
  const commitPage = () => {
    const n = Math.max(1, Math.min(count, Number(pageInput) || page));
    go(n, true);
    setPageInput(String(n));
  };

  /* load + background text extraction */
  useEffect(() => {
    let stopped = false;
    let loading: ReturnType<typeof pdfjs.getDocument> | undefined;
    const pending = new Map<number, Promise<void>>();
    (async () => {
      const data = await api.pdf(doc.id);
      if (stopped) return;
      loading = pdfjs.getDocument({
        data,
        cMapUrl: new URL("./cmaps/", location.href).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("./standard_fonts/", location.href).href,
        wasmUrl: new URL("./wasm/", location.href).href,
      });
      const p = await loading.promise;
      if (stopped) return;
      pdf.current = p;
      const initial = Math.min(Math.max(requestedPage.current, 1), p.numPages);
      setPage(initial);
      const first = await p.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      setBase([viewport.width, viewport.height]);
      setCount(p.numPages);
      void p.getOutline().then((items: any[]) => !stopped && setOutline(items ?? []), () => {});
      const extract = async (number: number): Promise<Block> => {
        const pg = await p.getPage(number);
        const content = await pg.getTextContent();
        const items = content.items.filter((item: any) => typeof item.str === "string") as any[];
        const text = items.map((item) => item.str).join("");
        return {
          id: "p" + number,
          page: number - 1,
          kind: "paragraph",
          text,
          readingText: items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join(""),
          locator: "第 " + number + " 页",
          issues: text.trim() ? [] : ["扫描页"],
        };
      };
      ensurePage.current = (number, enrich = false) => {
        if (indexed.current.has(number - 1) && (!enrich || enriched.current.has(number - 1))) return Promise.resolve();
        if (pending.has(number)) return pending.get(number)!;
        const task = (async () => {
          const block = await extract(number);
          if (stopped) return;
          await api.index(doc.id, [block], p.numPages);
          indexed.current.add(number - 1);
          enriched.current.add(number - 1);
          if (!block.text.trim()) setScanned((s) => new Set(s).add(number - 1));
        })().finally(() => pending.delete(number));
        pending.set(number, task);
        return task;
      };
      await ensurePage.current(initial, true);
      if (stopped) return;
      const missing = p.numPages - indexed.current.size;
      if (missing > 0) setIndexing({ done: indexed.current.size, total: p.numPages });
      let pageBatch: Block[] = [];
      const found: number[] = [];
      for (let i = 1; i <= p.numPages; i++) {
        if (stopped) return;
        if (!indexed.current.has(i - 1)) {
          const b = await extract(i);
          pageBatch.push(b);
          if (!b.text.trim()) found.push(i - 1);
        }
        if (pageBatch.length >= 48 || (i === p.numPages && pageBatch.length)) {
          await api.index(doc.id, pageBatch, p.numPages);
          for (const b of pageBatch) {
            indexed.current.add(b.page!);
            enriched.current.add(b.page!);
          }
          pageBatch = [];
          if (!stopped) setIndexing({ done: indexed.current.size, total: p.numPages });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (stopped) return;
      if (found.length) setScanned((s) => new Set([...s, ...found]));
      if (missing > 0 || doc.pages !== p.numPages) {
        await api.index(doc.id, [], p.numPages);
        onDoc(await api.doc(doc.id));
      }
      setIndexing(null);
    })().catch((e) => {
      if (!stopped) toastError(e);
    });
    return () => {
      stopped = true;
      void loading?.destroy();
      pdf.current = null;
    };
  }, [doc.id]);

  /* OCR */
  const pendingScans = [...scanned].filter((n) => !doc.blocks.find((b) => b.page === n)?.regions).sort((a, b) => a - b);
  const ocr = async (pageIndex: number, quiet = false) => {
    setOcrBusy(pageIndex);
    try {
      await ensurePage.current(pageIndex + 1);
      const updated = await api.ocr(doc.id, pageIndex);
      setScanned((s) => {
        const n = new Set(s);
        n.delete(pageIndex);
        return n;
      });
      onDoc(updated);
      if (!quiet) toast(`第 ${pageIndex + 1} 页已识别，可以直接选取文字`);
      return true;
    } catch (e) {
      if (!quiet) toastError(e);
      return false;
    } finally {
      setOcrBusy(null);
    }
  };
  const ocrAll = async () => {
    const queue = [...pendingScans];
    batchStop.current = false;
    let done = 0,
      failed = 0;
    setBatch({ done, total: queue.length });
    for (const n of queue) {
      if (batchStop.current) break;
      if (!(await ocr(n, true))) failed++;
      setBatch({ done: ++done, total: queue.length });
    }
    setBatch(null);
    toast(batchStop.current ? `已停止，识别了 ${done} 页` : `已识别 ${done - failed} 页${failed ? `，${failed} 页失败` : ""}`);
  };
  useEffect(() => {
    if (batch)
      onStatus({
        text: `正在识别扫描页 ${batch.done}/${batch.total}`,
        active: true,
        action: {
          label: "停止",
          run: () => {
            batchStop.current = true;
            void api.cancel();
          },
        },
      });
    else if (indexing)
      onStatus({ text: `正在建立文字索引 ${indexing.done}/${indexing.total} 页`, active: true });
    else if (ocrBusy !== null) onStatus({ text: `正在识别第 ${ocrBusy + 1} 页`, active: true });
    else if (pendingScans.length)
      onStatus({
        text: `${pendingScans.length} 页是扫描图像，暂不能选取文字`,
        active: false,
        action: { label: "全部识别", run: () => void ocrAll() },
      });
    else onStatus(count ? { text: `${count} 页 · 文字索引完成`, active: false } : null);
  }, [batch, indexing, ocrBusy, pendingScans.length, count]);
  useEffect(() => () => onStatus(null), []);

  const toggleBookmark = (n = page) => {
    const next = bookmarks.includes(n) ? bookmarks.filter((x) => x !== n) : [...bookmarks, n].sort((a, b) => a - b);
    setBookmarks(next);
    localStorage.setItem("pdf-bookmarks-" + doc.id, JSON.stringify(next));
  };
  const renderOutline = (items: any[], lvl = 0): React.ReactNode =>
    items.map((item, i) => (
      <React.Fragment key={lvl + ":" + i}>
        <button
          className="lvl"
          style={{ ["--lvl" as any]: lvl }}
          onClick={() => void (item.url ? api.external(item.url) : follow(item.dest)).catch((e) => toast(errText(e), { kind: "error" }))}
        >
          {item.title}
        </button>
        {item.items?.length > 0 && lvl < 3 && renderOutline(item.items, lvl + 1)}
      </React.Fragment>
    ));
  const block = doc.blocks.find((b) => b.page === page - 1);
  const zoomPct = Math.round(actualScale * 100);
  return (
    <>
      <div className="reader-bar" role="toolbar" aria-label="PDF 工具">
        <button className="icon-btn" title="目录与书签" aria-pressed={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}>
          <Icon name="toc" />
        </button>
        <button
          className="icon-btn"
          title="返回跳转前的位置"
          disabled={!history.length}
          onClick={() => {
            go(history[history.length - 1]);
            setHistory((h) => h.slice(0, -1));
          }}
        >
          <Icon name="back" />
        </button>
        <span className="sep" />
        <button className="icon-btn" title="上一页（←）" disabled={page <= 1} onClick={() => go(page - 1)}>
          <Icon name="chevronL" />
        </button>
        <input
          className="page-input"
          aria-label="页码"
          type="number"
          min={1}
          max={count || 1}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setPageInput(String(page));
          }}
        />
        <span className="label">/ {count || "…"}</span>
        <button className="icon-btn" title="下一页（→）" disabled={page >= count} onClick={() => go(page + 1)}>
          <Icon name="chevronR" />
        </button>
        <span className="sep" />
        <button className="icon-btn" title={`缩小（${mod}+−）`} onClick={() => zoomTo(actualScale / 1.15)}>
          <Icon name="zoomOut" />
        </button>
        <select
          className="zoom-select"
          aria-label="缩放"
          value={fit === "manual" ? String(zoomPct) : fit}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "width" || v === "page") setFit(v);
            else zoomTo(Number(v) / 100);
          }}
        >
          <option value="width">适合宽度</option>
          <option value="page">整页</option>
          {[...new Set([...ZOOMS, ...(fit === "manual" ? [zoomPct] : [])])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
        </select>
        <button className="icon-btn" title={`放大（${mod}+＋）`} onClick={() => zoomTo(actualScale * 1.15)}>
          <Icon name="zoomIn" />
        </button>
        <span className="grow" />
        <button
          className={"icon-btn" + (bookmarks.includes(page) ? " on" : "")}
          title={bookmarks.includes(page) ? "移除本页书签" : "为本页加书签"}
          onClick={() => toggleBookmark()}
        >
          <Icon name="bookmark" />
        </button>
        <button className="btn ghost" title="AI 导读：这一部分在讲什么、可能卡在哪" onClick={() => onOverview(block?.id)}>
          <Icon name="guide" />
          导读
        </button>
        <button
          className="icon-btn"
          title="更多"
          aria-haspopup="menu"
          onClick={(e) =>
            setMenu(
              menuAt(
                e.currentTarget,
                [
                  { label: "连续滚动", icon: "layers", checked: mode === "continuous", onClick: () => (setMode("continuous"), localStorage.setItem("pdf-mode", "continuous")) },
                  { label: "单页", icon: "file", checked: mode === "single", onClick: () => (setMode("single"), localStorage.setItem("pdf-mode", "single")) },
                  { label: "旋转页面", icon: "rotate", onClick: () => (setRotation((r) => (r + 90) % 360), setBase((b) => [b[1], b[0]])) },
                  "sep",
                  { label: "本页文字", icon: "text", onClick: () => setTranscript(true) },
                  {
                    label: block?.regions ? "本页已识别" : block?.text.trim() ? "重新识别本页文字" : "识别本页文字",
                    icon: "scan",
                    disabled: ocrBusy !== null || !!block?.regions,
                    onClick: () => void ocr(page - 1),
                  },
                  ...(pendingScans.length > 1 ? [{ label: `识别全部 ${pendingScans.length} 个扫描页`, icon: "scan" as const, onClick: () => void ocrAll() }] : []),
                  "sep",
                  {
                    label: "导出带批注的 PDF",
                    icon: "download",
                    onClick: () =>
                      void api.savePdf(doc.id).then((p) => p && toast("已保存到 " + p), toastError),
                  },
                  { label: "用系统程序打开", icon: "external", onClick: () => void api.original(doc.id).catch(toastError) },
                ],
                "right",
              ),
            )
          }
        >
          <Icon name="more" />
        </button>
      </div>
      <div className="reader-body">
        {outlineOpen && (
          <nav className="outline" aria-label="目录与书签">
            <h4>目录</h4>
            {outline.length ? renderOutline(outline) : <p className="empty-side">这份 PDF 没有内置目录。</p>}
            <h4>书签</h4>
            {bookmarks.length ? (
              bookmarks.map((n) => (
                <button key={n} className={n === page ? "current" : ""} onClick={() => go(n, true)} onContextMenu={(e) => (e.preventDefault(), toggleBookmark(n))}>
                  第 {n} 页
                </button>
              ))
            ) : (
              <p className="empty-side">点工具栏的书签图标为当前页加书签。</p>
            )}
          </nav>
        )}
        <div
          ref={surface}
          className="scroll pdf-scroll"
          aria-label="PDF 页面"
          onScroll={() => {
            if (mode !== "continuous") return;
            const el = surface.current!;
            const target = el.scrollTop + Math.min(120, el.clientHeight * 0.25);
            const pages = el.querySelectorAll<HTMLElement>("[data-page-number]");
            let lo = 0,
              hi = pages.length - 1;
            while (lo < hi) {
              const mid = Math.ceil((lo + hi) / 2);
              if (pages[mid].offsetTop <= target) lo = mid;
              else hi = mid - 1;
            }
            if (pages[lo]) {
              scrollAnchor.current = {
                page: Number(pages[lo].dataset.pageNumber),
                fraction: (el.scrollTop - pages[lo].offsetTop) / pages[lo].offsetHeight,
              };
              setPage(Number(pages[lo].dataset.pageNumber));
            }
          }}
        >
          {pdf.current &&
            Array.from({ length: mode === "continuous" ? count : Math.min(count, 1) }, (_, i) =>
              mode === "continuous" ? i + 1 : page,
            ).map((n) => (
              <PdfPage
                key={n}
                pdf={pdf.current}
                doc={doc}
                number={n}
                scale={actualScale}
                rotation={rotation}
                dimensions={base}
                surface={surface}
                scanned={scanned.has(n - 1)}
                ocrBusy={ocrBusy === n - 1}
                onOcr={() => void ocr(n - 1)}
                ensurePage={(x, enrich) => ensurePage.current(x, enrich)}
                onReady={(x) => {
                  if (pendingGo.current === x) {
                    const el = pageEl(x);
                    if (el) surface.current!.scrollTop = el.offsetTop - 24;
                    pendingGo.current = null;
                  }
                }}
                onError={(e) => toast(e, { kind: "error" })}
                onLink={follow}
                annotations={annotations}
                onNote={onNote}
              />
            ))}
          {!count && (
            <div className="loading-screen" style={{ height: "60vh" }}>
              <span className="spinner" />
            </div>
          )}
        </div>
        {transcript && (
          <section className="transcript" aria-label="本页文字">
            <header>
              第 {page} 页文字
              <span className="grow" />
              {editing === null ? (
                <button className="btn ghost" disabled={!block} onClick={() => setEditing(block?.text ?? "")}>
                  <Icon name="pen" />
                  修正
                </button>
              ) : (
                <>
                  <button className="btn ghost" onClick={() => setEditing(null)}>
                    取消
                  </button>
                  <button
                    className="btn primary"
                    disabled={!editing.trim()}
                    onClick={async () => {
                      try {
                        onDoc(await api.correct(doc.id, block!.id, editing));
                        setEditing(null);
                        toast("本页文字已更新");
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    保存
                  </button>
                </>
              )}
              <button className="icon-btn" aria-label="关闭" onClick={() => (setTranscript(false), setEditing(null))}>
                <Icon name="close" />
              </button>
            </header>
            {editing !== null ? (
              <div className="body">
                <textarea autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="修正本页文字" />
              </div>
            ) : (
              <div className="body" data-artifact={doc.id} data-block={block?.id}>
                {block?.text || "这一页没有可选取的文字。可以在“更多”菜单里识别本页文字。"}
              </div>
            )}
          </section>
        )}
      </div>
      <Menu state={menu} close={() => setMenu(null)} />
    </>
  );
}
