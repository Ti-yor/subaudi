import type { AnchorType } from "../contracts";
export function readSelection(
  container: HTMLElement,
): { anchor: AnchorType; parent: string | null } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const blocks = [
    ...container.querySelectorAll<HTMLElement>("[data-block]"),
  ].filter((el) => range.intersectsNode(el));
  if (!blocks.length) return null;
  const artifact = blocks[0].dataset.artifact!,
    parent = blocks[0].dataset.explanation ?? null;
  if (blocks.some((b) => b.dataset.artifact !== artifact))
    throw Error("不能混合不同文档或解释版本");
  const segments: NonNullable<AnchorType["segments"]> = [];
  for (const block of blocks) {
    const full = document.createRange();
    full.selectNodeContents(block);
    const part = range.cloneRange();
    if (part.compareBoundaryPoints(Range.START_TO_START, full) < 0)
      part.setStart(full.startContainer, full.startOffset);
    if (part.compareBoundaryPoints(Range.END_TO_END, full) > 0)
      part.setEnd(full.endContainer, full.endOffset);
    const quote = part.toString();
    if (!quote.trim()) continue;
    const before = full.cloneRange();
    before.setEnd(part.startContainer, part.startOffset);
    const start = Array.from(before.toString()).length,
      end = start + Array.from(quote).length;
    const visible = Array.from(block.textContent ?? "");
    const segment: (typeof segments)[number] = {
      block: block.dataset.block!,
      start,
      end,
      quote,
      prefix: visible.slice(Math.max(0, start - 30), start).join(""),
      suffix: visible.slice(end, end + 30).join(""),
    };
    if (block.dataset.page !== undefined)
      segment.pageIndex = Number(block.dataset.page);
    const page = block.closest<HTMLElement>(".pdf-page");
    if (page?.dataset.ready === "false")
      throw Error("页面正在重绘，请稍后重新选取文字");
    if (page?.dataset.matrix && page.dataset.view) {
      const m = JSON.parse(page.dataset.matrix) as number[],
        v = JSON.parse(page.dataset.view) as number[],
        origin = page.getBoundingClientRect();
      const point = (x: number, y: number) => {
        x -= origin.left + m[4];
        y -= origin.top + m[5];
        const det = m[0] * m[3] - m[1] * m[2];
        const px = (m[3] * x - m[2] * y) / det,
          py = (-m[1] * x + m[0] * y) / det;
        return [(px - v[0]) / (v[2] - v[0]), (v[3] - py) / (v[3] - v[1])];
      };
      const clamp = (n: number) => Math.max(0, Math.min(1, n));
      const rectangles: DOMRect[] = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.trim() || !part.intersectsNode(node)) continue;
        const sub = document.createRange();
        sub.selectNodeContents(node);
        if (sub.compareBoundaryPoints(Range.START_TO_START, part) < 0)
          sub.setStart(part.startContainer, part.startOffset);
        if (sub.compareBoundaryPoints(Range.END_TO_END, part) > 0)
          sub.setEnd(part.endContainer, part.endOffset);
        if (sub.toString().trim()) rectangles.push(...sub.getClientRects());
      }
      segment.rects = rectangles
        .filter((r) => r.width && r.height)
        .slice(0, 100)
        .map((r) => {
          const a = point(r.left, r.top),
            b = point(r.right, r.bottom);
          return [
            clamp(Math.min(a[0], b[0])),
            clamp(Math.min(a[1], b[1])),
            clamp(Math.max(a[0], b[0])),
            clamp(Math.max(a[1], b[1])),
          ];
        });
      segment.coordinateSpace = "page-normalized-unrotated-top-left";
    }
    segments.push(segment);
  }
  if (!segments.length) return null;
  if (segments.length > 20) throw Error("选区超过20块，请缩小本次问题范围");
  const first = segments[0];
  return {
    anchor: {
      doc: artifact,
      block: first.block,
      start: first.start,
      end: first.end,
      quote: segments.map((s) => s.quote).join("\n"),
      segments,
    },
    parent,
  };
}
