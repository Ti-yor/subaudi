import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  nativeTheme,
} from "electron";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Store } from "./storage/store";
import { hash, verifyAnchor, Flights, estimateTokens } from "./core/primitives";
import { markdownText } from "./core/markdown";
import { teachingPackage, NOT_CACHED } from "./core/teaching";
import { recoverDraft, salvage, trySalvage } from "./core/salvage";
import { LineWorker, type WorkerCommand } from "./core/worker";
import {
  Settings,
  Request,
  Anchor,
  Overview,
  Draft,
  Diagnosis,
  Annotation,
  type AnnotationType,
  type SettingsType,
  type Doc,
  type DocMeta,
  type Block,
  type Explanation,
  type Evidence,
  type RequestType,
  type UsageSummary,
  type Theme,
} from "./contracts";
import { loadPrompt, taskInput } from "./core/prompts";
import { ADAPTER_VERSION } from "./providers/capabilities";
import { SearXNG } from "./providers/search";
import { DeepSeek } from "./providers/deepseek";
import { ModelJsonError } from "./providers/model-json";
import { annotatedPdf } from "./core/pdf-export";
import { AnkiRequest } from "./anki-contracts";
import {
  cardBatches,
  cardPrompt,
  groundedCards,
  planPrompt,
  validatePlan,
  requireCoverage,
  type AnkiCard,
  type KnowledgePoint,
} from "./core/flashcards";

const FORMATS = ["md", "txt", "pdf", "docx", "pptx", "ppt"];
const MAX_IMPORT = 1024 * 1024 * 1024;
let win: BrowserWindow, store: Store, root: string;
let generatingCards = false;
const controllers = new Set<AbortController>(),
  flights = new Flights();
const defaults: SettingsType = {
  baseUrl: "https://api.deepseek.com",
  protocol: "openai",
  jsonMode: true,
  model: "deepseek-flash",
  reader: "",
  budget: 2_000_000,
  searx: "",
  cloud: false,
};
const THEMES: Record<Theme, { bg: string; fg: string }> = {
  light: { bg: "#f6f5f2", fg: "#2b2a27" },
  sepia: { bg: "#efe6d4", fg: "#3b3226" },
  dark: { bg: "#1b1b1d", fg: "#e7e5e0" },
};

/* ───────────── sidecars ───────────── */
/** First existing bundled executable wins; development falls back to the Python script. */
const sidecar =
  (candidates: string[][], script: string, extra: string[] = []) =>
  (): WorkerCommand => {
    for (const parts of candidates) {
      const exe = path.join(process.resourcesPath, ...parts);
      if (existsSync(exe)) return { exe, args: extra };
    }
    if (app.isPackaged) throw Error("组件缺失：" + candidates[0].join("/"));
    return { exe: "python", args: [path.join(app.getAppPath(), script), ...extra] };
  };
let parser: LineWorker, ocrWorker: LineWorker, anki: LineWorker;

/* ───────────── helpers ───────────── */
const settings = (): SettingsType => {
  const saved = store.get<SettingsType>("config", "settings");
  const parsed = Settings.safeParse({ ...defaults, ...saved });
  return parsed.success ? parsed.data : defaults;
};
const theme = (): Theme => store.get<Theme>("config", "theme") ?? "light";
const stage = (s: string) => win?.webContents.send("stage", s);
const getDoc = (id: string) => {
  const d = store.get<Doc>("docs", id);
  if (!d) throw Error("文档不存在");
  return d;
};
const getExp = (id: string) => {
  const e = store.get<Explanation>("explanations", id);
  if (!e) throw Error("解释不存在");
  return e;
};
const objectPath = (d: Pick<Doc, "id" | "format">) =>
  path.join(root, "objects", d.id + "." + d.format);
const month = () => new Date().toISOString().slice(0, 7);

function usageSummary(cfg = settings()): UsageSummary {
  const current = month();
  const rows = store
    .all<any>("usage")
    .filter((u) => typeof u.at === "string" && u.at.startsWith(current))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return {
    month: current,
    spent: rows.reduce((n, u) => n + (u.reserved ?? 0), 0),
    budget: cfg.budget,
    calls: rows.length,
    recent: rows.slice(0, 30).map((u) => ({
      stage: u.stage,
      tokens: u.reserved ?? 0,
      at: u.at,
      model: u.model,
      exact: !!u.usage,
    })),
  };
}
/** Records a reservation and returns a function that settles it with real usage. */
function reserve(stageName: string, system: string, payload: unknown, cfg: SettingsType) {
  const estimated = estimateTokens(system + JSON.stringify(payload)) + 2048;
  if (cfg.budget > 0) {
    const { spent } = usageSummary(cfg);
    if (spent + estimated > cfg.budget)
      throw Error(
        `本月 token 上限已用 ${spent.toLocaleString()} / ${cfg.budget.toLocaleString()}。可在 设置 → 用量 中调高或设为 0（不限）。`,
      );
  }
  const id = hash({ stageName, t: Date.now(), r: Math.random() });
  const row = { id, stage: stageName, reserved: estimated, usage: null as unknown, model: cfg.model, at: new Date().toISOString() };
  store.put("usage", id, row);
  return (usage: unknown) =>
    store.put("usage", id, {
      ...row,
      reserved: (usage as any)?.total_tokens ?? estimated,
      usage,
    });
}
function invalidate(initial: string[]) {
  const all = store.all<Explanation>("explanations");
  const queue = [...initial],
    seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const e = all.find((x) => x.id === id);
    if (!e) continue;
    store.put("explanations", id, { ...e, stale: true });
    queue.push(...all.filter((x) => x.parent === id).map((x) => x.id));
  }
}
function credentialFile(cfg = settings()) {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return path.join(
    root,
    base === "https://api.deepseek.com" && cfg.protocol === "openai"
      ? "credential.bin"
      : "credential-" + hash({ base, protocol: cfg.protocol }) + ".bin",
  );
}
function key(cfg = settings()) {
  const f = credentialFile(cfg);
  if (!existsSync(f)) return "";
  if (!safeStorage.isEncryptionAvailable()) throw Error("系统密钥保护不可用");
  return safeStorage.decryptString(readFileSync(f));
}
function validKey(value: string) {
  const v = value.trim();
  if (v.length < 10 || v.length > 500 || /\s/.test(v))
    throw Error("API Key 格式不正确：应为一段不含空格的字符串");
  return v;
}
function storeKey(cfg: SettingsType, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw Error("系统密钥保护不可用");
  writeFileSync(credentialFile(cfg), safeStorage.encryptString(validKey(value)));
}
// Templates are hashed into the explanation and overview cache keys, so their bytes must not depend on
// how git checked them out. Every template through 0.2.0 was authored with CRLF; normalising to CRLF
// keeps both the model input and every existing cache key identical on LF and CRLF checkouts.
function prompt(name: string) {
  return loadPrompt(path.join(__dirname, "prompts"), name).replace(/\r?\n/g, "\r\n");
}
function requireCloud(cfg: SettingsType, d?: Pick<Doc, "cloud">) {
  if (!key(cfg)) throw Error("尚未配置 API Key。打开 设置 → AI 服务 粘贴 Key 即可开始。");
  if (!cfg.cloud) throw Error("AI 解释已在设置中关闭。打开 设置 → AI 服务 重新启用。");
  if (d && !d.cloud) throw Error("此文档已设为“仅本地”。在文档菜单中允许 AI 解释后重试。");
}
const meta = (d: Doc): DocMeta => {
  const { blocks, ...rest } = d;
  let size = 0;
  try {
    size = statSync(objectPath(d)).size;
  } catch {}
  return { ...rest, size };
};

