import React, { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { Doc, AnnotationType } from "../contracts";
export const highlightColors = {
  yellow: "#ffd23f",
  green: "#6fd08a",
  blue: "#6fb2f2",
  pink: "#f58fb3",
};
export function PdfPage({
  pdf,
  doc,
  number,
  scale,
  rotation,
  dimensions,
  surface,
  ensurePage,
  scanned,
  ocrBusy,
  onOcr,
  onReady,
  onError,
  onLink,
  annotations,
  onNote,
}: {
  pdf: any;
  doc: Doc;
  number: number;
  scale: number;
  rotation: number;
  dimensions: number[];
  surface: React.RefObject<HTMLDivElement | null>;
  ensurePage: (n: number, enrich?: boolean) => Promise<void>;
  scanned: boolean;
  ocrBusy: boolean;
  onOcr: () => void;
  onReady: (n: number) => void;
  onError: (e: string) => void;
  onLink: (dest: any) => Promise<void>;
  annotations: AnnotationType[];
  onNote: (note: AnnotationType) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [viewport, setViewport] = useState<any>(null);
  const [base, setBase] = useState(dimensions);
  const pageBlock = doc.blocks.find((b) => b.page === number - 1);
  // Re-render the text layer when this page's text changes (OCR / correction).
  const textSig = pageBlock ? `${pageBlock.text.length}:${pageBlock.regions?.length ?? -1}:${pageBlock.issues.join()}` : "";
  useEffect(() => setBase(dimensions), [dimensions, rotation]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
        else if (
          !host.current?.contains(window.getSelection()?.anchorNode ?? null) &&
          !host.current?.contains(window.getSelection()?.focusNode ?? null)
        )
          setVisible(false);
      },
      { root: surface.current, rootMargin: "1200px 0px" },
    );
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !pdf) return;
    let cancelled = false,
      task: any,
      layer: any;
    const el = host.current!,
      content = el.querySelector(".page-content")!;
    el.dataset.ready = "false";
    (async () => {
      const pg = await pdf.getPage(number);
      if (cancelled) return;
      const unit = pg.getViewport({ scale: 1, rotation });
      setBase([unit.width, unit.height]);
      const view = pg.getViewport({ scale, rotation });
      // Build off-DOM so a scale change does not expose a half-built selectable layer.
      const fragment = document.createElement("div");
      const canvas = document.createElement("canvas"),
        ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(view.width * ratio);
      canvas.height = Math.floor(view.height * ratio);
      canvas.style.width = view.width + "px";
      canvas.style.height = view.height + "px";
      fragment.append(canvas);
      task = pg.render({
        canvasContext: canvas.getContext("2d")!,
        viewport: view,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await task.promise;
      await ensurePage(number, true);
      if (cancelled) return;
      const text = document.createElement("div");
      text.className = "textLayer";
      text.dataset.block = "p" + number;
      text.dataset.page = String(number - 1);
      text.dataset.artifact = doc.id;
      fragment.append(text);
      const block = pageBlock;
      if (block?.regions) {
        text.className = "ocr-layer";
        block.regions.forEach((region, i) => {
          const rect = project(region.rect, view.transform, pg.view),
            span = document.createElement("span");
          span.textContent = region.text;
          Object.assign(span.style, {
            ...rect,
            fontSize: Math.max(6, parseFloat(rect.height) * 0.85) + "px",
          });
          if (i) text.append(document.createTextNode("\n"));
          text.append(span);
        });
      } else if (!block?.issues.some((i) => i.startsWith("人工修订"))) {
        layer = new pdfjs.TextLayer({
          textContentSource: await pg.getTextContent(),
          container: text,
          viewport: view,
        });
        await layer.render();
      }
      if (cancelled) return;
      const links = document.createElement("div");
      links.className = "pdf-links";
      for (const a of await pg.getAnnotations({ intent: "display" })) {
        const comment = a.contentsObj?.str || a.contents;
        if (a.subtype !== "Link" && comment && a.rect) {
          const [x0, y0, x1, y1] = pg.view,
            r = a.rect;
          const position = project(
            [
              (r[0] - x0) / (x1 - x0),
              (y1 - r[3]) / (y1 - y0),
              (r[2] - x0) / (x1 - x0),
              (y1 - r[1]) / (y1 - y0),
            ],
            view.transform,
            pg.view,
          );
          const detail = document.createElement("details");
          detail.className = "native-note";
          Object.assign(detail.style, {
            left: position.left,
            top: position.top,
          });
          const summary = document.createElement("summary");
          summary.textContent = "";
          summary.setAttribute("aria-label", "查看 PDF 批注");
          const body = document.createElement("p");
          body.textContent = comment;
          detail.append(summary, body);
          links.append(detail);
          continue;
        }
        if (a.subtype !== "Link" || (!a.url && !a.dest)) continue;
        const link = document.createElement("a");
        link.href = a.url || "#page";
        link.title = a.url || "跳转到引用页";
        link.setAttribute("aria-label", link.title);
        const [x0, y0, x1, y1] = pg.view,
          r = a.rect;
        Object.assign(
          link.style,
          project(
            [
              (r[0] - x0) / (x1 - x0),
              (y1 - r[3]) / (y1 - y0),
              (r[2] - x0) / (x1 - x0),
              (y1 - r[1]) / (y1 - y0),
            ],
            view.transform,
            pg.view,
          ),
        );
        link.onclick = (e) => {
          e.preventDefault();
          if (!window.getSelection()?.isCollapsed) return;
          void (a.url ? window.subaudi.external(a.url) : onLink(a.dest)).catch(
            (e) => onError(String(e)),
          );
        };
        links.append(link);
      }
      fragment.append(links);
      if (cancelled) return;
      const selection = window.getSelection();
      let saved: { start: number; end: number } | undefined;
      const old = content.querySelector("[data-block]");
      if (
        old &&
        selection?.rangeCount &&
        old.contains(selection.anchorNode) &&
        old.contains(selection.focusNode)
      ) {
        const range = selection.getRangeAt(0),
          before = document.createRange();
        before.selectNodeContents(old);
        before.setEnd(range.startContainer, range.startOffset);
        saved = {
          start: before.toString().length,
          end: before.toString().length + range.toString().length,
        };
      }
      el.dataset.matrix = JSON.stringify(view.transform);
      el.dataset.view = JSON.stringify(pg.view);
      el.style.setProperty("--scale-factor", String(scale));
      el.style.setProperty("--total-scale-factor", String(scale * pg.userUnit));
      el.style.setProperty("--scale-round-x", "1px");
      el.style.setProperty("--scale-round-y", "1px");
      setViewport({ transform: view.transform, view: pg.view });
      content.replaceChildren(...fragment.childNodes);
      if (saved) {
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT),
          range = document.createRange();
        let n: Node | null,
          offset = 0,
          started = false;
        while ((n = walker.nextNode())) {
          const len = n.textContent?.length ?? 0;
          if (!started && saved.start <= offset + len) {
            range.setStart(n, saved.start - offset);
            started = true;
          }
          if (started && saved.end <= offset + len) {
            range.setEnd(n, saved.end - offset);
            selection?.removeAllRanges();
            selection?.addRange(range);
            break;
          }
          offset += len;
        }
      }
      el.dataset.ready = "true";
      onReady(number);
    })().catch((e) => {
      if (!cancelled) onError(String(e));
    });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      el.dataset.ready = "false";
    };
  }, [visible, pdf, number, scale, rotation, doc.id, textSig]);
  useEffect(() => {
    if (!visible)
      host.current?.querySelector(".page-content")?.replaceChildren();
  }, [visible]);
  return (
    <div
      ref={host}
      className="pdf-page"
      data-page-number={number}
      style={{ width: base[0] * scale, height: base[1] * scale }}
    >
      <div className="page-content" />
      {!visible && <span className="page-num">{number}</span>}
      {visible && scanned && !pageBlock?.regions && (
        <div className="scan-chip">
          这一页是图片，暂不能选取文字
          <button disabled={ocrBusy} onClick={onOcr}>
            {ocrBusy ? "识别中…" : "识别文字"}
          </button>
        </div>
      )}
      {viewport && (
        <div className="highlight-layer">
          {annotations
            .filter(
              (note) =>
                note.note &&
                note.anchor.segments?.some((s) => s.pageIndex === number - 1),
            )
            .map((note) => {
              const rect = note.anchor.segments!.find(
                (s) => s.pageIndex === number - 1,
              )?.rects?.[0];
              if (!rect) return null;
              const style = project(rect, viewport.transform, viewport.view);
              return (
                <button
                  key={"note-" + note.id}
                  className="note-pin"
                  aria-label={"编辑批注：" + note.note}
                  title={note.note}
                  onClick={() => onNote(note)}
                  style={{ left: style.left, top: style.top }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h9" /></svg>
                </button>
              );
            })}
          {annotations.flatMap((note) =>
            (note.anchor.segments ?? [])
              .filter((s) => s.pageIndex === number - 1)
              .flatMap((s) =>
                (s.rects ?? []).map((r, i) => (
                  <i
                    key={note.id + ":" + i}
                    className="hl"
                    style={{
                      ...project(r, viewport.transform, viewport.view),
                      background: highlightColors[note.color],
                    }}
                  />
                )),
              ),
          )}
        </div>
      )}
    </div>
  );
}
function project(rect: number[], m: number[], v: number[]) {
  const [l, t, r, b] = rect,
    [x0, y0, x1, y1] = v;
  const points = [
    [x0 + l * (x1 - x0), y1 - t * (y1 - y0)],
    [x0 + r * (x1 - x0), y1 - b * (y1 - y0)],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return {
    left: Math.min(points[0][0], points[1][0]) + "px",
    top: Math.min(points[0][1], points[1][1]) + "px",
    width: Math.abs(points[1][0] - points[0][0]) + "px",
    height: Math.abs(points[1][1] - points[0][1]) + "px",
  };
}
