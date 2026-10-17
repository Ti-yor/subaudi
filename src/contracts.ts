import { z } from "zod";
const s = z.string().max(16000),
  id = z.string().min(1).max(100),
  ids = z.array(id).max(30);
export const Draft = z
  .object({
    status: z.enum(["complete", "limited", "needs_clarification"]),
    title: s,
    brief: s,
    sections: z
      .array(
        z
          .object({
            local_id: id,
            kind: z.enum([
              "meaning",
              "purpose",
              "prerequisite",
              "mechanism",
              "example",
              "boundary",
              "comparison",
            ]),
            title: s,
            body_markdown: s,
            evidence_ids: ids,
          })
          .strict(),
      )
      .max(8),
    return_to_source: s,
    claims: z
      .array(
        z
          .object({
            local_id: id,
            text: s,
            appears_in: ids,
            basis: z.enum([
              "source_statement",
              "derived",
              "background",
              "interpretation",
              "uncertain",
            ]),
            evidence_ids: ids,
            derivation_section_id: id.nullable(),
          })
          .strict(),
      )
      .max(50),
    followups: z
      .array(z.object({ term_or_phrase: s, section_id: id, why: s }).strict())
      .max(5),
    micro_check: z
      .object({
        question: s,
        hint: s,
        answer: s,
        success_criteria: z.array(s),
        remediation: s,
      })
      .strict()
      .nullable(),
    unresolved: z
      .array(z.object({ issue: s, effect_on_answer: s, next_step: s }).strict())
      .max(20),
    clarification: s.nullable(),
  })
  .strict();
export type DraftType = z.infer<typeof Draft>;
export const Segment = z
  .object({
    block: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    quote: z.string().min(1).max(6000),
    prefix: z.string().max(100),
    suffix: z.string().max(100),
    pageIndex: z.number().int().nonnegative().optional(),
    rects: z
      .array(
        z.tuple([
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
          z.number().min(0).max(1),
        ]),
      )
      .max(100)
      .optional(),
    coordinateSpace: z.literal("page-normalized-unrotated-top-left").optional(),
  })
  .strict();
export const Anchor = z
  .object({
    doc: id,
    block: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    quote: z.string().min(1).max(6000),
    segments: z.array(Segment).min(1).max(20).optional(),
  })
  .strict();
export type AnchorType = z.infer<typeof Anchor>;
export type Block = {
  id: string;
  text: string;
  readingText?: string;
  kind: string;
  page?: number;
  locator: string;
  issues: string[];
  asset?: string;
  regions?: { text: string; confidence: number; rect: number[] }[];
};
export type Doc = {
  supersedes?: string;
  /** PDF page count reported by the renderer once loaded. */
  pages?: number;
  id: string;
  name: string;
  format: string;
  blocks: Block[];
  issues: string[];
  reference: boolean;
  cloud: boolean;
};
export type Evidence = {
  source_id: string;
  excerpt: string;
  doc?: string;
  block?: string;
  url?: string;
  title: string;
  verification: string;
};
export type Explanation = {
  id: string;
  signature: string;
  anchor: AnchorType;
  root: AnchorType;
  parent: string | null;
  draft: DraftType;
  evidence: Evidence[];
  created: string;
  stale: boolean;
  review: string;
};
export const Settings = z
  .object({
    baseUrl: z
      .string()
      .url()
      .max(2000)
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }, "API 地址必须是 HTTP(S) 基础地址")
      .default("https://api.deepseek.com"),
    protocol: z.enum(["openai", "anthropic"]).default("openai"),
    jsonMode: z.boolean().default(true),
    model: z.string().min(1).max(100),
    reader: z.string().max(2000),
    /** Monthly token ceiling; 0 means no app-side limit. */
    budget: z.number().int().min(0).max(1_000_000_000),
    searx: z.union([z.literal(""), z.string().url()]),
    cloud: z.boolean(),
  })
  .strict();
