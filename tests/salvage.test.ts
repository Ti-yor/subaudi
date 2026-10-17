import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Overview, Diagnosis, Review, validateDraft } from "../src/contracts";
import { salvage, trySalvage, recoverDraft, tidyDraft } from "../src/core/salvage";
import { teachingPackage, NOT_CACHED } from "../src/core/teaching";

const fixture = JSON.parse(readFileSync("evals/fixture-explanation.json", "utf8"));
const evidence = [{ source_id: "S1", excerpt: "f(x)=|x|", title: "fixture", verification: "source_only" }];

test("overview: extra list items, one bad entry and unknown keys are trimmed, not fatal", () => {
  const raw = {
    kind: "content_overview",
    scope: "s",
    central_question: "q",
    route: [],
    outcomes: ["a"],
    essential_prerequisites: [],
    likely_obstacles: [
      ...Array.from({ length: 6 }, (_, i) => ({ block_id: "b", question: "q" + i, priority: "useful" })),
      { block_id: "b", question: "bad", priority: "urgent" },
    ],
    unknowns: [],
    extra_field: true,
  };
  assert.throws(() => Overview.parse(raw));
  const { data, dropped } = salvage(Overview, raw);
  assert.equal(data.likely_obstacles.length, 5);
  assert.equal(dropped, 2); // one invalid priority + one over the max of 5
  assert.equal("extra_field" in data, false);
  assert.throws(() => salvage(Overview, { kind: "nonsense" })); // structurally unusable still fails
});

test("diagnosis and review: one malformed gap/issue is dropped", () => {
  const diagnosis = trySalvage(Diagnosis, {
    status: "ready", discipline_route: "formal", in_context_meaning: "m", statement_type: "definition",
    gaps: [
      { kind: "term", question: "q", priority: "blocking", anchor_id: "a" },
      { kind: "definition", question: "q", priority: "blocking", anchor_id: "a" },
    ],
    prerequisites: [], conditions_to_check: [], evidence_requests: [], teaching_goal: "g",
    suggested_section_kinds: [], clarification: null,
  });
  assert.equal(diagnosis?.data.gaps.length, 1);
  const review = trySalvage(Review, {
    verdict: "revise",
    issues: [{ severity: "major", location: "x", problem: "p", evidence_ids: [], required_change: "c" }, { severity: "??" }],
    unverified: [],
  });
  assert.equal(review?.data.issues.length, 1);
  assert.equal(trySalvage(Review, "not an object"), undefined);
});

test("draft: dangling citations and references are tidied instead of rejecting the draft", () => {
  const d = structuredClone(fixture);
  d.sections[0].evidence_ids = ["S9"];
  d.sections[0].body_markdown += " 另见 [S7]。";
  d.claims[2].derivation_section_id = "nowhere";
  d.extra = "from a newer model";
  assert.throws(() => validateDraft(d, evidence));
  const r = recoverDraft(d, evidence);
  assert.ok(r && r.fixes > 0);
  assert.doesNotMatch(r!.draft.sections[0].body_markdown, /\[S7\]/);
  assert.equal(r!.draft.claims[2].basis, "uncertain");
  validateDraft(r!.draft, evidence); // result satisfies the strict contract
  assert.equal(tidyDraft(validateDraft(fixture, evidence), evidence).fixes, 0); // a valid draft is untouched
});

const passReview = { verdict: "pass", issues: [], unverified: [] };
test("insufficient evidence keeps the explanation as limited and uncached", async () => {
  const r = await teachingPackage({}, evidence, true, async (task) =>
    task === "teach" ? fixture : { verdict: "insufficient_evidence", issues: [], unverified: ["结论 X 无出处"] },
  );
  assert.equal(r.draft.status, "limited");
  assert.ok(r.draft.unresolved.some((u) => u.issue === "结论 X 无出处"));
  assert.match(r.review, new RegExp(NOT_CACHED));
});

test("a failed repair falls back to the earlier valid draft", async () => {
  const stages: string[] = [];
  const r = await teachingPackage({}, evidence, true, async (task) => {
    stages.push(task);
    if (task === "teach") return fixture;
    if (task === "review")
      return { verdict: "revise", issues: [{ severity: "major", location: "x", problem: "p", evidence_ids: [], required_change: "c" }], unverified: [] };
    return { garbage: true };
  });
  assert.deepEqual(stages, ["teach", "review", "repair"]);
  assert.equal(r.draft.title, fixture.title);
  assert.equal(r.draft.status, "limited");
  assert.match(r.review, /保留初稿/);
  assert.match(r.review, new RegExp(NOT_CACHED));
});

test("an unparsable review does not lose the explanation", async () => {
  const r = await teachingPackage({}, evidence, true, async (task) => (task === "teach" ? fixture : "???"));
  assert.equal(r.draft.status, "limited");
  assert.match(r.review, /未经模型审查/);
});

test("passing explanations are unchanged and cacheable; nothing usable still throws", async () => {
  const ok = await teachingPackage({}, evidence, true, async (task) => (task === "teach" ? fixture : passReview));
  assert.equal(ok.draft.status, "complete");
  assert.doesNotMatch(ok.review, new RegExp(NOT_CACHED));
  await assert.rejects(teachingPackage({}, evidence, false, async () => ({ junk: 1 })), /无法使用/);
});
