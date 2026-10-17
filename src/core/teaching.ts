import { Review, type DraftType, type Evidence } from "../contracts";
import { recoverDraft, trySalvage } from "./salvage";
export type TaskCall = (task: string, input: unknown) => Promise<unknown>;

/** Review strings containing this marker are never served from the automatic reuse cache. */
export const NOT_CACHED = "不进入自动复用缓存";

const limited = (draft: DraftType, notes: string[]): DraftType => ({
  ...draft,
  status: draft.status === "needs_clarification" ? draft.status : "limited",
  unresolved: [
    ...draft.unresolved,
    ...notes.map((issue) => ({ issue, effect_on_answer: "相关结论可能不完整或无法核实", next_step: "对照原文核对，必要时追问或补充资料" })),
  ].slice(0, 20),
});

/**
 * Builds the explanation. Problems in one model response degrade the result (mechanical tidy-up,
 * "limited" status, not cached) instead of discarding it; only "no usable draft at all" throws.
 */
export async function teachingPackage(
  input: Record<string, unknown>,
  evidence: Evidence[],
  complex: boolean,
  invoke: TaskCall,
): Promise<{ draft: DraftType; review: string; repaired: boolean }> {
  const candidate = await invoke("teach", input);
  const first = recoverDraft(candidate, evidence);
  let draft = first?.draft;
  const notes: string[] = []; // review-string fragments, joined at the end
  if (first?.fixes) notes.push(`自动整理了 ${first.fixes} 处结构或引用`);
  const issues: unknown[] = [];
  if (!draft)
    issues.push({
      severity: "major",
      location: "schema/citations",
      problem: "响应不符合 output_schema，且无法自动整理",
      required_change:
        "按 output_schema 修复结构；每节 evidence_ids 与正文 [S#] 引用集合必须一致，不添加无关引用",
    });
  // Base verdict, as before; notes add what was degraded; NOT_CACHED keeps degraded results out of reuse.
  let base = complex ? "模型审查通过；不代表事实或学习效果已验证" : "程序契约检查通过；未独立事实核查";
  let cacheable = true;
  if (complex) {
    const audit = trySalvage(Review, await invoke("review", { ...input, candidate }))?.data;
    if (!audit) {
      base = "审查结果无法解析，未经模型审查";
      cacheable = false;
      if (draft) draft = limited(draft, ["本条解释未经过模型审查"]);
    } else {
      if (audit.verdict === "insufficient_evidence") {
        // Keep the explanation, say plainly which points could not be verified.
        base = "审查认为证据不足，已标记资料有限";
        cacheable = false;
        if (draft) draft = limited(draft, audit.unverified.length ? audit.unverified : ["审查认为现有资料不足以支持部分结论"]);
      }
      issues.push(...audit.issues.filter((i) => i.severity !== "minor"));
      if (audit.verdict === "revise" && !issues.length)
        issues.push({
          problem: "审查要求修改但没有可定位问题",
          required_change: "收窄无法核实的结论并填写 unresolved",
        });
    }
  }
  if (issues.length) {
    const repaired = recoverDraft(await invoke("repair", { ...input, candidate, review: { issues } }), evidence);
    if (repaired) {
      let fixed = repaired.draft;
      if (complex) {
        fixed = { ...fixed, status: fixed.status === "needs_clarification" ? fixed.status : "limited" };
        base = "已按审查修订但未复审";
        cacheable = false;
      } else base = "结构修复后通过契约检查；未独立事实核查";
      if (repaired.fixes) notes.push(`修订稿自动整理了 ${repaired.fixes} 处`);
      return { draft: fixed, review: finish(base, notes, cacheable), repaired: true };
    }
    if (!draft) throw Error("模型两次返回的解释都无法使用，请重试");
    // Repair failed: keep the earlier usable draft rather than discarding paid work.
    draft = limited(draft, complex ? ["审查指出的问题未能自动修订，请对照原文核对"] : []);
    notes.push("修订稿无法使用，保留初稿");
    cacheable = false;
  }
  if (!draft) throw Error("没有通过校验的教学包");
  return { draft, review: finish(base, notes, cacheable), repaired: false };
}

function finish(base: string, notes: string[], cacheable: boolean) {
  return [base, ...notes, ...(cacheable ? [] : [NOT_CACHED])].join("；");
}