/* ───────────── import ───────────── */
function decodeText(data: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    // Most legacy Chinese .txt files are GBK/GB18030.
    return new TextDecoder("gb18030").decode(data);
  }
}
async function importFile(file: string, ref: boolean): Promise<Doc> {
  const format = path.extname(file).slice(1).toLowerCase();
  if (!FORMATS.includes(format))
    throw Error(`不支持 .${format} 文件（支持 ${FORMATS.join(" / ")}）`);
  if (statSync(file).size > MAX_IMPORT) throw Error("文件超过 1 GB");
  const data = readFileSync(file);
  const id = hash(data);
  const existing = store.get<Doc>("docs", id);
  if (existing) {
    if (existing.format === "snapshot") {
      copyFileSync(file, path.join(root, "objects", id + "." + format));
      existing.format = format;
      existing.issues = existing.issues.filter((x) => !x.startsWith("从导出恢复"));
    }
    if (ref) existing.reference = true;
    store.put("docs", id, existing);
    return existing;
  }
  let blocks: Block[] = [],
    issues: string[] = [];
  if (format === "pdf") {
    if (data.subarray(0, 1024).indexOf("%PDF-") < 0) throw Error("不是有效的 PDF 文件");
  } else if (format === "docx" || format === "pptx" || format === "ppt") {
    stage("正在解析 " + path.basename(file));
    ({ blocks, issues } = await parser.call(
      { id: "parse", path: file },
      { timeout: 10 * 60_000 },
    ));
  } else {
    blocks = decodeText(data)
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n/)
      .filter((t) => t.trim())
      .map((text, i) => ({
        id: "b" + i,
        text,
        kind: /^#{1,6} /.test(text) ? "heading" : "paragraph",
        locator: "第 " + (i + 1) + " 段",
        issues: [],
      }));
  }
  const doc: Doc = {
    id,
    name: path.basename(file),
    format,
    blocks,
    issues,
    reference: ref,
    cloud: true,
  };
  copyFileSync(file, objectPath(doc));
  store.put("docs", id, doc);
  return doc;
}
const isDamage = (issue: string) => /损坏|无法读取/.test(issue);
async function importMany(files: string[], ref: boolean) {
  const out: Doc[] = [],
    failed: string[] = [];
  for (const f of files)
    try {
      out.push(await importFile(f, ref));
    } catch (e) {
      failed.push(path.basename(f) + "：" + (e instanceof Error ? e.message : e));
    }
  if (failed.length && !out.length) throw Error(failed.join("\n"));
  if (failed.length) stage("部分文件未导入 · " + failed.join("；"));
  else {
    // Imported, but some slides/pages were damaged and skipped: say so instead of staying silent.
    const damaged = out.flatMap((d) => d.issues.filter(isDamage).map((i) => `${d.name}：${i}`));
    if (damaged.length) stage("部分内容未能读取 · " + damaged.slice(0, 5).join("；") + (damaged.length > 5 ? ` 等 ${damaged.length} 处` : ""));
  }
  return out;
}

