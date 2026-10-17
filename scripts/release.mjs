// One-shot Windows release: environment check → tests → sidecars → EXE → protocol smoke test.
// Usage: node scripts/release.mjs [--fast] [--smoke-only]
//   --fast        skip type check and tests (sidecars are still smoke-tested)
//   --smoke-only  only smoke-test the sidecars already in release/win-unpacked
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources = path.join(root, "release", "win-unpacked", "resources");

const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};
const step = (n, total, title) => console.log(`\n[${n}/${total}] ${title}`);

/** Run a shell command in the repo root with live output; abort the release on failure. */
function run(command) {
  console.log(`  > ${command}`);
  const r = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`命令失败（退出码 ${r.status ?? "?"}）：${command}`);
}
function output(command) {
  const r = spawnSync(command, { cwd: root, encoding: "utf8", shell: true });
  return r.status === 0 ? (r.stdout + r.stderr).trim() : null;
}

/**
 * PyInstaller ends a crash with a generic "[PYI-…:ERROR] Failed to execute script" line; the useful
 * part is the Python exception above it. Show that line, plus the traceback tail as indented context.
 */
export function crashReason(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  if (!lines.length) return "";
  const meaningful = lines.filter((l) => !/^\[PYI-\d+:/.test(l));
  const exception = [...meaningful].reverse().find((l) => /^[\w.]+(Error|Exception|Exit|Interrupt)\b/.test(l));
  const head = exception ?? meaningful.at(-1) ?? lines.at(-1);
  const context = meaningful.slice(-8).filter((l) => l !== head).map((l) => "\n      " + l).join("");
  return "：" + head + context;
}

/**
 * Talk to a sidecar exactly the way src/core/worker.ts does: one JSON line per
 * request, no `id`, first JSON reply wins. Resolves with `result`, rejects on
 * `error`, early exit or timeout.
 */
export function smoke(exe, args, request, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    let exited = false;
    child.on("exit", () => (exited = true));
    // Settle only after the process has exited (stdin EOF ends every sidecar's loop; kill after 3 s),
    // so no smoke-tested exe is left running and holding files in release/.
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      if (exited) return fn(value);
      const force = setTimeout(() => child.kill(), 3000);
      child.once("exit", () => {
        clearTimeout(force);
        fn(value);
      });
    };
    const timer = setTimeout(() => finish(reject, Error(`${timeout / 1000} 秒内无应答`)), timeout);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
      for (const line of out.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let reply;
        try { reply = JSON.parse(line); } catch { continue; }
        if ("error" in reply && reply.error) return finish(reject, Error(`返回错误：${reply.error}`));
        if ("result" in reply) return finish(resolve, reply.result);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (err = (err + chunk).slice(-2000)));
    child.on("error", (e) => finish(reject, Error(`无法启动：${e.message}`)));
    child.on("close", (code) => finish(reject, Error(`意外退出（${code}）${crashReason(err)}`)));
    child.stdin.write(JSON.stringify(request) + "\n");
  });
}

