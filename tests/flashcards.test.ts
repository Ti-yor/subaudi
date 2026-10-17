import { test } from "node:test";
import assert from "node:assert/strict";
import { cardBatches, groundedCards, locateQuote } from "../src/core/flashcards";
import { AnkiRequest } from "../src/anki-contracts";
import type { Doc } from "../src/contracts";
const doc: Doc = {
  id: "d",
  name: "教材",
  format: "pptx",
  reference: false,
  cloud: true,
  issues: [],
  blocks: [
    {
      id: "b",
      text: "记忆来自主动提取。",
      kind: "paragraph",
      locator: "第1页",
      issues: [],
    },
  ],
};
test("generated cards are grounded, escaped, and unverifiable ones are flagged instead of rejected", () => {
  const batch = cardBatches(doc)[0];
  const card = { question: "<script>test</script>", answer: "&答", block: "b", quote: "主动提取" };
  const ok = groundedCards([card], doc, batch);
  assert.match(ok.cards[0].question, /&lt;script&gt;/);
  assert.match(ok.cards[0].source, /第1页/);
  assert.equal(ok.unverified, 0);
  assert.equal(ok.cards[0].review, undefined);
  // Wrong block id but the quote is in the batch: re-attributed, still verified.
  assert.equal(groundedCards([{ ...card, block: "other" }], doc, batch).unverified, 0);
  // Width / whitespace drift still counts as verbatim.
  assert.equal(groundedCards([{ ...card, quote: "主动 提取" }], doc, batch).unverified, 0);
  // Not in the source: kept, flagged for review, the rest of the batch is unaffected.
  const mixed = groundedCards([card, { ...card, question: "另一题", quote: "不存在" }], doc, batch);
  assert.equal(mixed.cards.length, 2);
  assert.equal(mixed.unverified, 1);
  assert.equal(mixed.cards[1].review, true);
  assert.match(mixed.cards[1].source, /请核对/);
});
test("quote matching tolerates full-width punctuation and line breaks", () => {
  const batch = [{ id: "x", text: "方差：E[(X-μ)^2]，\n衡量离散程度。" }];
  assert.equal(locateQuote(batch, "x", "方差:E[(X-μ)^2],衡量离散程度。"), "x");
  assert.equal(locateQuote(batch, "x", "完全无关"), undefined);
  assert.equal(locateQuote(batch, "x", ""), undefined);
});
test("batching covers long source tails and ignores untranscribed pictures", () => {
  const long = {
    ...doc,
    blocks: [
      { ...doc.blocks[0], text: "长".repeat(19000) + "结束" },
      { ...doc.blocks[0], id: "image", kind: "image", text: "[图像]" },
    ],
  };
  const batches = cardBatches(long);
  assert.ok(batches.length > 1);
  assert.ok(batches.flat().some((b) => b.text.endsWith("结束")));
  assert.ok(
    batches.every((b) => b.reduce((n, x) => n + x.text.length, 0) <= 9000),
  );
  assert.ok(batches.flat().every((b) => b.id !== "image"));
});
test("IPC rejects unsafe identifiers, fields, and review ratings", () => {
  assert.equal(
    AnkiRequest.safeParse({ op: "answer", token: "x", rating: 5 }).success,
    false,
  );
  assert.equal(
    AnkiRequest.safeParse({ op: "card", id: "../collection" }).success,
    false,
  );
  assert.equal(
    AnkiRequest.safeParse({ op: "import", path: "evil", scheduling: false })
      .success,
    false,
  );
});