/* ───────────── explain ───────────── */
function explanationBlocks(e: Explanation): Block[] {
  return [
    { id: "brief", text: e.draft.brief },
    { id: "return_to_source", text: e.draft.return_to_source },
    ...e.draft.sections.map((s) => ({ id: s.local_id, text: s.body_markdown })),
  ].map((b) => ({ ...b, kind: "paragraph", locator: b.id, issues: [] }));
}
async function explain(req: RequestType): Promise<Explanation> {
  const cfg = settings();
  const parent = req.parent ? getExp(req.parent) : null;
  const doc = getDoc(parent?.root.doc ?? req.anchor.doc);
  if (parent?.stale) throw Error("上层解释已标记为有误，请回到原文重新选取");
  if (parent && req.anchor.doc !== parent.id) throw Error("选区与上层解释不匹配");
  const blocks = parent ? explanationBlocks(parent) : doc.blocks;
  const visible = (b: Block) => (parent || doc.format === "md" ? markdownText(b.text) : b.text);
  for (const segment of req.anchor.segments ?? [req.anchor]) {
    const block = blocks.find((b) => b.id === segment.block);
    if (!block) throw Error("选区所在段落不存在，请重新选取");
    verifyAnchor(visible(block), segment);
  }
  const content = blocks.find((b) => b.id === req.anchor.block)!.text;
  const rootAnchor = parent?.root ?? req.anchor;
  const rootBlock = doc.blocks.find((b) => b.id === rootAnchor.block);
  if (!rootBlock) throw Error("原文段落不存在");
  const rootBlocks = (rootAnchor.segments ?? [{ block: rootAnchor.block }])
    .map((s) => doc.blocks.find((b) => b.id === s.block))
    .filter((b): b is Block => !!b);
  const evidence: Evidence[] = [
    {
      source_id: "S1",
      excerpt: rootBlocks.map((b) => b.readingText ?? b.text).join("\n"),
      doc: doc.id,
      block: rootBlock.id,
      title: doc.name + " · " + rootBlock.locator,
      verification: "source_only",
    },
  ];
  const library = store
    .all<Doc>("docs")
    .filter((d) => d.id === doc.id || (d.reference && d.cloud));
  for (const hit of store.search(req.anchor.quote, library.map((d) => d.id), 8)) {
    if (evidence.length >= 5) break;
    const d = library.find((x) => x.id === hit.doc),
      b = d?.blocks.find((b) => b.id === hit.block);
    if (!d || !b || (b.id === rootBlock.id && d.id === doc.id) || b.text.length > 6000) continue;
    evidence.push({
      source_id: "S" + (evidence.length + 1),
      excerpt: b.readingText ?? b.text,
      doc: d.id,
      block: b.id,
      title: d.name + " · " + b.locator,
      verification: "source_only",
    });
  }
  const signature = hash({
    req,
    cfg: {
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      protocol: cfg.protocol,
      jsonMode: cfg.jsonMode,
      reader: cfg.reader,
      searx: cfg.searx,
    },
    evidence,
    pipeline: hash(["common", "teach", "child", "diagnose", "review", "repair"].map(prompt)),
    schema: 1,
    adapter: ADAPTER_VERSION,
    selectionRenderer: "react-markdown-static-v1",
    taskSerialization: "stage-specific-v2",
  });
  const cached = store
    .all<Explanation>("explanations")
    .find((e) => e.signature === signature && !e.stale && !e.review.includes("未复审") && !e.review.includes(NOT_CACHED));
  if (cached && (!req.query || Date.now() - Date.parse(cached.created) < 86400000)) {
    stage("已从本地缓存打开 · 未调用 API");
    return cached;
  }
  return flights.run(signature, async () => {
    requireCloud(cfg, doc);
    const secret = key(cfg);
    const abort = new AbortController();
    controllers.add(abort);
    const job = hash(signature + Date.now());
    store.put("jobs", job, { id: job, state: "generating", created: new Date().toISOString() });
    let calls = 0,
      jsonRepairUsed = false;
    const maxCalls = req.complex ? 5 : 3;
    const model = new DeepSeek(secret, cfg.model, cfg);
    const input: any = {
      task: "teach",
      language: "zh-CN",
      reader_profile: {
        declared_background: cfg.reader,
        goal: "读回原文并完成小型迁移",
        relevant_knowledge: [],
      },
      selection: { anchor_id: req.anchor.block, text: req.anchor.quote },
      explicit_question: req.question?.trim() || null,
      context: {
        root_selection: rootAnchor.quote,
        parent_excerpt: parent ? content : null,
        path_summary: parent?.draft.title ?? null,
        nearby_blocks: doc.blocks
          .slice(Math.max(0, doc.blocks.indexOf(rootBlock) - 1), doc.blocks.indexOf(rootBlock) + 2)
          .map((b) => ({ id: b.id, text: b.readingText ?? b.text })),
        coverage: "当前选区及相邻块",
        extraction_issues: rootBlocks.flatMap((b) => b.issues),
      },
      evidence,
      capabilities: { web_search: false, vision: false },
      limits: { max_sections: 8, max_checks: 1, max_followups: 3 },
    };
    const labels: Record<string, string> = {
      diagnose: "正在分析选区",
      teach: "正在生成解释",
      review: "正在审查解释",
      repair: "正在修订解释",
    };
    const invoke = async (name: string, payload: unknown, fixingJson = false): Promise<unknown> => {
      if (abort.signal.aborted) throw Error("已取消");
      if (++calls > maxCalls) throw Error("本次解释的调用次数已达上限，请重试");
      const system =
        prompt("common") + "\n" + prompt(name) + (name === "teach" && parent ? "\n" + prompt("child") : "");
      const serialized = taskInput(name, payload);
      const settle = reserve(name, system, serialized, cfg);
      stage(fixingJson ? "正在修复响应格式" : (labels[name] ?? name));
      try {
        return await model.call(system, serialized, abort.signal, settle);
      } catch (error) {
        if (!(error instanceof ModelJsonError) || fixingJson || jsonRepairUsed || calls >= maxCalls)
          throw error instanceof ModelJsonError
            ? Error("模型返回的格式无法解析，请重试。")
            : error;
        jsonRepairUsed = true;
        return invoke(
          name,
          {
            ...serialized,
            invalid_output: error.output,
            format_repair:
              "上次响应不是合法 JSON。保留原意，严格返回当前任务要求的一个完整 JSON 对象；属性名使用双引号，不使用代码围栏或尾逗号。",
          },
          true,
        );
      }
    };
    try {
      if (req.query) {
        stage("正在联网检索");
        try {
          const web = await new SearXNG(cfg.searx).search(req.query, abort.signal);
          for (const e of web) evidence.push({ ...e, source_id: "S" + (evidence.length + 1) });
          input.capabilities.web_search = true;
        } catch (e) {
          input.context.extraction_issues.push("未联网核实：" + (e instanceof Error ? e.message : "搜索失败"));
          stage("检索不可用，仅基于本地材料");
        }
      }
      input.output_schema = JSON.parse(
        readFileSync(path.join(__dirname, "prompts", "explanation.schema.json"), "utf8"),
      );
      if (req.complex) {
        // The diagnosis only guides the teaching step; a bad one is dropped, not fatal.
        const diagnosis = trySalvage(Diagnosis, await invoke("diagnose", input));
        if (diagnosis) input.diagnosis = diagnosis.data;
        else input.context.extraction_issues.push("诊断步骤的响应无法解析，已直接讲解");
      }
      const { draft, review } = await teachingPackage(input, evidence, req.complex, invoke);
      if (abort.signal.aborted) throw Error("已取消");
      const out: Explanation = {
        id: hash(job + "revision"),
        signature,
        anchor: req.anchor,
        root: rootAnchor,
        parent: req.parent,
        draft,
        evidence,
        created: new Date().toISOString(),
        stale: false,
        review,
      };
      store.put("explanations", out.id, out);
      store.put("jobs", job, { id: job, state: "ready" });
      stage("解释已保存");
      return out;
    } catch (e) {
      store.put("jobs", job, {
        id: job,
        state: abort.signal.aborted ? "cancelled" : "failed",
        reason: e instanceof Error ? e.message : "失败",
      });
      throw e;
    } finally {
      controllers.delete(abort);
    }
  });
}

