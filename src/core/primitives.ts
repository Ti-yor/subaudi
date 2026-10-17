import { createHash } from "node:crypto";
export const hash = (v: unknown) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
export const cpSlice = (s: string, a: number, b: number) =>
  Array.from(s).slice(a, b).join("");
export function verifyAnchor(
  text: string,
  a: { start: number; end: number; quote: string },
) {
  if (a.end <= a.start || cpSlice(text, a.start, a.end) !== a.quote)
    throw Error("定位失败：选区与不可变原文不一致，请重新划选");
}
export class Flights {
  private active = new Map<string, Promise<any>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.active.get(key);
    if (existing) return existing;
    const p = fn().finally(() => this.active.delete(key));
    this.active.set(key, p);
    return p;
  }
}
/**
 * Conservative token estimate. The old code reserved one token per UTF-8 byte,
 * i.e. ~3 tokens per Chinese character, which exhausted budgets ~3x too early.
 */
export function estimateTokens(text: string) {
  let cjk = 0;
  for (const ch of text) if (ch.charCodeAt(0) > 0x2e7f) cjk++;
  return Math.ceil(cjk * 1.1 + (text.length - cjk) / 3.2);
}
