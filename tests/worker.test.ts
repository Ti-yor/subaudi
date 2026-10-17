import { test } from "node:test";
import assert from "node:assert/strict";
import { LineWorker } from "../src/core/worker";
import { estimateTokens } from "../src/core/primitives";
import { Store } from "../src/storage/store";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const echo = `process.stdin.setEncoding("utf8");let b="";process.stdin.on("data",c=>{b+=c;let i;while((i=b.indexOf("\\n"))>=0){const l=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(l.hang)continue;console.log("diagnostic noise");console.log(JSON.stringify(l.fail?{error:"boom"}:{result:{n:l.n,pid:process.pid}}))}})`;
const worker = () => new LineWorker("测试进程", () => ({ exe: process.execPath, args: ["-e", echo] }));
test("常驻 worker 复用同一进程并按序回复，忽略诊断输出", async () => {
  const w = worker();
  const [a, b, c] = await Promise.all([w.call({ n: 1 }), w.call({ n: 2 }), w.call({ n: 3 })]);
  assert.deepEqual([a.n, b.n, c.n], [1, 2, 3]);
  assert.equal(a.pid, c.pid);
  await assert.rejects(w.call({ fail: true }), /boom/);
  assert.equal((await w.call({ n: 4 })).pid, a.pid);
  w.stop();
});
test("worker 超时与取消会结束进程，下次调用自动重启", async () => {
  const w = worker();
  const first = (await w.call({ n: 1 })).pid;
  await assert.rejects(w.call({ hang: true }, { timeout: 200 }), /200|秒/);
  const control = new AbortController();
  const pending = w.call({ hang: true }, { signal: control.signal });
  control.abort();
  await assert.rejects(pending, /取消/);
  assert.notEqual((await w.call({ n: 2 })).pid, first);
  w.stop();
});
test("token 估算：中文约 1 token/字，不再按 UTF-8 字节三倍高估", () => {
  const zh = "期望是按概率加权的平均值".repeat(100);
  assert.ok(estimateTokens(zh) < Buffer.byteLength(zh) / 2);
  assert.ok(estimateTokens(zh) >= Array.from(zh).length);
  assert.ok(estimateTokens("hello world ".repeat(100)) < 500);
});
test("阅读器搜索：大小写不敏感的字面匹配，并给出命中位置", async () => {
  const db = new Store(path.join(mkdtempSync(path.join(tmpdir(), "sa-find-")), "db"));
  await db.init();
  db.put("docs", "d", { id: "d", blocks: [{ id: "b", text: "The Fourier Transform 与卷积定理" }] });
  const [hit] = db.find("fourier", ["d"]);
  assert.equal(hit.block, "b");
  assert.equal(hit.at, 5);
  assert.deepEqual(db.find("卷积", ["other"]), []);
  db.close();
});