/* ───────────── OCR / correction (in place) ───────────── */
async function ocrPage(id: unknown, pageValue: unknown): Promise<Doc> {
  const d = getDoc(z.string().parse(id));
  const page = z.number().int().min(0).max(100000).parse(pageValue);
  const started = Date.now();
  const report = (stageName: string, message: string) =>
    win.webContents.send("local-progress", {
      doc: d.id,
      page,
      stage: stageName,
      message,
      started,
      updated: Date.now(),
    });
  if (d.format !== "pdf") throw Error("仅 PDF 支持文字识别");
  const block = d.blocks.find((b) => b.page === page);
  if (!block) throw Error("页面尚未索引，请稍候再试");
  if (block.regions) {
    report("cached", "本页已识别");
    return d;
  }
  const abort = new AbortController();
  controllers.add(abort);
  report("running", "正在识别第 " + (page + 1) + " 页");
  try {
    const result = await ocrWorker.call(
      { path: objectPath(d), page },
      { timeout: 180_000, signal: abort.signal },
    );
    // Detection boxes may overhang the page edge by a pixel; clamp instead of failing the page,
    // and drop only the individual regions that are unusable.
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    const Region = z.object({
      text: z.string(),
      confidence: z.number().catch(0),
      rect: z.array(z.number().finite().transform(clamp)).length(4),
    });
    const regions = z
      .array(z.unknown())
      .parse(result.regions)
      .flatMap((r) => {
        const parsed = Region.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      });
    const latest = getDoc(d.id);
    const text = regions.map((r) => r.text).join("\n");
    latest.blocks = latest.blocks.map((b) =>
      b.id === block.id
        ? {
            ...b,
            text,
            readingText: text,
            regions,
            issues: ["本地 OCR 识别，公式与符号可能有误"],
          }
        : b,
    );
    store.put("docs", latest.id, latest);
    if (block.text.trim())
      invalidate(
        store
          .all<Explanation>("explanations")
          .filter((e) => e.evidence.some((x) => x.doc === d.id && x.block === block.id))
          .map((e) => e.id),
      );
    report("ready", `已识别 ${regions.length} 行`);
    return latest;
  } catch (error) {
    report("failed", error instanceof Error ? error.message : "识别失败");
    throw error;
  } finally {
    controllers.delete(abort);
  }
}

/* ───────────── flashcards ───────────── */
/** Content problems in one model response skip that item and are reported; anything else (network,
 *  credentials, budget, cancellation, Anki) still stops the job. */
const skippable = (e: unknown) => e instanceof ModelJsonError || e instanceof z.ZodError;

