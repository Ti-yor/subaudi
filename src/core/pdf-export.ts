import { PDFDocument, PDFName, PDFHexString } from "pdf-lib";
import type { AnnotationType } from "../contracts";
const colors = {
  yellow: [1, 0.82, 0.1],
  green: [0.3, 0.8, 0.4],
  blue: [0.3, 0.65, 1],
  pink: [1, 0.4, 0.65],
};
export async function annotatedPdf(bytes: Uint8Array, notes: AnnotationType[]) {
  const pdf = await PDFDocument.load(bytes);
  for (const note of notes)
    for (const segment of note.anchor.segments ?? []) {
      if (segment.pageIndex === undefined || !segment.rects?.length) continue;
      const page = pdf.getPage(segment.pageIndex),
        crop = page.getCropBox();
      const media = page.getMediaBox();
      const x0 = Math.max(crop.x, media.x),
        y0 = Math.max(crop.y, media.y);
      const w = Math.min(crop.x + crop.width, media.x + media.width) - x0,
        h = Math.min(crop.y + crop.height, media.y + media.height) - y0;
      const rects = segment.rects.map(([l, t, r, b]) => [
        x0 + l * w,
        y0 + (1 - b) * h,
        x0 + r * w,
        y0 + (1 - t) * h,
      ]);
      const xs = rects.flatMap((r) => [r[0], r[2]]),
        ys = rects.flatMap((r) => [r[1], r[3]]);
      const annotation = pdf.context.obj({
        Type: "Annot",
        Subtype: "Highlight",
        Rect: [
          Math.min(...xs),
          Math.min(...ys),
          Math.max(...xs),
          Math.max(...ys),
        ],
        QuadPoints: rects.flatMap(([l, b, r, t]) => [l, t, r, t, l, b, r, b]),
        C: colors[note.color],
        CA: 0.35,
        F: 4,
        T: PDFHexString.fromText("Subaudi"),
        Contents: PDFHexString.fromText(note.note || segment.quote),
        NM: PDFHexString.fromText(note.id + ":" + segment.pageIndex),
      });
      page.node.addAnnot(pdf.context.register(annotation));
    }
  return pdf.save();
}