export type SettingsType = z.infer<typeof Settings>;
export const Annotation = z
  .object({
    id,
    doc: id,
    anchor: Anchor,
    note: z.string().max(10000),
    color: z.enum(["yellow", "green", "blue", "pink"]),
    created: z.string(),
  })
  .strict();
export type AnnotationType = z.infer<typeof Annotation>;
export const Request = z
  .object({
    anchor: Anchor,
    parent: id.nullable(),
    complex: z.boolean(),
    query: z.string().max(200),
    /** Reader's own question about the selection; teach.v4 reads it as explicit_question. */
    question: z.string().max(500).optional(),
    mode: z.enum(["teach", "overview"]),
  })
  .strict();
export type RequestType = z.infer<typeof Request>;
export type LocalProgress = {
  doc: string;
  page: number;
  stage: "running" | "saving" | "ready" | "cached" | "failed";
  message: string;
  started: number;
  updated: number;
};
export type DocMeta = Omit<Doc, "blocks"> & { size: number };
export type UsageSummary = {
  month: string;
  spent: number;
  budget: number;
  calls: number;
  recent: { stage: string; tokens: number; at: string; model?: string; exact: boolean }[];
};
export type SearchHit = {
  doc: string;
  name: string;
  block: string;
  locator: string;
  page?: number;
  snippet: string;
  at: number;
};
export type Theme = "light" | "sepia" | "dark";
export type State = {
  annotations: AnnotationType[];
  docs: DocMeta[];
  explanations: Explanation[];
  settings: SettingsType;
  hasKey: boolean;
  usage: UsageSummary;
  session: Record<string, unknown>;
};
export interface API {
  anki(request: import("./anki-contracts").AnkiCommand): Promise<any>;
  remove(kind: "docs" | "explanations" | "annotations", id: string): Promise<void>;
  annotate(annotation: AnnotationType): Promise<void>;
  savePdf(id: string): Promise<string | null>;
  restore(): Promise<void>;
  original(id: string): Promise<void>;
  external(url: string): Promise<void>;
  cloud(id: string, allow: boolean): Promise<void>;
  overview(doc: string, block: string): Promise<OverviewType>;
  state(): Promise<State>;
  doc(id: string): Promise<Doc>;
  find(query: string, doc?: string): Promise<SearchHit[]>;
  ocr(doc: string, page: number): Promise<Doc>;
  /** Shows a file dialog (multi-select) and imports every chosen file. */
  open(reference: boolean): Promise<Doc[]>;
  /** Imports dropped files by absolute path. */
  importPaths(paths: string[], reference: boolean): Promise<Doc[]>;
  pathFor(file: File): string;
  pdf(id: string): Promise<Uint8Array>;
  index(id: string, blocks: Block[], pages?: number): Promise<void>;
  explain(r: RequestType): Promise<Explanation>;
  cancel(): Promise<void>;
  /** Saves settings; a non-empty key replaces the stored key for that endpoint. */
  settings(s: SettingsType, key?: string): Promise<void>;
  clearKey(): Promise<void>;
  testModel(s: SettingsType, key?: string): Promise<{ model: string; ms: number }>;
  theme(t: Theme): Promise<void>;
  dataFolder(): Promise<void>;
  session(v: Record<string, unknown>): Promise<void>;
  export(): Promise<string | null>;
  flag(id: string): Promise<void>;
  correct(doc: string, block: string, text: string): Promise<Doc>;
  event(cb: (s: string) => void): () => void;
  localProgress(cb: (progress: LocalProgress) => void): () => void;
}
export function validateDraft(value: unknown, evidence: Evidence[]) {
  const d = Draft.parse(value);
  const valid = new Set(evidence.map((e) => e.source_id)),
    section = new Set([
      "brief",
      "return_to_source",
      ...d.sections.map((s) => s.local_id),
    ]);
  if (
    section.size !== d.sections.length + 2 ||
    new Set(d.claims.map((c) => c.local_id)).size !== d.claims.length
  )
    throw Error("重复 ID");
  for (const x of [...d.sections, ...d.claims])
    for (const i of x.evidence_ids) if (!valid.has(i)) throw Error("无效来源");
  for (const c of d.claims) {
    if (c.appears_in.some((x) => !section.has(x)))
      throw Error(
        `主张 ${c.local_id} 的位置 ${c.appears_in.filter((x) => !section.has(x)).join(",")} 不存在；允许值是 ${[...section].join(",")}。直接使用 local_id，不加 section: 前缀。`,
      );
    if (
      c.basis === "derived" &&
      (!c.derivation_section_id ||
        !d.sections.some((s) => s.local_id === c.derivation_section_id))
    )
      throw Error(
        `主张 ${c.local_id} 的 derivation_section_id=${c.derivation_section_id} 没有对应小节；必须直接引用本响应 sections.local_id。`,
      );
    if (c.basis === "source_statement" && !c.evidence_ids.length)
      throw Error("原文主张缺来源");
  }
  for (const x of d.sections) {
    const refs = [...x.body_markdown.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]);
    if (
      refs.some((r) => !x.evidence_ids.includes(r)) ||
      x.evidence_ids.some((r) => !refs.includes(r))
    )
      throw Error(
        `正文引用不一致：${x.local_id} 声明 ${x.evidence_ids.join(",")}，正文出现 ${refs.join(",")}`,
      );
  }
  return d;
}

