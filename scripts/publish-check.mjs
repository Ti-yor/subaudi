// Pre-upload check: scans what git is about to publish and refuses if it finds a secret, personal
// data, a private textbook, or a file GitHub would reject.
//
//   node scripts/publish-check.mjs          check every tracked + staged file (before the first push)
//   node scripts/publish-check.mjs --staged check only what is staged (use as a pre-commit hook)
//
// .gitignore only stops files that were never added; this also catches a key pasted into a source
// file, a textbook dropped into docs/, or a database committed before the ignore rule existed.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const staged = process.argv.includes("--staged");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let files;
try {
  files = (staged
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    : git("ls-files", "--cached", "-z")
  ).split("\0").filter(Boolean);
} catch {
  console.error("这里不是 git 仓库，或尚未安装 git。");
  process.exit(2);
}

// Files whose *name* alone means they must never be published.
const FORBIDDEN = [
  [/(^|\/)credential[^/]*\.bin$|\.bin$/i, "加密的 API Key 或二进制数据（credential*.bin）"],
  [/(^|\/)\.env(\.|$)(?!example)/i, "环境变量文件，通常含密钥"],
  [/\.(pem|key|pfx|p12)$/i, "证书或私钥"],
  [/\.(sqlite|sqlite-wal|sqlite-shm|db)$/i, "本地数据库（含资料全文、批注、解释）"],
  [/\.(anki2|anki21|apkg|colpkg)$/i, "Anki 卡片库或牌组（含个人复习记录）"],
  [/(^|\/)(node_modules|release|dist|\.tools)\//, "依赖或构建产物，应由构建生成"],
  [/(^|\/)services\/[^/]+\/(dist|build)\//, "sidecar 构建产物"],
  [/\.(exe|dll|pyd)$/i, "可执行文件，应作为 Release 附件发布"],
];

// Teaching material is only allowed as the original samples in fixtures/ and the docs screenshots.
const DOCUMENT = /\.(pdf|docx?|pptx?|epub|djvu|mobi|azw3?)$/i;
const DOCUMENT_ALLOWED = /^(fixtures|tests\/fixtures)\//;

// Content patterns. Kept specific to avoid flagging the regexes and examples in this repository.
const SECRETS = [
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API Key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, "OpenAI / DeepSeek 风格的 API Key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS Access Key"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, "GitHub Token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}/, "Slack Token"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "私钥"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API Key"],
];
const PERSONAL = [
  [/[A-Za-z]:\\Users\\(?!Public\\|Default\\|<|%|\.\.\.|你的|your|user(name)?\\|USERNAME)[^\\\s"'<>]+/, "Windows 用户目录路径（可能暴露用户名）"],
  [/\/Users\/(?!Shared\/|<|\$|你的|your|you\b|me\b|name\b|user(name)?\b)[A-Za-z0-9._-]+\//, "macOS 用户目录路径（可能暴露用户名）"],
  [/\/home\/(?!runner\/|user\/|你的|your|<|\$)[A-Za-z0-9._-]+\//, "Linux 用户目录路径（可能暴露用户名）"],
];

const GITHUB_HARD_LIMIT = 100 * 1024 * 1024;
const WARN_SIZE = 20 * 1024 * 1024;
const SKIP_CONTENT = /^(third-party\/|package-lock\.json$|scripts\/publish-check\.mjs$)/; // licence texts, lockfile, this file
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|gz|zip|7z|tar|woff2?|ttf|otf|wasm|pdf|docx?|pptx?)$/i;

const errors = [];
const warnings = [];

for (const file of files) {
  let size;
  try { size = statSync(file).size; } catch { continue; } // deleted in the working tree

  for (const [pattern, why] of FORBIDDEN) if (pattern.test(file)) errors.push(`${file}：${why}`);
  if (DOCUMENT.test(file) && !DOCUMENT_ALLOWED.test(file)) {
    errors.push(`${file}：教材 / 文档文件不应提交（示例资料请放在 fixtures/，且须为原创或可自由分发）`);
  }
  if (size >= GITHUB_HARD_LIMIT) errors.push(`${file}：${(size / 1048576).toFixed(0)} MB，超过 GitHub 单文件 100 MB 上限`);
  else if (size >= WARN_SIZE) warnings.push(`${file}：${(size / 1048576).toFixed(0)} MB，体积较大，考虑改为 Release 附件`);

  if (BINARY.test(file) || SKIP_CONTENT.test(file) || size > 5 * 1024 * 1024) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (text.includes("\0")) continue;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [pattern, why] of SECRETS) if (pattern.test(line)) errors.push(`${file}:${i + 1}：疑似 ${why}`);
    for (const [pattern, why] of PERSONAL) if (pattern.test(line)) warnings.push(`${file}:${i + 1}：${why}`);
  });
}

const scope = staged ? "暂存区" : "仓库";
console.log(`检查了${scope}中的 ${files.length} 个文件`);
for (const w of warnings) console.warn("  ⚠ " + w);
for (const e of errors) console.error("  ✖ " + e);
if (errors.length) {
  console.error(`\n发现 ${errors.length} 个不能上传的问题。处理方法：`);
  console.error("  · 文件不该提交：git rm --cached <文件>，并确认 .gitignore 已覆盖它");
  console.error("  · 密钥已提交过：先到服务商后台作废该 Key，再清理历史（见 docs/PUBLISHING.md）");
  process.exit(1);
}
console.log(warnings.length ? "\n没有阻止上传的问题，但请逐条确认上面的提醒。" : "\n✔ 可以上传");
