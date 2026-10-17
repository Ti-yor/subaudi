import { DatabaseSync } from "node:sqlite";
import type { Doc } from "../contracts";
import { migrations } from "./migrations";
export function searchTokens(text: string) {
  return (text.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]/gu) ?? []).join(
    " ",
  );
}
export class Store {
  db!: DatabaseSync;
  constructor(private path: string) {}
  async init(_wasm?: string) {
    this.db = new DatabaseSync(this.path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    const version = Number(
      (this.db.prepare("PRAGMA user_version").get() as any).user_version,
    );
    for (let i = version; i < migrations.length; i++) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(migrations[i]);
        this.db.exec("PRAGMA user_version=" + (i + 1));
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    for (const d of this.all<Doc>("docs")) this.index(d);
  }
  put(kind: string, id: string, value: unknown) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
        .run(kind, id, JSON.stringify(value));
      if (kind === "docs") this.index(value as Doc);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? JSON.parse(row.value as string) : undefined;
  }
  remove(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
    if (kind === "docs")
      this.db.prepare("DELETE FROM block_search WHERE doc=?").run(id);
  }
  all<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT value FROM records WHERE kind=?")
      .all(kind)
      .map((r) => JSON.parse(r.value as string));
  }
  private index(d: Doc) {
    if (!d.blocks) return;
    const previous = new Map(
      this.db
        .prepare("SELECT block,body FROM block_search WHERE doc=?")
        .all(d.id)
        .map((row) => [String(row.block), String(row.body)]),
    );
    const current = new Set(d.blocks.map((b) => b.id));
    const remove = this.db.prepare(
      "DELETE FROM block_search WHERE doc=? AND block=?",
    );
    for (const id of previous.keys())
      if (!current.has(id)) remove.run(d.id, id);
    const insert = this.db.prepare(
      "INSERT INTO block_search(doc,block,body,tokens) VALUES(?,?,?,?)",
    );
    for (const b of d.blocks) {
      if (previous.get(b.id) === b.text) continue;
      if (previous.has(b.id)) remove.run(d.id, b.id);
      if (b.text) insert.run(d.id, b.id, b.text, searchTokens(b.text));
    }
  }
  search(
    query: string,
    docIds: string[],
    limit = 20,
  ): { doc: string; block: string; body: string }[] {
    if (!query.trim() || !docIds.length) return [];
    const placeholders = docIds.map(() => "?").join(",");
    const terms = searchTokens(query).split(" ").filter(Boolean).slice(0, 30);
    const exact = this.db
      .prepare(
        `SELECT doc,block,body FROM block_search WHERE doc IN (${placeholders}) AND instr(body,?)>0 LIMIT ?`,
      )
      .all(...docIds, query, limit);
    if (exact.length >= limit || !terms.length) return exact as any;
    const fuzzy = this.db
      .prepare(
        `SELECT doc,block,body FROM block_search WHERE block_search MATCH ? AND doc IN (${placeholders}) ORDER BY rank LIMIT ?`,
      )
      .all(terms.map((t) => '"' + t + '"').join(" OR "), ...docIds, limit);
    const seen = new Set(exact.map((r) => r.doc + ":" + r.block));
    return [
      ...exact,
      ...fuzzy.filter((r) => !seen.has(r.doc + ":" + r.block)),
    ].slice(0, limit) as any;
  }
  /** Case-insensitive literal search for the reader UI (no fuzzy noise). */
  find(query: string, docIds: string[], limit = 60) {
    if (!query.trim() || !docIds.length) return [];
    const placeholders = docIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT doc,block,body,instr(lower(body),lower(?)) AS at FROM block_search WHERE doc IN (${placeholders}) AND instr(lower(body),lower(?))>0 LIMIT ?`,
      )
      .all(query, ...docIds, query, limit) as { doc: string; block: string; body: string; at: number }[];
  }
  close() {
    this.db.close();
  }
}