export const Overview = z
  .object({
    kind: z.enum(["structural_preview", "content_overview"]),
    scope: z.string().max(1000),
    central_question: z.string().max(2000),
    route: z
      .array(z.object({ block_ids: z.array(z.string()), role: z.string() }))
      .max(20),
    outcomes: z.array(z.string()).max(10),
    essential_prerequisites: z
      .array(
        z.object({ term: z.string(), reason: z.string(), entry: z.string() }),
      )
      .max(5),
    likely_obstacles: z
      .array(
        z.object({
          block_id: z.string(),
          question: z.string(),
          priority: z.enum(["blocking", "useful", "optional"]),
        }),
      )
      .max(5),
    unknowns: z.array(z.string()).max(10),
  })
  .strict();
export type OverviewType = z.infer<typeof Overview>;
export const Diagnosis = z
  .object({
    status: z.enum([
      "ready",
      "needs_evidence",
      "needs_transcription",
      "needs_clarification",
    ]),
    discipline_route: z.enum([
      "formal",
      "empirical",
      "interpretive",
      "decision",
      "practical",
      "mixed",
    ]),
    in_context_meaning: z.string().max(4000),
    statement_type: z.enum([
      "definition",
      "convention",
      "deduction",
      "observation",
      "interpretation",
      "value",
      "mixed",
    ]),
    gaps: z
      .array(
        z
          .object({
            kind: z.enum([
              "term",
              "notation",
              "purpose",
              "prerequisite",
              "inference",
              "evidence",
              "boundary",
              "structure",
            ]),
            question: z.string(),
            priority: z.enum(["blocking", "useful", "optional"]),
            anchor_id: z.string(),
          })
          .strict(),
      )
      .max(10),
    prerequisites: z
      .array(
        z
          .object({
            term: z.string(),
            placement: z.enum(["before", "inline", "optional"]),
            why: z.string(),
          })
          .strict(),
      )
      .max(10),
    conditions_to_check: z.array(z.string()).max(20),
    evidence_requests: z
      .array(
        z
          .object({
            question: z.string(),
            preferred_source_type: z.string(),
            why_local_material_is_insufficient: z.string(),
          })
          .strict(),
      )
      .max(5),
    teaching_goal: z.string(),
    suggested_section_kinds: z.array(z.string()).max(8),
    clarification: z.string().nullable(),
  })
  .strict();
export const Review = z
  .object({
    verdict: z.enum(["pass", "revise", "insufficient_evidence"]),
    issues: z
      .array(
        z
          .object({
            severity: z.enum(["critical", "major", "minor"]),
            location: z.string(),
            problem: z.string(),
            evidence_ids: z.array(z.string()),
            required_change: z.string(),
          })
          .strict(),
      )
      .max(20),
    unverified: z.array(z.string()).max(20),
  })
  .strict();
