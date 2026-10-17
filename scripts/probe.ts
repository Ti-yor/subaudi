import { loadPrompt } from "../src/core/prompts";
import { readFileSync, writeFileSync } from "node:fs";
import { DeepSeek } from "../src/providers/deepseek";
import { validateDraft } from "../src/contracts";
const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw Error("需要 DEEPSEEK_API_KEY；尚未调用真实 API");
const cases = JSON.parse(readFileSync("evals/cases.json", "utf8"));
const c = cases.find((x: any) => x.id === (process.argv[2] ?? "K01"));
if (!c) throw Error("案例不存在");
const evidence = [
  {
    source_id: "S1",
    excerpt: c.source,
    title: c.title,
    verification: "source_only",
  },
];
let usage;
const start = Date.now();
const model = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
const raw = await new DeepSeek(key, model).call(
  loadPrompt("prompts", "common") + "\n" + loadPrompt("prompts", "teach"),
  {
    selection: { text: c.source },
    context: c.context,
    reader_profile: c.reader,
    evidence,
    output_schema: JSON.parse(
      readFileSync("prompts/explanation.schema.json", "utf8"),
    ),
  },
  new AbortController().signal,
  (u) => (usage = u),
);
const draft = validateDraft(raw, evidence);
writeFileSync(
  `evals/real-${c.id}.json`,
  JSON.stringify(
    {
      case: c.id,
      model,
      created: new Date().toISOString(),
      elapsed: Date.now() - start,
      usage,
      draft,
      human_review: null,
    },
    null,
    2,
  ),
);
console.log("真实输出已保存；仍需人工教学评审");