async function generateCards(docId: string, deck: string) {
  if (generatingCards) throw Error("已有制卡任务正在进行");
  const cfg = settings();
  let d = getDoc(docId);
  requireCloud(cfg, d);
  generatingCards = true;
  const control = new AbortController();
  controllers.add(control);
  let added = 0,
    covered = 0,
    planned = 0;
  const skipped = { ocr: 0, plans: 0, groups: 0, malformed: 0, missing: 0, unverified: 0 };
  const planNotes = new Map<string, number>();
  try {
    await anki.call({ op: "status", protocol: 1 });
    if (d.format === "pdf") {
      const indexed = new Set(d.blocks.map((b) => b.page)).size;
      if (!d.pages || indexed < d.pages)
        throw Error(`PDF 文字仍在后台提取（${indexed}/${d.pages ?? "?"} 页），完成后即可制卡`);
      for (const b of d.blocks.filter((b) => !b.text.trim() && b.page !== undefined && !b.regions)) {
        if (control.signal.aborted) throw Error("制卡已取消");
        stage(`制卡准备：识别第 ${b.page! + 1} 页`);
        try {
          d = await ocrPage(d.id, b.page);
        } catch (e) {
          if (control.signal.aborted) throw Error("制卡已取消");
          skipped.ocr++; // that page simply contributes no text
        }
      }
    }
    const batches = cardBatches(d);
    if (!batches.length) throw Error("材料没有可读取的正文，无法生成卡片");
    const secret = key(cfg);
    const callOnce = (system: string, payload: unknown) => {
      if (control.signal.aborted) throw Error("制卡已取消");
      const settle = reserve("flashcards", system, payload, cfg);
      return new DeepSeek(secret, cfg.model, cfg).call(system, payload, control.signal, settle);
    };
    /** Same single format-repair retry the explanation pipeline uses. */
    const callModel = async (system: string, payload: Record<string, unknown>) => {
      try {
        return await callOnce(system, payload);
      } catch (error) {
        if (!(error instanceof ModelJsonError)) throw error;
        stage("正在修复响应格式");
        return callOnce(system, {
          ...payload,
          invalid_output: error.output,
          format_repair:
            "上次响应不是合法 JSON。保留原意，严格返回当前任务要求的一个完整 JSON 对象；属性名使用双引号，不使用代码围栏或尾逗号。",
        });
      }
    };
    for (let i = 0; i < batches.length; i++) {
      if (control.signal.aborted) throw Error("已取消，已完成的卡片已保留");
      const batch = batches[i],
        sig = hash({ template: cardPrompt, doc: d.id, batch, model: cfg.model, baseUrl: cfg.baseUrl });
      const planId = hash({ sig, planPrompt });
      stage(`分析知识点 · 第 ${i + 1}/${batches.length} 批`);
      let points = store.get<KnowledgePoint[]>("card-plans", planId);
      if (!points) {
        try {
          const plan = validatePlan(await callModel(planPrompt, { blocks: batch }), batch);
          for (const w of plan.warnings) planNotes.set(w, (planNotes.get(w) ?? 0) + 1);
          points = plan.points;
          store.put("card-plans", planId, points);
        } catch (e) {
          if (!skippable(e)) throw e;
          skipped.plans++; // not cached, so the next run retries this batch
          stage(`第 ${i + 1} 批的知识点分析无法使用，已跳过`);
          continue;
        }
      }
      planned += points.length;
      for (let p = 0; p < points.length; p += 5) {
        const group = points.slice(p, p + 5),
          groupId = hash({ planId, group, cardPrompt });
        stage(`制卡 · 第 ${i + 1}/${batches.length} 批 · 已新增 ${added} 张`);
        let cards = store.get<AnkiCard[]>("card-drafts", groupId);
        let missing = 0;
        if (!cards) {
          try {
            const first = requireCoverage(await callModel(cardPrompt, { blocks: batch, points: group }), group);
            let found = first.cards;
            skipped.malformed += first.malformed;
            missing = first.missing.length;
            if (missing) {
              // One focused retry for exactly the points the model skipped.
              stage(`补制遗漏的 ${missing} 个知识点`);
              try {
                const again = requireCoverage(
                  await callModel(cardPrompt, { blocks: batch, points: first.missing }),
                  first.missing,
                );
                found = [...found, ...again.cards];
                skipped.malformed += again.malformed;
                missing = again.missing.length;
              } catch (e) {
                if (!skippable(e)) throw e;
              }
            }
            cards = groundedCards(found, d, batch, group).cards;
            // Cached even when incomplete: regenerating would add near-duplicate cards to Anki.
            store.put("card-drafts", groupId, cards);
          } catch (e) {
            if (!skippable(e)) throw e;
            skipped.groups++;
            stage("一组卡片的响应无法使用，已跳过");
            continue;
          }
        }
        skipped.missing += missing;
        skipped.unverified += cards.filter((c) => c.review).length;
        if (control.signal.aborted) throw Error("已取消；已完成部分已保存");
        const result = await anki.call({ op: "add", deck, cards, protocol: 1 });
        added += result.added;
        covered += group.length - missing;
      }
    }
    const warnings = [
      skipped.unverified && `${skipped.unverified} 张卡片的引文未能在原文中逐字找到，已加“待核对”标签保存`,
      skipped.missing && `${skipped.missing} 个知识点补制后仍未生成卡片`,
      skipped.malformed && `${skipped.malformed} 张卡片格式不完整，已跳过`,
      skipped.groups && `${skipped.groups} 组卡片的响应无法解析，已跳过，重新制卡会重试`,
      skipped.plans && `${skipped.plans} 批原文的知识点分析无法解析，已跳过，重新制卡会重试`,
      skipped.ocr && `${skipped.ocr} 页扫描页识别失败，未参与制卡`,
      ...[...planNotes].map(([w, n]) => (n > 1 ? `${w}（${n} 批）` : w)),
    ].filter((w): w is string => Boolean(w));
    stage(`制卡完成 · 新增 ${added} 张${warnings.length ? ` · ${warnings.length} 条提示` : ""}`);
    return { added, batches: batches.length, covered, planned, issues: d.issues, warnings };
  } finally {
    controllers.delete(control);
    generatingCards = false;
  }
}

/* ───────────── app ───────────── */
const RestoreDoc = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().max(500),
    format: z.string().regex(/^[a-z]+$/),
    supersedes: z.string().optional(),
    pages: z.number().optional(),
    blocks: z
      .array(
        z
          .object({
            id: z.string().max(100),
            // Same caps as the index and correct handlers, so any library the app wrote can be restored.
            text: z.string().max(200000),
            readingText: z.string().max(240000).optional(),
            kind: z.string(),
            locator: z.string(),
            page: z.number().optional(),
            issues: z.array(z.string()),
            asset: z.string().startsWith("data:image/").optional(),
            regions: z
              .array(z.object({ text: z.string(), confidence: z.number(), rect: z.array(z.number()) }))
              .optional(),
          }),
        // Not .strict(): a field added by a newer Subaudi is dropped, not a reason to refuse the backup.
      )
      .max(100000),
    issues: z.array(z.string()),
    reference: z.boolean(),
    cloud: z.boolean(),
  });

const RestoreExplanation = z.object({
  id: z.string(),
  signature: z.string(),
  anchor: Anchor,
  root: Anchor,
  parent: z.string().nullable(),
  draft: Draft,
  evidence: z.array(
    z.object({
      source_id: z.string(),
      excerpt: z.string(),
      doc: z.string().optional(),
      block: z.string().optional(),
      url: z.string().optional(),
      title: z.string(),
      verification: z.string(),
    }),
  ),
  created: z.string(),
  stale: z.boolean(),
  review: z.string(),
});

