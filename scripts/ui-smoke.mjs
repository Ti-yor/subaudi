import { _electron as electron } from "playwright-core";
import path from "node:path";
import { readFileSync, mkdirSync } from "node:fs";
// UI smoke test: imports every fixture, walks select → ask → settings → explain → highlight →
// overview → search → PDF → slides → themes → cards, screenshots each step, fails on any page error.
// The model API is stubbed inside the main process, so no key or tokens are needed.
const out = path.resolve(process.argv[2] || "test-results/ui");
mkdirSync(out, { recursive: true });
const profile = path.resolve("test-results/ui-profile-" + Date.now());
const app = await electron.launch({
  executablePath: (await import("electron")).default,
  args: [".", "--user-data-dir=" + profile, "--lang=zh-CN", ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
});
await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption?.(true));
const errors = [];
const page = await app.firstWindow();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(out, name + ".png") }); console.log("shot", name); };
await page.waitForSelector(".welcome");
await shot("01-welcome");
const fixture = readFileSync("evals/fixture-explanation.json", "utf8");
const overview = JSON.stringify({ kind: "content_overview", scope: "", central_question: "连续和可导是同一回事吗？", route: [{ block_ids: ["b0"], role: "先给出连续的直观含义" }, { block_ids: ["b1"], role: "用 |x| 说明连续不保证可导" }], outcomes: [], essential_prerequisites: [{ term: "极限", reason: "", entry: "x 越来越接近某个数时，函数值接近什么。" }], likely_obstacles: [{ block_id: "b1", question: "为什么 |x| 在 0 处没有导数？", priority: "blocking" }], unknowns: [] });
await app.evaluate(async ({ }, { fixture, overview }) => {
  globalThis.fetch = async (url, init) => {
    await new Promise((r) => setTimeout(r, 700));
    const body = String(init?.body ?? "");
    const content = body.includes("max_prerequisites") ? overview : body.includes("ping") ? '{"ok":true}' : fixture;
    return new Response(JSON.stringify({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 1800, completion_tokens: 900, total_tokens: 2700 } }), { headers: { "content-type": "application/json" } });
  };
}, { fixture, overview });
const importFile = async (f) => {
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, path.resolve("fixtures", f));
  await page.keyboard.press("Control+O");
  await page.waitForTimeout(900);
};
for (const f of ["数字与扫描混合.pdf", "幻灯片示例.pptx", "重排示例.docx", "中文.txt", "入门教材.md"]) await importFile(f);
await page.waitForSelector(".text-column");
await shot("02-reader-md");
// select a sentence in the first paragraph block
const box = await page.evaluate(() => {
  const el = [...document.querySelectorAll(".text-column [data-block] p, .text-column [data-block]")].find((e) => (e.textContent || "").length > 30);
  const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange(); r.setStart(node, 0); r.setEnd(node, Math.min(node.textContent.length, 24));
  getSelection().removeAllRanges(); getSelection().addRange(r);
  const b = r.getBoundingClientRect(); return { x: b.right - 2, y: b.top + b.height / 2 };
});
// selection set programmatically
await page.evaluate(() => { const el = document.querySelector(".reader"); el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })); });
await page.waitForSelector(".selbar");
await shot("03-selection-bar");
await page.click(".selbar button:has-text('提问')");
await page.waitForSelector(".composer");
await page.fill(".composer textarea", "为什么连续还不能求导？");
await shot("04-ask-composer-nokey");
await page.click(".composer .btn.primary");
await page.waitForSelector(".callout");
await shot("05-needs-settings");
await page.click(".callout .btn:has-text('打开设置')");
await page.waitForSelector(".settings");
await page.fill(".key-row input", "sk-test-0123456789abcdef");
await page.click(".key-row .btn");
await page.waitForSelector(".status-pill.ok", { timeout: 15000 }).catch(() => {});
await page.fill("textarea[placeholder^='例如']", "大一学生，学过高中数学，刚开始学微积分。");
await shot("06-settings-ai");
await page.click(".pane-foot .btn.primary");
await page.waitForTimeout(600);
await page.click(".settings nav button:has-text('阅读')");
await shot("07-settings-reading");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.click(".composer .btn.primary");
await page.waitForSelector(".working");
await shot("08-explaining");
await page.waitForSelector(".note-title", { timeout: 20000 });
await shot("09-explanation");
await page.evaluate(() => document.querySelectorAll(".margin details").forEach((d) => (d.open = true)));
await page.evaluate(() => document.querySelector(".margin-body").scrollTo(0, 99999));
await shot("10-explanation-sources");
// highlight
await page.evaluate(() => {
  const els = [...document.querySelectorAll(".text-column [data-block]")].filter((e) => (e.textContent || "").length > 30);
  const el = els[1] || els[0];
  const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange(); r.setStart(node, 2); r.setEnd(node, Math.min(node.textContent.length, 20));
  getSelection().removeAllRanges(); getSelection().addRange(r);
  document.querySelector(".reader").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
});
await page.waitForSelector(".selbar");
await page.click(".selbar .swatch >> nth=1");
await page.waitForTimeout(500);
await page.click(".side-tabs button >> nth=0");
await shot("11-highlight-sidebar");
// overview
await page.click(".reader-bar .btn:has-text('导读')");
await page.waitForSelector(".overview-route", { timeout: 15000 });
await shot("12-overview");
// palette
await page.keyboard.press("Control+K");
await page.waitForSelector(".palette");
await page.keyboard.type("连续");
await page.waitForTimeout(600);
await shot("13-palette");
await page.keyboard.press("Escape");
// pdf
await page.click(".doc-row:has-text('数字与扫描混合')");
await page.waitForSelector(".pdf-page canvas", { timeout: 20000 });
await page.waitForTimeout(1500);
await shot("14-pdf");
await page.click(".reader-bar .icon-btn[title='更多']");
await shot("15-pdf-menu");
await page.keyboard.press("Escape");
// pptx
await page.click(".doc-row:has-text('幻灯片示例')");
await page.waitForSelector(".slide-mark", { timeout: 10000 }).catch(() => {});
await page.click(".reader-bar .icon-btn[title='目录']").catch(() => {});
await shot("16-pptx-outline");
// themes
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
await page.click(".doc-row:has-text('入门教材')");
await page.waitForTimeout(700);
await shot("17-dark");
await page.evaluate(() => { document.documentElement.dataset.theme = "sepia"; });
await shot("18-sepia");
await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
await page.click(".tab-switch button:has-text('卡片')");
await page.waitForTimeout(2500);
await shot("19-cards");
await app.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("UI smoke passed · screenshots in " + out);
