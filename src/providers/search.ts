import { lookup } from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import type { Evidence } from "../contracts";
export interface SearchProvider {
  search(query: string, signal: AbortSignal): Promise<Evidence[]>;
}
export function publicAddress(ip: string) {
  if (isIP(ip) === 6)
    return !/^(::|fc|fd|fe80|ff)/i.test(ip) && !ip.includes(".");
  const n = ip.split(".").map(Number);
  return (
    n.length === 4 &&
    n[0] < 224 &&
    ![0, 10, 127, 169, 192, 224, 240, 255].includes(n[0]) &&
    !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
    !(n[0] === 198 && (n[1] === 18 || n[1] === 19))
  );
}
export async function pageText(
  raw: string,
  signal: AbortSignal,
  depth = 0,
): Promise<string> {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    depth > 3
  )
    throw Error("网页地址被拒绝");
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("禁止访问本地或私网网页");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        signal,
        timeout: 15000,
        lookup: ((_host: any, _opts: any, cb: any) =>
          cb(null, address.address, address.family)) as any,
        headers: { "User-Agent": "Subaudi/0.1 (reader research)" },
      },
      (r) => {
        if (
          r.statusCode &&
          r.statusCode >= 300 &&
          r.statusCode < 400 &&
          r.headers.location
        ) {
          r.resume();
          pageText(new URL(r.headers.location, u).href, signal, depth + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (
          r.statusCode !== 200 ||
          !r.headers["content-type"]?.includes("text/html")
        ) {
          r.resume();
          reject(Error("网页不是可读取 HTML"));
          return;
        }
        let text = "";
        r.on("data", (b) => {
          text += b;
          if (Buffer.byteLength(text) > 1500000) {
            req.destroy(Error("正文大小超限"));
          }
        });
        r.on("end", () =>
          resolve(
            text
              .replace(
                /<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,
                " ",
              )
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 18000),
          ),
        );
      },
    );
    req.on("timeout", () => req.destroy(Error("网页超时")));
    req.on("error", reject);
  });
}
export class SearXNG implements SearchProvider {
  constructor(private endpoint: string) {}
  async search(query: string, signal: AbortSignal) {
    if (!this.endpoint) throw Error("未配置 SearXNG，未联网核实");
    const u = new URL("/search", this.endpoint);
    u.searchParams.set("q", query);
    u.searchParams.set("format", "json");
    const response = await fetch(u, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      redirect: "error",
    });
    if (!response.ok) throw Error("SearXNG 不可用 HTTP " + response.status);
    const json = await response.json();
    if (!Array.isArray(json.results)) throw Error("搜索返回非法 JSON");
    const out: Evidence[] = [];
    for (const r of json.results.slice(0, 3)) {
      try {
        const excerpt = await pageText(r.url, signal);
        if (excerpt.length > 150)
          out.push({
            source_id: "W" + (out.length + 1),
            excerpt,
            url: r.url,
            title: String(r.title).slice(0, 200),
            verification: "retrieved_body",
          });
      } catch {
        if (signal.aborted) throw Error("搜索已取消");
      }
    }
    if (!out.length) throw Error("无可读取正文；搜索摘要不作为证据");
    return out;
  }
}