app.whenReady().then(async () => {
  root = app.getPath("userData");
  mkdirSync(path.join(root, "objects"), { recursive: true });
  store = new Store(path.join(root, "subaudi.sqlite"));
  await store.init();
  parser = new LineWorker("文档解析", sidecar(
      [
        ["parser", "subaudi-parser", "subaudi-parser.exe"],
        ["parser", "subaudi-parser.exe"],
      ],
      "services/parser/main.py",
    ));
  ocrWorker = new LineWorker("文字识别", sidecar([["parser", "ocr", "subaudi-ocr.exe"]], "services/parser/ocr.py"));
  const ankiHome = path.join(root, "anki");
  anki = new LineWorker(
    "卡片库内核",
    sidecar([["anki", "subaudi-anki.exe"]], "services/anki/main.py", [ankiHome]),
  );
  app.on("before-quit", () => [parser, ocrWorker, anki].forEach((w) => w.stop()));
  for (const j of store.all<any>("jobs"))
    if (j.state === "generating") store.put("jobs", j.id, { ...j, state: "interrupted" });
  Menu.setApplicationMenu(null);
  const t = THEMES[theme()];
  nativeTheme.themeSource = theme() === "dark" ? "dark" : "light";
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 600,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: t.bg, symbolColor: t.fg, height: 44 },
    backgroundColor: t.bg,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_w, p, cb) => cb(p === "clipboard-sanitized-write"));

  const on = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw Error("IPC 来源被拒绝");
      return fn(...args);
    });

  on("anki", async (input: unknown) => {
    const req = AnkiRequest.parse(input);
    const call = (c: Record<string, unknown>, timeout?: number) =>
      anki.call({ ...c, protocol: 1 }, { timeout });
    switch (req.op) {
      case "folder":
        await shell.openPath(ankiHome);
        return true;
      case "backup": {
        const r = await dialog.showSaveDialog(win, {
          defaultPath: `Subaudi-${new Date().toISOString().slice(0, 10)}.colpkg`,
          filters: [{ name: "完整卡片库", extensions: ["colpkg"] }],
        });
        return r.canceled || !r.filePath ? null : call({ op: "backup", path: r.filePath }, 10 * 60_000);
      }
      case "import": {
        const picked = await dialog.showOpenDialog(win, {
          filters: [{ name: "Anki 文件", extensions: ["apkg", "colpkg", "anki2"] }],
          properties: ["openFile"],
        });
        return picked.canceled ? null : call({ ...req, path: picked.filePaths[0] }, 30 * 60_000);
      }
      case "export": {
        const picked = await dialog.showSaveDialog(win, {
          defaultPath: "Subaudi.apkg",
          filters: [{ name: "Anki 牌组", extensions: ["apkg"] }],
        });
        return picked.canceled || !picked.filePath ? null : call({ ...req, path: picked.filePath }, 10 * 60_000);
      }
      case "generate":
        return generateCards(req.doc, req.deck);
    }
    const command: Record<string, unknown> = { ...req };
    if ("id" in req) {
      command.cardId = req.id;
      delete command.id;
    }
    return call(command);
  });
  on("state", () => {
    const docs = store.all<Doc>("docs");
    const superseded = new Set(docs.map((d) => d.supersedes).filter(Boolean));
    return {
      annotations: store.all("annotations"),
      docs: docs.filter((d) => !superseded.has(d.id)).map(meta),
      explanations: store.all("explanations"),
      settings: settings(),
      hasKey: existsSync(credentialFile()),
      usage: usageSummary(),
      session: store.get("session", "current") ?? {},
    };
  });
  on("doc", (id: unknown) => getDoc(z.string().parse(id)));
  on("find", (q: unknown, docId: unknown) => {
    const query = z.string().max(200).parse(q).trim();
    if (!query) return [];
    const docs = store.all<Doc>("docs");
    const scope = docId ? [z.string().parse(docId)] : docs.map((d) => d.id);
    return store.find(query, scope, 80).map((hit) => {
      const d = docs.find((x) => x.id === hit.doc)!;
      const b = d.blocks.find((x) => x.id === hit.block);
      const chars = Array.from(hit.body),
        at = Array.from(hit.body.slice(0, Math.max(0, hit.at - 1))).length;
      return {
        doc: d.id,
        name: d.name,
        block: hit.block,
        locator: b?.locator ?? "",
        page: b?.page,
        snippet: chars.slice(Math.max(0, at - 40), at + 120).join(""),
        at: Math.min(at, 40),
      };
    });
  });
  on("annotate", (value: unknown) => {
    const note = Annotation.parse(value),
      d = getDoc(note.doc);
    if (note.anchor.doc !== d.id) throw Error("批注来源不匹配");
    for (const segment of note.anchor.segments ?? [note.anchor]) {
      const b = d.blocks.find((b) => b.id === segment.block);
      if (!b) throw Error("批注原文不存在");
      verifyAnchor(d.format === "md" ? markdownText(b.text) : b.text, segment);
    }
    const existing = store.get<AnnotationType>("annotations", note.id);
    if (existing && existing.doc !== note.doc) throw Error("不能移动其他文档的批注");
    store.put("annotations", note.id, note);
  });
  on("remove", (kind: unknown, value: unknown) => {
    const k = z.enum(["docs", "explanations", "annotations"]).parse(kind),
      id = z.string().parse(value);
    if (k === "docs" && (controllers.size || parser.busy))
      throw Error("后台任务进行中，完成后再移除教材");
    const exps = store.all<Explanation>("explanations");
    const remove = new Set(
      k === "docs" ? exps.filter((e) => e.root.doc === id).map((e) => e.id) : k === "explanations" ? [id] : [],
    );
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of exps)
        if (e.parent && remove.has(e.parent) && !remove.has(e.id)) {
          remove.add(e.id);
          changed = true;
        }
    }
    const doc = k === "docs" ? store.get<Doc>("docs", id) : undefined;
    store.db.exec("BEGIN IMMEDIATE");
    try {
      for (const eid of remove) store.remove("explanations", eid);
      if (k === "docs")
        for (const n of store.all<AnnotationType>("annotations"))
          if (n.doc === id) store.remove("annotations", n.id);
      store.remove(k, id);
      store.db.exec("COMMIT");
    } catch (e) {
      store.db.exec("ROLLBACK");
      throw e;
    }
    // Free the private copy of the file (the user's original is untouched).
    if (doc)
      try {
        unlinkSync(objectPath(doc));
      } catch {}
  });
  on("save-pdf", async (value: unknown) => {
    const d = getDoc(z.string().parse(value));
    if (d.format !== "pdf") throw Error("此文件不是 PDF");
    const r = await dialog.showSaveDialog(win, {
      defaultPath: d.name.replace(/\.pdf$/i, "") + "（批注）.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(
      r.filePath,
      await annotatedPdf(
        readFileSync(objectPath(d)),
        store.all<AnnotationType>("annotations").filter((n) => n.doc === d.id),
      ),
    );
    return r.filePath;
  });
  on("open", async (reference: unknown) => {
    const ref = z.boolean().parse(reference);
    const chosen = await dialog.showOpenDialog(win, {
      filters: [{ name: "教材", extensions: FORMATS }],
      properties: ["openFile", "multiSelections"],
    });
    return chosen.canceled ? [] : importMany(chosen.filePaths, ref);
  });
  on("import-paths", (paths: unknown, reference: unknown) =>
    importMany(z.array(z.string().min(1)).max(200).parse(paths), z.boolean().parse(reference)),
  );
  on("pdf", (id: unknown) => {
    const d = getDoc(z.string().parse(id));
    if (d.format !== "pdf") throw Error("格式错误");
    return new Uint8Array(readFileSync(objectPath(d)));
  });
  on("index", (id: unknown, raw: unknown, pages: unknown) => {
    const d = getDoc(z.string().parse(id));
    if (d.format !== "pdf") throw Error("格式错误");
    const blocks = z
      .array(
        z
          .object({
            id: z.string().max(100),
            text: z.string().max(200000),
            readingText: z.string().max(240000).optional(),
            kind: z.string(),
            page: z.number().int().nonnegative(),
            locator: z.string(),
            issues: z.array(z.string()),
          })
          .strict(),
      )
      .max(100000)
      .parse(raw);
    const count = z.number().int().positive().optional().parse(pages);
    const existing = new Map(d.blocks.map((b) => [b.id, b]));
    let changed = count !== undefined && count !== d.pages;
    for (const b of blocks) {
      if (b.id !== "p" + (b.page + 1)) throw Error("PDF 页码与块不匹配");
      const previous = existing.get(b.id);
      if (!previous) {
        existing.set(b.id, b);
        changed = true;
      } else if (!previous.regions && previous.text === b.text && !previous.readingText) {
        existing.set(b.id, { ...previous, readingText: b.readingText });
        changed = true;
      }
    }
    if (!changed) return;
    d.blocks = [...existing.values()].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
    if (count) d.pages = count;
    store.put("docs", d.id, d);
  });
  on("overview", async (did: unknown, bid: unknown) => {
    const d = getDoc(z.string().parse(did));
    const index = d.blocks.findIndex((b) => b.id === z.string().parse(bid));
    if (index < 0) throw Error("当前段落不存在");
    const blocks = d.blocks
      .slice(index, index + 6)
      .filter((b) => b.text.trim() && b.text.length < 8000)
      .map(({ id, text, locator }) => ({ id, text, locator }));
    if (!blocks.length) throw Error("这一部分没有可读取的文字");
    const cfg = settings(),
      sig = hash({ doc: d.id, blocks, reader: cfg.reader, model: cfg.model, template: prompt("overview") });
    const cached = store.get("overviews", sig);
    if (cached) {
      stage("已从本地缓存打开 · 未调用 API");
      return cached;
    }
    return flights.run(sig, async () => {
      requireCloud(cfg, d);
      const control = new AbortController();
      const payload = {
        blocks,
        coverage: `从「${blocks[0].locator}」起的 ${blocks.length} 段`,
        reader_profile: cfg.reader,
        limits: { max_prerequisites: 3, max_obstacles: 3 },
      };
      const system = prompt("common") + "\n" + prompt("overview");
      const settle = reserve("overview", system, payload, cfg);
      controllers.add(control);
      try {
        stage("正在生成导读");
        const model = new DeepSeek(key(cfg), cfg.model, cfg);
        let raw: unknown;
        try {
          raw = await model.call(system, payload, control.signal, settle);
        } catch (error) {
          if (!(error instanceof ModelJsonError)) throw error;
          stage("正在修复响应格式");
          const retry = {
            ...payload,
            invalid_output: error.output,
            format_repair: "上次响应不是合法 JSON。保留原意，严格返回一个完整 JSON 对象；属性名使用双引号，不使用代码围栏或尾逗号。",
          };
          raw = await model.call(system, retry, control.signal, reserve("overview", system, retry, cfg));
        }
        // Extra items or one malformed entry are trimmed; only a structurally unusable overview fails.
        let result: z.infer<typeof Overview>;
        try {
          result = salvage(Overview, raw).data;
        } catch {
          throw Error("导读的响应格式无法使用，请重试");
        }
        const known = new Set(blocks.map((b) => b.id));
        result.route = result.route
          .map((r) => ({ ...r, block_ids: r.block_ids.filter((b) => known.has(b)) }))
          .filter((r) => r.block_ids.length);
        result.likely_obstacles = result.likely_obstacles.filter((o) => known.has(o.block_id));
        result.scope = payload.coverage;
        store.put("overviews", sig, result);
        return result;
      } finally {
        controllers.delete(control);
      }
    });
  });
  on("ocr", ocrPage);
  on("explain", (r) => explain(Request.parse(r)));
  on("cancel", () => {
    for (const c of controllers) c.abort();
  });
  on("settings", (v: unknown, secret: unknown) => {
    const parsed = Settings.safeParse(v);
    if (!parsed.success) {
      const names: Record<string, string> = {
        baseUrl: "服务地址",
        model: "模型 ID",
        budget: "每月 token 上限",
        searx: "检索服务地址",
      };
      throw Error(
        "请检查：" +
          [...new Set(parsed.error.issues.map((i) => names[String(i.path[0])] ?? String(i.path[0])))].join("、"),
      );
    }
    const next = parsed.data;
    if (typeof secret === "string" && secret.trim()) {
      storeKey(next, secret);
      next.cloud = true; // Pasting a key is the consent to use it.
    }
    store.put("config", "settings", next);
  });
  on("clear-key", () => {
    const f = credentialFile();
    if (existsSync(f)) unlinkSync(f);
  });
  on("test-model", async (v: unknown, secret: unknown) => {
    const cfg = Settings.parse(v);
    const k = typeof secret === "string" && secret.trim() ? validKey(secret) : key(cfg);
    if (!k) throw Error("请先填写 API Key");
    const startedAt = Date.now();
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 30_000);
    try {
      await new DeepSeek(k, cfg.model, cfg).call(
        '只返回 JSON：{"ok":true}',
        { ping: true },
        control.signal,
        () => {},
      );
    } finally {
      clearTimeout(timer);
    }
    return { model: cfg.model, ms: Date.now() - startedAt };
  });
  on("theme", (value: unknown) => {
    const t = z.enum(["light", "sepia", "dark"]).parse(value);
    store.put("config", "theme", t);
    nativeTheme.themeSource = t === "dark" ? "dark" : "light";
    win.setBackgroundColor(THEMES[t].bg);
    try {
      win.setTitleBarOverlay({ color: THEMES[t].bg, symbolColor: THEMES[t].fg, height: 44 });
    } catch {}
  });
  on("data-folder", () => shell.openPath(root));
  on("session", (v) => {
    const value = z.record(z.unknown()).parse(v);
    if (JSON.stringify(value).length > 200000) throw Error("会话过大");
    store.put("session", "current", value);
  });
  on("flag", (id: unknown) => invalidate([z.string().parse(id)]));
  on("correct", (did: unknown, bid: unknown, value: unknown) => {
    const d = getDoc(z.string().parse(did)),
      b = z.string().parse(bid),
      text = z.string().min(1).max(200000).parse(value);
    d.blocks = d.blocks.map((x) =>
      x.id === b ? { ...x, text, readingText: text, regions: undefined, issues: ["人工修订"] } : x,
    );
    store.put("docs", d.id, d);
    invalidate(
      store
        .all<Explanation>("explanations")
        .filter((e) => e.evidence.some((x) => x.doc === d.id && x.block === b))
        .map((e) => e.id),
    );
    return d;
  });
  on("cloud", (id: unknown, allow: unknown) => {
    const d = getDoc(z.string().parse(id));
    store.put("docs", d.id, { ...d, cloud: z.boolean().parse(allow) });
  });
  on("external", async (value: unknown) => {
    const url = new URL(z.string().max(8192).parse(value));
    if (!["https:", "http:", "mailto:"].includes(url.protocol)) throw Error("此链接类型不受支持");
    await shell.openExternal(url.href);
  });
  on("original", async (id: unknown) => {
    const d = getDoc(z.string().parse(id));
    const file = objectPath(d);
    if (!existsSync(file)) throw Error("此记录来自备份恢复，不含原文件；重新导入即可");
    const error = await shell.openPath(file);
    if (error) throw Error("系统无法打开此文件");
  });
  on("restore", async () => {
    const chosen = await dialog.showOpenDialog(win, {
      filters: [{ name: "Subaudi 备份", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (chosen.canceled) return;
    // The envelope must be a Subaudi v1 backup; every record inside is checked on its own, so one
    // damaged or newer-format record is skipped and reported instead of blocking the whole restore.
    const exported = z
      .object({
        schema: z.literal(1),
        documents: z.array(z.unknown()).max(5000),
        explanations: z.array(z.unknown()).max(100000).default([]),
        annotations: z.array(z.unknown()).max(1000000).optional(),
      })
      .parse(JSON.parse(readFileSync(chosen.filePaths[0], "utf8")));
    const each = <T,>(items: unknown[], check: (v: unknown) => T) => {
      const ok: T[] = [];
      let bad = 0;
      for (const item of items)
        try {
          ok.push(check(item));
        } catch {
          bad++;
        }
      return [ok, bad] as const;
    };
    const [documents, badDocs] = each(exported.documents, (v) => RestoreDoc.parse(v));
    const [explanations, badExplanations] = each(exported.explanations, (v) => {
      // Draft is loose here: an explanation saved under older citation rules is tidied, not skipped.
      const e = RestoreExplanation.extend({ draft: z.unknown() }).parse(v);
      const recovered = recoverDraft(e.draft, e.evidence);
      if (!recovered) throw Error("解释无法恢复");
      return { ...e, draft: recovered.draft };
    });
    const [annotations, badNotes] = each(exported.annotations ?? [], (v) => Annotation.parse(v));
    for (const d of documents) {
      if (store.get("docs", d.id)) continue;
      const has = existsSync(objectPath(d));
      store.put("docs", d.id, {
        ...d,
        format: has ? d.format : "snapshot",
        issues: has ? d.issues : [...d.issues, "从导出恢复的文字快照；重新导入原文件可恢复原版式。"],
      });
    }
    for (const e of explanations)
      if (!store.get("explanations", e.id)) store.put("explanations", e.id, e);
    for (const note of annotations)
      if (!store.get("annotations", note.id) && store.get("docs", note.doc))
        store.put("annotations", note.id, note);
    const skipped = [
      badDocs && `${badDocs} 份资料`,
      badExplanations && `${badExplanations} 条解释`,
      badNotes && `${badNotes} 条批注`,
    ].filter(Boolean);
    stage(
      `已恢复 ${documents.length} 份资料与 ${explanations.length} 条解释` +
        (skipped.length ? ` · 跳过 ${skipped.join("、")}（记录损坏或格式不符）` : ""),
    );
  });
  on("export", async () => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `Subaudi-备份-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "Subaudi 备份", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return null;
    writeFileSync(
      r.filePath,
      JSON.stringify({
        schema: 1,
        adapter: ADAPTER_VERSION,
        selectionRenderer: "react-markdown-static-v1",
        documents: store.all("docs"),
        explanations: store.all("explanations"),
        usage: store.all("usage"),
        annotations: store.all("annotations"),
        session: store.get("session", "current"),
      }),
    );
    return r.filePath;
  });
  await win.loadFile(path.join(__dirname, "index.html"));
});
app.on("window-all-closed", () => {
  for (const c of controllers) c.abort();
  [parser, ocrWorker, anki].forEach((w) => w?.stop());
  app.quit();
});