async function smokeAll() {
  const home = mkdtempSync(path.join(tmpdir(), "subaudi-smoke-"));
  const checks = [
    {
      name: "卡片库内核",
      exe: path.join(resources, "anki", "subaudi-anki.exe"),
      args: [home],
      request: { op: "status", protocol: 1 },
      timeout: 60_000,
      ok: (r) => typeof r?.version === "string" && Array.isArray(r.decks),
      describe: (r) => `Anki ${r.version}，${r.decks.length} 个牌组`,
    },
    {
      name: "文档解析",
      exe: path.join(resources, "parser", "subaudi-parser", "subaudi-parser.exe"),
      args: [],
      request: { path: path.join(root, "fixtures", "重排示例.docx") },
      timeout: 60_000,
      ok: (r) => Array.isArray(r?.blocks) && r.blocks.length > 0,
      describe: (r) => `解析出 ${r.blocks.length} 个段落块`,
    },
    {
      name: "文字识别",
      exe: path.join(resources, "parser", "ocr", "subaudi-ocr.exe"),
      args: [],
      request: { path: path.join(root, "fixtures", "数字与扫描混合.pdf"), page: 0 },
      timeout: 180_000, // first call loads the ONNX models
      ok: (r) => Array.isArray(r?.regions),
      describe: (r) => `识别出 ${r.regions.length} 个文字区域`,
    },
  ];
  let failed = 0;
  try {
    for (const c of checks) {
      if (!existsSync(c.exe)) {
        console.error(`  ✖ ${c.name}：发布包中缺少 ${path.relative(root, c.exe)}`);
        failed++;
        continue;
      }
      try {
        const result = await smoke(c.exe, c.args, c.request, c.timeout);
        if (!c.ok(result)) throw Error("应答格式不符：" + JSON.stringify(result).slice(0, 200));
        console.log(`  ✔ ${c.name}：${c.describe(result)}`);
      } catch (e) {
        console.error(`  ✖ ${c.name}：${e.message}`);
        failed++;
      }
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  if (failed) fail(`${failed} 个组件冒烟测试失败，发布包不可用`);
}

/** Processes whose executable lives under release/ (an opened Subaudi.exe, its sidecars, the portable EXE). */
function runningFromRelease() {
  const dir = path.join(root, "release").replace(/'/g, "''");
  const ps =
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}\\', 'OrdinalIgnoreCase') } | ` +
    `ForEach-Object { '{0}\t{1}' -f $_.ProcessId, $_.ExecutablePath }`;
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, exe] = line.split("\t");
      return { pid: Number(pid), exe };
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * electron-builder replaces release/win-unpacked and the portable EXE in place; Windows refuses while
 * any of those files is running ("EPERM … unlink Subaudi.exe"). Find such processes first and offer to
 * close them, then clear the old output with retries (antivirus scanners briefly lock fresh EXEs).
 */
async function freeReleaseFolder() {
  let procs = runningFromRelease();
  if (procs.length) {
    console.log("  release/ 中的以下程序正在运行，Windows 不允许覆盖它们：");
    for (const p of procs) console.log(`    PID ${p.pid}  ${path.relative(root, p.exe)}`);
    let close = false;
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      close = /^y(es)?$|^是$/i.test((await rl.question("  关闭这些程序后继续？未保存的内容可能丢失 [y/N] ")).trim());
      rl.close();
    }
    if (!close) fail("请先关闭从 release 文件夹打开的 Subaudi，再重新运行打包");
    // Without /F, taskkill asks the window to close, so Subaudi shuts down normally; /T includes sidecars.
    for (const p of procs) spawnSync("taskkill", ["/PID", String(p.pid), "/T"], { windowsHide: true });
    for (let i = 0; i < 20 && (procs = runningFromRelease()).length; i++) await sleep(500);
    for (const p of procs) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true });
    await sleep(1000);
    if (runningFromRelease().length) fail("仍有程序未退出，请在任务管理器中结束后重试");
    console.log("  已关闭");
  }
  try {
    rmSync(path.join(root, "release", "win-unpacked"), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (e) {
    fail(`无法清理 release\\win-unpacked（${e.code ?? e.message}）。可能被杀毒软件或资源管理器占用，关闭后重试`);
  }
}

function checkEnvironment() {
  if (process.platform !== "win32") fail("打包发布版需要 Windows（sidecar 由 PyInstaller 构建 Windows 可执行文件）");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) fail(`需要 Node.js 22.13 或更高，当前为 ${process.version}`);
  console.log(`  Node.js ${process.version}`);
  const py = output("python --version");
  if (!py) fail("找不到 python，请安装 Python 3.13 并加入 PATH");
  if (!/^Python 3\.13\./.test(py)) fail(`需要 Python 3.13，当前为 ${py}`);
  console.log(`  ${py}`);
  if (!output("python -m PyInstaller --version")) fail("未安装 PyInstaller：python -m pip install -r services/parser/requirements.txt");
  if (!existsSync(path.join(root, "node_modules"))) {
    console.log("  未找到 node_modules，正在安装依赖");
    run("npm ci");
  }
  if (!existsSync(path.join(root, ".tools", "parser-runtime", "olefile"))) {
    console.log("  未找到文档解析运行时（olefile），正在安装");
    run("npm run setup:parser");
  }
  if (!existsSync(path.join(root, ".tools", "anki-runtime", "anki"))) {
    console.log("  未找到 Anki 内核运行时，正在安装");
    run("npm run setup:anki");
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const started = Date.now();
  if (flags.has("--smoke-only")) {
    console.log("冒烟测试 release/win-unpacked 中的 sidecar");
    await smokeAll();
    return console.log("\n✔ 全部通过");
  }
  const fast = flags.has("--fast");
  const total = fast ? 4 : 5;
  let n = 0;

  step(++n, total, "检查环境");
  checkEnvironment();

  if (!fast) {
    step(++n, total, "类型检查与测试");
    run("npm run check");
    run("npm test");
    run("npm run test:anki");
  }

  step(++n, total, "构建 sidecar（Office 解析、OCR、卡片库内核）");
  run("npm run build:sidecars");
  run("npm run build:anki");
  // Regenerate the third-party notices from the bundles just built, so the EXE never ships a stale list.
  run("npm run licenses");

  step(++n, total, "构建便携版 EXE");
  await freeReleaseFolder();
  run("npm run dist");

  step(++n, total, "冒烟测试发布包中的 sidecar（与应用相同的协议）");
  await smokeAll();

  const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const exe = `Subaudi ${version}.exe`;
  const file = path.join(root, "release", exe);
  if (!existsSync(file)) fail(`release/ 中没有找到 ${exe}`);
  const size = (statSync(file).size / 1024 / 1024).toFixed(1);
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n✔ 打包完成：release\\${exe}（${size} MB，用时 ${minutes} 分钟）`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => fail(e.stack || e.message));
