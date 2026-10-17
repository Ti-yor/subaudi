import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateDraft, Request } from "../src/contracts";
import { cpSlice, verifyAnchor, Flights, hash } from "../src/core/primitives";
import { Store } from "../src/storage/store";
import { DeepSeek } from "../src/providers/deepseek";
const fixture = JSON.parse(
  readFileSync("evals/fixture-explanation.json", "utf8"),
);
const evidence = [
  {
    source_id: "S1",
    excerpt: "f(x)=|x|",
    title: "fixture",
    verification: "source_only",
  },
];
test("教学包结构与引用契约", () => {
  assert.equal(validateDraft(fixture, evidence).status, "complete");
  assert.throws(() => validateDraft({ ...fixture, secret: "x" }, evidence));
  assert.throws(() => validateDraft(fixture, []));
});
test("推导不得缺可检查位置", () => {
  const d = structuredClone(fixture);
  d.claims[2].derivation_section_id = null;
  assert.throws(() => validateDraft(d, evidence));
});
test("中文 emoji 组合字符 offset 不截断", () => {
  const text = "中文🧭e\u0301条件";
  assert.equal(cpSlice(text, 2, 5), "🧭e\u0301");
  verifyAnchor(text, { start: 2, end: 5, quote: "🧭e\u0301" });
  assert.throws(() => verifyAnchor(text, { start: 3, end: 5, quote: "🧭" }));
});
test("single-flight 只调用一次且失败可重试", async () => {
  const f = new Flights();
  let calls = 0;
  const fn = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return 7;
  };
  assert.deepEqual(await Promise.all([f.run("a", fn), f.run("a", fn)]), [7, 7]);
  assert.equal(calls, 1);
  await f.run("a", fn);
  assert.equal(calls, 2);
});
test("SQLite 重启持久化与中文检索原文保存", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "subaudi-")), "db");
  const a = new Store(file);
  await a.init();
  a.put("docs", "d", { text: "中文🧭" });
  const b = new Store(file);
  await b.init();
  assert.deepEqual(b.get("docs", "d"), { text: "中文🧭" });
});
test("缓存签名区别读者与上下文", () => {
  assert.notEqual(
    hash({ word: "域", context: "数学" }),
    hash({ word: "域", context: "软件" }),
  );
  assert.notEqual(hash({ reader: "入门" }), hash({ reader: "熟悉" }));
});
test("IPC 拒绝任意额外字段", () => {
  assert.throws(() =>
    Request.parse({
      anchor: { doc: "d", block: "b", start: 0, end: 1, quote: "中" },
      parent: null,
      complex: false,
      query: "",
      mode: "teach",
      command: "read key",
    }),
  );
});
test("30个原创内容基准都有判据，未伪造人工/学习者结果", () => {
  const cases = JSON.parse(readFileSync("evals/cases.json", "utf8"));
  assert.ok(cases.length >= 30);
  for (const c of cases) {
    assert.ok(c.required_bridges.length);
    assert.ok(c.transfer.criteria);
    assert.equal(c.learner_trial, null);
  }
});
test("模型空输出、截断、401 不自动重试", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response("", { status: 401 }),
      Response.json({
        choices: [{ finish_reason: "length", message: { content: "{}" } }],
      }),
      Response.json({
        choices: [{ finish_reason: "stop", message: { content: "" } }],
      }),
    ]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return response;
      };
      await assert.rejects(() =>
        new DeepSeek("fixture-secret", "deepseek-flash").call(
          "JSON",
          {},
          new AbortController().signal,
          () => {},
        ),
      );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});
import { publicAddress } from "../src/providers/search";
test("正文读取拒绝回环、私网、链路本地与多播", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "224.1.1.1",
    "239.1.1.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("FTS5 中文短词查询限显式资料范围", async () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "subaudi-fts-")),
    "db",
  );
  const db = new Store(file);
  await db.init();
  for (const id of ["allowed", "private"])
    db.put("docs", id, {
      id,
      blocks: [{ id: "b", text: "域是代数结构，中文短词检索" }],
    });
  assert.deepEqual(
    db.search("域", ["allowed"]).map((x) => x.doc),
    ["allowed"],
  );
  assert.deepEqual(db.search("域", []), []);
  db.close();
});
test("基准数值复算：独立硬币与复制误差", () => {
  const variance = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length;
  };
  assert.equal(variance([0, 1, 1, 2]), 0.5);
  assert.equal(variance([0, 2]), 1);
  assert.equal(variance([0, 2]), 4 * variance([0, 1]));
});
import { teachingPackage } from "../src/core/teaching";
import { taskInput } from "../src/core/prompts";
test("审查任务不携带教学 schema，任务类型不能冲突", () => {
  assert.deepEqual(
    taskInput("review", {
      task: "teach",
      output_schema: { bad: true },
      candidate: {},
    }),
    { task: "review", candidate: {} },
  );
});
test("结构与语义问题合并为至多一次修订，未复审不自动复用", async () => {
  const broken = structuredClone(fixture);
  broken.sections[0].evidence_ids = [];
  const stages: string[] = [];
  const result = await teachingPackage({}, evidence, true, async (task) => {
    stages.push(task);
    if (task === "teach") return broken;
    if (task === "review")
      return {
        verdict: "revise",
        issues: [
          {
            severity: "major",
            location: "brief",
            problem: "fixture issue",
            evidence_ids: [],
            required_change: "fixture repair",
          },
        ],
        unverified: [],
      };
    if (task === "repair") return fixture;
    throw Error("unexpected call");
  });
  assert.deepEqual(stages, ["teach", "review", "repair"]);
  assert.equal(result.draft.status, "limited");
  assert.match(result.review, /未复审/);
});
test("简单合格解释只调用一次", async () => {
  let calls = 0;
  await teachingPackage({}, evidence, false, async () => {
    calls++;
    return fixture;
  });
  assert.equal(calls, 1);
});
import { markdownText } from "../src/core/markdown";
test("Markdown 锚点使用相同安全DOM的可见文本，跨格式与Unicode不漂移", () => {
  const text = markdownText("含 **粗体**、*斜体* 和 🧭 的条件。");
  assert.equal(text, "含 粗体、斜体 和 🧭 的条件。");
  verifyAnchor(text, { start: 2, end: 7, quote: "粗体、斜体" });
  assert.equal(markdownText("<script>readKey()</script>"), "");
  assert.equal(markdownText("A & B < C"), "A & B < C");
});
