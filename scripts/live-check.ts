import { Diagnosis } from "../src/contracts";
import { teachingPackage } from "../src/core/teaching";
import { loadPrompt, taskInput } from "../src/core/prompts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { DeepSeek } from "../src/providers/deepseek";
import { validateDraft } from "../src/contracts";
import { hash } from "../src/core/primitives";
async function memoryKey(): Promise<string> {
  if (!process.stdin.isTTY)
    throw Error("请在交互式终端运行，避免Key进入历史记录");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("KEY_INPUT_READY (hidden input; held only in memory)\n");
  return new Promise((resolve) => {
    let value = "";
    const listener = (chunk: Buffer) => {
      value += chunk.toString();
      if (/[\r\n]/.test(value)) {
        process.stdin.off("data", listener);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(value.trim());
      }
    };
    process.stdin.on("data", listener);
  });
}

let secret = await memoryKey();
const cases = JSON.parse(readFileSync("evals/cases.json", "utf8"));
const selected = process.argv.slice(2);
if (!selected.length) selected.push("K01");
if (selected.length > 12) throw Error("一次最多12个案例");
const results = [];
let spent = 0;
const runId = Date.now();
mkdirSync("evals/live", { recursive: true });
try {
  for (const id of selected) {
    if (spent >= 100000) break;
    const c = cases.find((x: any) => x.id === id);
    if (!c) throw Error("案例不存在");
    const evidence = [
      {
        source_id: "S1",
        excerpt: c.source,
        title: c.title,
        verification: "source_only",
      },
    ];
    const input: any = {
      language: "zh-CN",
      reader_profile: {
        declared_background: c.reader,
        goal: "独立读回原句、检查条件、完成变式",
      },
      selection: { anchor_id: id, text: c.source },
      context: {
        nearby_blocks: [c.context],
        coverage: "当前原创测试段落",
        extraction_issues: id === "K11" ? ["原图指数符号未确认"] : [],
        parent_excerpt: id === "K13" ? c.source : null,
      },
      evidence,
      capabilities: { web_search: false, vision: false },
      limits: { max_sections: 4, max_checks: 1, max_followups: 3 },
      output_schema: JSON.parse(
        readFileSync("prompts/explanation.schema.json", "utf8"),
      ),
    };
    const calls: any[] = [];
    const start = Date.now();
    const invoke = async (task: string, payload: unknown) => {
      if (calls.length >= 4) throw Error("单案例调用上限4");
      const system =
        loadPrompt("prompts", "common") +
        "\n" +
        loadPrompt("prompts", task) +
        (task === "teach" && id === "K13"
          ? "\n" + loadPrompt("prompts", "child")
          : "");
      const serialized = taskInput(task, payload);
      const reserved =
        Buffer.byteLength(system + JSON.stringify(serialized), "utf8") + 4096;
      if (spent + reserved > 100000) throw Error("本次100000token预算不足");
      spent += reserved;
      const call: any = { task, pipeline: hash(system), usage: null };
      calls.push(call);
      const out = await new DeepSeek(secret, "deepseek-flash").call(
        system,
        serialized,
        new AbortController().signal,
        (u) => {
          call.usage = u;
          spent -= reserved;
          spent += (u as any)?.total_tokens ?? reserved;
        },
      );
      call.output = out;
      return out;
    };
    let result: any;
    try {
      const complex = !["K09", "K10", "K17"].includes(id);
      if (complex)
        input.diagnosis = Diagnosis.parse(await invoke("diagnose", input));
      const output = await teachingPackage(input, evidence, complex, invoke);
      result = {
        case: id,
        model: "deepseek-flash",
        pipeline: JSON.parse(readFileSync("prompts/manifest.json", "utf8"))
          .pipelineVersion,
        input,
        ...output,
        calls,
        elapsedMs: Date.now() - start,
        status: "contract_pass",
        human_review: null,
        learner_trial: null,
      };
    } catch (e) {
      result = {
        case: id,
        status: "failed",
        error: e instanceof Error ? e.message : "failed",
        calls,
        elapsedMs: Date.now() - start,
        human_review: null,
      };
    }
    const saved = JSON.stringify(
      { ...result, date: new Date().toISOString() },
      null,
      2,
    )
      .split(secret)
      .join("[REDACTED]");
    writeFileSync("evals/live/" + id + "-" + runId + ".json", saved);
    results.push({
      case: id,
      status: result.status,
      error: result.error,
      review: result.review,
      calls: calls.map(({ task, usage }) => ({ task, usage })),
      elapsedMs: result.elapsedMs,
    });
    console.log(JSON.stringify(results.at(-1)));
    if (result.status === "failed") break;
  }
} finally {
  secret = "";
  writeFileSync(
    "evals/live/run-" + runId + ".json",
    JSON.stringify(
      { results, totalTokensOrReserved: spent, realAPI: true },
      null,
      2,
    ),
  );
  console.log("Finished. No key written; process memory released on exit.");
}
