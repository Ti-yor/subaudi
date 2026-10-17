// Builds third-party/THIRD-PARTY.md and fills third-party/licenses/ from what actually ships.
//
// Sources, in order of trust:
//   1. npm packages that end up inside app.asar — determined from an esbuild metafile of the real
//      entry points, not from package.json, so dev-only packages never appear.
//   2. Python packages inside the PyInstaller sidecars — read from the *.dist-info metadata that
//      PyInstaller copies into each bundle. Falls back to the pinned runtimes in .tools/ when a
//      sidecar has not been built yet (the report marks those entries as "预计").
//   3. Native runtimes and libraries that ship inside the bundles without metadata (Electron,
//      Chromium, CPython, OpenSSL, PDFium's C dependencies, ...). Their licence texts are curated
//      in third-party/licenses/ and listed in NATIVE below.
//
// The script never deletes files and never downloads anything; re-run it after upgrading a
// dependency, rebuilding a sidecar, or adding a package.
//
// Usage:
//   node scripts/licenses.mjs            regenerate
//   node scripts/licenses.mjs --check    exit 1 if THIRD-PARTY.md would change
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "third-party");
// Two locations, on purpose:
//   licenses/           curated, hand-checked texts (native runtimes, packages that ship none)
//   licenses/packages/  extracted from the packages themselves; wiped and rewritten on every run
const licDir = path.join(dir, "licenses");
const genDir = path.join(licDir, "packages");
const check = process.argv.includes("--check");

// Licences found in a package directory, most canonical first.
const LICENSE_FILES = [
  "LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.txt", "COPYING", "COPYING.txt",
  "LICENSE-MIT", "LICENSE-APACHE", "license", "License.txt",
];

// Components that ship inside the bundles without package metadata. `file` names a curated text in
// third-party/licenses/; `note` is used when the声明 is provided by the release package itself.
const NATIVE = [
  { name: "Electron", version: runtime("electron"), spdx: "MIT", file: "electron-LICENSE.txt" },
  { name: "Chromium", spdx: "BSD-3-Clause 等", note: "完整声明随发布包提供：`release/win-unpacked/LICENSES.chromium.html`" },
  { name: "Node.js", spdx: "MIT", note: "随 Electron 分发，声明见 `release/win-unpacked/LICENSE.electron.txt`" },
  { name: "CPython", version: "3.13", spdx: "PSF-2.0", file: "python-3.13-LICENSE.txt", where: "三个 sidecar" },
  { name: "OpenSSL", spdx: "Apache-2.0", file: "openssl-LICENSE.txt", where: "python3.dll / _ssl.pyd" },
  { name: "libffi", spdx: "MIT", file: "libffi-LICENSE.txt", where: "libffi-8.dll" },
  { name: "zlib", spdx: "Zlib", file: "zlib-LICENSE.txt", where: "zlib / _bz2.pyd" },
  { name: "bzip2", spdx: "bzip2-1.0.6", file: "bzip2-COPYING.txt", where: "_bz2.pyd" },
  { name: "XZ Utils (liblzma)", spdx: "0BSD 与 LGPL-2.1-or-later", file: "xz-COPYING-0BSD.txt", where: "_lzma.pyd" },
  { name: "libexpat", spdx: "MIT", file: "expat-COPYING.txt", where: "pyexpat.pyd" },
  { name: "libmpdec", spdx: "BSD-2-Clause", file: "mpdecimal-COPYRIGHT.txt", where: "_decimal.pyd" },
  { name: "SQLite", spdx: "公有领域", where: "sqlite3.dll", note: "https://www.sqlite.org/copyright.html" },
  { name: "PDFium 及构建依赖", spdx: "BSD-3-Clause 等", file: "pdfium-BUILD-LICENSES.txt", where: "pypdfium2_raw" },
  { name: "ONNX Runtime 第三方依赖", spdx: "MIT 等", file: "onnxruntime-ThirdPartyNotices.txt", where: "onnxruntime" },
  { name: "OpenCV 第三方依赖", spdx: "Apache-2.0 等", file: "opencv-LICENSE-3RD-PARTY.txt", where: "cv2" },
  { name: "GEOS", spdx: "LGPL-2.1-or-later", file: "shapely-LICENSE-GEOS.txt", where: "Shapely.libs" },
];

function runtime(name) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? "—";
}

// ---- what is inside app.asar -------------------------------------------------
// Mirrors scripts/build.mjs so the set of packages matches the real bundle; write:false keeps it
// side-effect free, and the metafile records every module that ended up in the output.
const BUNDLE_INPUTS = [
  { entry: "src/main.ts", platform: "node", format: "cjs", target: undefined, external: ["electron"] },
  { entry: "src/preload.ts", platform: "node", format: "cjs", target: undefined, external: ["electron"] },
  { entry: "src/ui/app.tsx", platform: "browser", format: "esm", target: "chrome130", external: [] },
];

async function shippedNpmPackages() {
  const found = new Map();
  for (const input of BUNDLE_INPUTS) {
    if (!existsSync(path.join(root, input.entry))) continue;
    const result = await build({
      absWorkingDir: root, entryPoints: [input.entry], outdir: "dist", bundle: true,
      platform: input.platform, format: input.format, target: input.target, external: input.external,
      write: false, metafile: true, minify: true, legalComments: "none", logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    for (const output of Object.values(result.metafile.outputs)) {
      for (const file of Object.keys(output.inputs)) {
        for (const [, name] of file.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)) found.set(name, true);
      }
    }
  }
  return [...found.keys()].sort();
}

function npmPackage(name) {
  const dir2 = path.join(root, "node_modules", name);
  if (!existsSync(path.join(dir2, "package.json"))) return null;
  const meta = JSON.parse(readFileSync(path.join(dir2, "package.json"), "utf8"));
  const spdx = typeof meta.license === "string"
    ? meta.license
    : meta.license?.type ?? meta.licenses?.map((l) => l.type).join(" 或 ") ?? "未声明";
  let text = null;
  for (const candidate of LICENSE_FILES) {
    const p = path.join(dir2, candidate);
    if (existsSync(p)) { text = readFileSync(p, "utf8"); break; }
  }
  const url = typeof meta.repository === "string" ? meta.repository : meta.repository?.url;
  return {
    name, version: meta.version, spdx: spdx.replace(/^\(|\)$/g, ""), text,
    where: "应用", source: (url ?? meta.homepage ?? "").replace(/^git\+/, "").replace(/\.git$/, ""),
    locked: lockedVersion(name),
  };
}

// The release is built with `npm ci`, so package-lock.json — not whatever happens to be installed —
// decides what ships. A drifted node_modules (npm install, a manual upgrade) would silently produce
// a wrong list; compare and refuse instead.
let lock;
function lockedVersion(name) {
  lock ??= JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")).packages ?? {};
  return lock[`node_modules/${name}`]?.version ?? null;
}

// ---- what PyInstaller put in each sidecar ------------------------------------
// PyInstaller only copies *.dist-info for packages built with --copy-metadata, so the component list
// comes from the pinned requirement files; metadata (exact version, SPDX id, licence text) is taken
// from the built bundle when present, else from the pinned runtime in .tools/, else from the curated
// copy in third-party/licenses/. Transitive imports PyInstaller pulls in on its own are listed in
// EXTRA_PYTHON below.
const SIDECARS = [
  {
    label: "卡片库内核", built: "services/anki/dist/subaudi-anki/_internal",
    pinned: ".tools/anki-runtime", requirements: ["services/anki/requirements.lock.txt"],
  },
  {
    label: "文字识别", built: "services/parser/ocr-dist/subaudi-ocr/_internal", pinned: null,
    requirements: ["services/parser/requirements.txt"], skip: ["pyinstaller", "olefile"],
  },
  {
    label: "文档解析", built: "services/parser/dist/subaudi-parser/_internal",
    pinned: ".tools/parser-runtime", requirements: ["services/parser/requirements.txt"],
    only: ["olefile"],
  },
];

// PyPI distribution name -> import directory / file it installs.
const IMPORT_NAME = {
  "anki": "anki", "certifi": "certifi", "charset-normalizer": "charset_normalizer",
  "decorator": "decorator", "idna": "idna", "markdown": "markdown", "orjson": "orjson",
  "protobuf": "google", "pysocks": "socks.py", "requests": "requests",
  "typing-extensions": "typing_extensions.py", "urllib3": "urllib3",
  "numpy": "numpy", "onnxruntime": "onnxruntime", "pillow": "PIL", "pypdfium2": "pypdfium2",
  "rapidocr-onnxruntime": "rapidocr_onnxruntime", "pyclipper": "pyclipper", "shapely": "shapely",
  "olefile": "olefile", "pyyaml": "yaml", "psutil": "psutil", "opencv-python": "cv2",
  "pywin32": "win32", "setuptools": "setuptools", "tzdata": "tzdata",
};

// Indirect dependencies PyInstaller freezes into the sidecars on its own, read from the module tables
// of the built executables (pyi-archive_viewer). Versions are given only where the bundle states them.
const EXTRA_PYTHON = [
  { where: "卡片库内核", name: "distro", spdx: "Apache-2.0", file: "distro-LICENSE.txt" },
  { where: "卡片库内核", name: "packaging", version: "25.0", spdx: "Apache-2.0 OR BSD-2-Clause", file: "packaging-LICENSE.txt" },
  { where: "卡片库内核", name: "Pygments", version: "2.19.2", spdx: "BSD-2-Clause", file: "pygments-LICENSE.txt" },
  { where: "卡片库内核", name: "setuptools", spdx: "MIT", file: "setuptools-LICENSE.txt" },
  { where: "卡片库内核", name: "tzdata", version: "2025.2", spdx: "Apache-2.0", file: "tzdata-LICENSE.txt" },
  { where: "文字识别", name: "numpy", version: "2.3.2", spdx: "BSD-3-Clause 等", file: "numpy-LICENSE.txt" },
  { where: "文字识别", name: "opencv-python", version: "5.0.0.93", spdx: "Apache-2.0 与 MIT", file: "opencv-LICENSE.txt" },
  { where: "文字识别", name: "shapely", version: "2.1.2", spdx: "BSD-3-Clause", file: "shapely-LICENSE.txt" },
  { where: "文字识别", name: "pyclipper", version: "1.4.0", spdx: "MIT", file: "pyclipper-LICENSE.txt" },
  { where: "文字识别", name: "PyYAML", version: "6.0.2", spdx: "MIT", file: "pyyaml-LICENSE.txt" },
  { where: "文字识别", name: "psutil", version: "7.0.0", spdx: "BSD-3-Clause", file: "psutil-LICENSE.txt" },
  { where: "文字识别", name: "six", version: "1.17.0", spdx: "MIT", file: "six-LICENSE.txt" },
  { where: "文字识别", name: "threadpoolctl", version: "3.6.0", spdx: "BSD-3-Clause", file: "threadpoolctl-LICENSE.txt" },
  { where: "文字识别", name: "defusedxml", version: "0.7.1", spdx: "PSF-2.0", file: "defusedxml-LICENSE.txt" },
  { where: "文字识别", name: "charset-normalizer", version: "3.4.3", spdx: "MIT", file: "charset-normalizer-LICENSE.txt" },
  { where: "文字识别", name: "typing_extensions", spdx: "PSF-2.0", file: "typing-extensions-LICENSE.txt" },
  { where: "文字识别", name: "pywin32", spdx: "PSF-2.0", file: "pywin32-LICENSE.txt" },
];

function pinnedRequirements(files) {
  const pins = new Map();
  for (const file of files) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*==\s*([^\s;#]+)/);
      if (m) pins.set(m[1].toLowerCase().replace(/_/g, "-"), m[2]);
    }
  }
  return pins;
}

function pythonPackages() {
  const out = new Map();
  for (const sidecar of SIDECARS) {
    const builtDir = path.join(root, sidecar.built);
    const fromBuilt = existsSync(builtDir);
    const pins = pinnedRequirements(sidecar.requirements);
    for (const [name, version] of pins) {
      if (sidecar.skip?.includes(name) || (sidecar.only && !sidecar.only.includes(name))) continue;
      // Prefer metadata that the bundle itself carries; fall back to the pinned runtime.
      const infoDir = findDistInfo(builtDir, name) ?? (sidecar.pinned && findDistInfo(path.join(root, sidecar.pinned), name));
      const meta = infoDir ? readMetadata(path.join(infoDir, "METADATA")) : {};
      // Metadata may be present but carry no licence text (Anki, pypdfium2, rapidocr); the curated
      // copy in third-party/ is then the only one we have, so fall back to it either way.
      const text = (infoDir ? licenseText(infoDir) : null) ?? curatedLicense(name);
      const key = `${sidecar.label}/${name}`;
      out.set(key, {
        name: meta.Name ?? name,
        version: meta.Version ?? version,
        spdx: infoDir ? spdxOf(meta, infoDir) : sniffSpdx(text) ?? "见许可证文本",
        text,
        where: sidecar.label,
        source: meta["Home-page"] && meta["Home-page"] !== "UNKNOWN" ? meta["Home-page"] : `https://pypi.org/project/${name}/`,
      });
    }
  }
  for (const e of EXTRA_PYTHON) {
    const key = `${e.where}/${e.name.toLowerCase()}`;
    if ([...out.keys()].some((k) => k.toLowerCase() === key)) continue;
    out.set(key, {
      name: e.name, version: e.version ?? "—", spdx: e.spdx, where: e.where,
      text: readText(path.join(licDir, e.file)), source: `间接依赖 · https://pypi.org/project/${e.name}/`,
    });
  }
  const order = SIDECARS.map((s) => s.label);
  return [...out.values()].sort((a, b) => order.indexOf(a.where) - order.indexOf(b.where) || a.name.localeCompare(b.name));
}

function findDistInfo(dir, name) {
  if (!existsSync(dir)) return null;
  const wanted = name.toLowerCase().replace(/-/g, "_");
  for (const entry of readdirSync(dir)) {
    const m = entry.match(/^(.+?)-[\d.]+\.dist-info$/);
    if (!m) continue;
    if (m[1].toLowerCase().replace(/-/g, "_") === wanted) return path.join(dir, entry);
  }
  return null;
}

// Licence texts for packages whose metadata is not shipped inside the bundle are curated in
// third-party/licenses/, named after the distribution (rapidocr-LICENSE.txt for rapidocr-onnxruntime).
function curatedLicense(name) {
  const clean = (s) => s.replace(/[-_.](licen[cs]e|copying|notice).*$/i, "");
  const wanted = clean(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  const bases = [licDir, dir].filter(existsSync);
  for (const base of bases) {
    for (const f of readdirSync(base)) {
      const stem = clean(f.replace(/\.(txt|md)$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      const matches = stem === wanted || stem.split("-")[0] === wanted.split("-")[0];
      if (!matches) continue;
      const text = readText(path.join(base, f));
      if (text && text.length > 200) return text;
    }
  }
  return null;
}

function sniffSpdx(text) {
  if (!text) return null;
  if (/Apache License\s+Version 2\.0/i.test(text)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Redistribution and use in source and binary forms/i.test(text)) return "BSD-3-Clause";
  if (/GNU AFFERO/i.test(text)) return "AGPL-3.0-or-later";
  if (/GNU LESSER/i.test(text)) return "LGPL";
  if (/Mozilla Public License/i.test(text)) return "MPL-2.0";
  if (/ISC License/i.test(text)) return "ISC";
  if (/Public domain/i.test(text)) return "公有领域";
  return null;
}

function readMetadata(file) {
  if (!existsSync(file)) return {};
  const fields = {};
  let key = null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) { key = m[1]; fields[key] = m[2].trim(); }
    else if (key && line.trim()) fields[key] += " " + line.trim();
    else key = null;
  }
  return fields;
}

function spdxOf(meta, infoDir) {
  const classifiers = Object.entries(meta)
    .filter(([k]) => k === "Classifier")
    .map(([, v]) => v)
    .filter((v) => v.includes("License :: OSI Approved :: "))
    .map((v) => v.replace(/^.*License :: OSI Approved :: /, ""));
  return meta["License-Expression"] || (meta.License && meta.License !== "UNKNOWN" ? meta.License : null)
    || classifiers[0] || classifiersFromFiles(infoDir) || "未声明";
}

function classifiersFromFiles(infoDir) {
  const text = licenseText(infoDir);
  if (!text) return null;
  if (/Apache License\s+Version 2\.0/i.test(text)) return "Apache-2.0";
  if (/Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Redistribution and use in source and binary forms/i.test(text)) return "BSD-3-Clause";
  if (/GNU AFFERO/i.test(text)) return "AGPL-3.0-or-later";
  if (/GNU LESSER/i.test(text)) return "LGPL";
  return null;
}

function readText(file) {
  try { return readFileSync(file, "utf8"); } catch { return null; }
}

function licenseText(infoDir) {
  for (const f of ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING", "COPYING.txt"]) {
    const text = readText(path.join(infoDir, f));
    if (text) return text;
  }
  const nested = path.join(infoDir, "licenses");
  if (!existsSync(nested)) return null;
  const parts = [];
  for (const f of walkFiles(nested)) {
    if (!/licen|copying/i.test(path.basename(f)) || f.endsWith(".py")) continue;
    const text = readText(f);
    if (text) parts.push(text);
  }
  return parts.length ? parts.join("\n\n") : null;
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

// ---- writing -----------------------------------------------------------------
// Only byte-identical texts are shared. MIT/BSD/ISC require each package's own copyright notice to be
// preserved, so two "MIT" files with different copyright lines must both be kept.
const digest = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n").trim()).digest("hex").slice(0, 12);
const existing = new Map(); // digest -> file name (relative to licenses/)

function scanCurated() {
  for (const f of readdirSync(licDir, { withFileTypes: true })) {
    if (!f.isFile()) continue;
    const text = readText(path.join(licDir, f.name));
    if (text) existing.set(digest(text), f.name);
  }
}

function store(entry) {
  if (!entry.text) return null;
  const hash = digest(entry.text);
  if (existing.has(hash)) return existing.get(hash);
  // Names depend only on this run (not on what is on disk), so --check reproduces them exactly.
  let file = `packages/${slug(entry.name)}-LICENSE.txt`;
  if (allocated.has(file)) file = `packages/${slug(entry.name)}-${hash.slice(0, 6)}-LICENSE.txt`;
  allocated.add(file);
  if (!check) writeFileSync(path.join(licDir, file), entry.text.endsWith("\n") ? entry.text : entry.text + "\n");
  existing.set(hash, file);
  return file;
}
const allocated = new Set();

function slug(name) {
  return name.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function link(file) {
  return file && file !== "—" ? `[${path.basename(file)}](licenses/${file})` : "—";
}

function row(entry) {
  return `| ${entry.where} | ${entry.name} | ${entry.version ?? "—"} | ${entry.spdx ?? "—"} | ${link(entry.textFile)} | ${entry.source ?? ""} |`;
}

async function main() {
  // Validate everything before touching the output, so a failed run leaves the last good list intact.
  const missing = [];
  const npm = (await shippedNpmPackages()).map(npmPackage).filter(Boolean);
  const drift = npm.filter((e) => e.locked && e.locked !== e.version);
  if (drift.length) {
    console.error("node_modules 与 package-lock.json 不一致，生成的清单不会是实际发布的内容：");
    for (const e of drift) console.error(`  ${e.name}：已安装 ${e.version}，锁定 ${e.locked}`);
    console.error("请先运行 npm ci，再重新生成。");
    process.exit(1);
  }

  mkdirSync(genDir, { recursive: true });
  if (!check) for (const f of readdirSync(genDir)) rmSync(path.join(genDir, f), { force: true });
  scanCurated();

  for (const entry of npm) {
    if (!entry.text) { missing.push(`npm ${entry.name}@${entry.version}：包内没有许可证文本（声明为 ${entry.spdx}）`); entry.textFile = "—"; continue; }
    entry.textFile = store({ ...entry, spdx: entry.spdx.startsWith("SPDX-") ? entry.spdx : entry.spdx });
  }
  const python = pythonPackages();
  for (const entry of python) {
    if (!entry.text) { missing.push(`${entry.name} ${entry.version}（${entry.where}）：没有许可证文本（声明为 ${entry.spdx}）`); entry.textFile = "—"; continue; }
    entry.textFile = store(entry);
  }
  for (const entry of NATIVE) if (entry.file && !existsSync(path.join(licDir, entry.file))) {
    missing.push(`缺少 third-party/licenses/${entry.file}（${entry.name}）`);
  }

  const header = `# 第三方组件与许可证

本文件由 \`node scripts/licenses.mjs\` 生成，请勿手工编辑。它列出 Subaudi 中**实际包含**的组件及其
版本与许可证，并汇总各自的许可证原文。升级依赖或修改 \`services/\` 后请重新生成：

\`\`\`bash
npm run licenses            # 重新生成
npm run licenses -- --check # 只检查是否与仓库内容一致（CI 用）
\`\`\`

生成方式：

- **应用**：渲染进程与主进程由 esbuild 打包，下表依据 esbuild metafile 列出真正进入 \`app.asar\` 的
  npm 包，因而不会出现只用于开发的包。
- **sidecar**：组件清单取自固定版本的依赖文件（\`services/anki/requirements.lock.txt\`、
  \`services/parser/requirements.txt\`），并补上 PyInstaller 自动收入的间接依赖；版本与许可证优先
  读取组件包内的 \`*.dist-info\`，其次是 \`.tools/\` 中的固定版本运行时，最后是
  \`third-party/licenses/\` 中人工核对过的文本。
- **内置运行时**：Electron、Chromium、Node.js、CPython 及随其分发的原生库，见文末；其完整声明
  由发布包本身提供（\`LICENSES.chromium.html\`、\`LICENSE.electron.txt\`）。

`;

  const doc = header
    + `## 应用（app.asar）\n\n共 ${npm.length} 个包。\n\n`
    + `| 组件 | 版本 | 许可证 | 文本 | 来源 |\n| --- | --- | --- | --- | --- |\n`
    + npm.filter((e) => e.text)
      .map((e) => `| ${e.name} | ${e.version} | ${e.spdx} | ${link(e.textFile)} | ${e.source ?? ""} |`).join("\n")
    + `\n\n## sidecar（Python）\n\n`
    + `| 所在组件 | 包 | 版本 | 许可证 | 文本 | 来源 |\n| --- | --- | --- | --- | --- | --- |\n`
    + python.map(row).join("\n")
    + `\n\n## 内置运行时与原生库\n\n`
    + `| 组件 | 版本 | 许可证 | 文本 | 位置 / 说明 |\n| --- | --- | --- | --- | --- |\n`
    + NATIVE.map((e) => `| ${e.name} | ${e.version ?? "—"} | ${e.spdx} | ${e.file ? `[${e.file}](licenses/${e.file})` : "—"} | ${e.note ?? e.where ?? ""} |`).join("\n")
    + `\n\n## 需要人工处理\n\n`
    + (missing.length ? missing.map((m) => `- ${m}`).join("\n") : "无。")
    + `\n\nAnki 内核的版本、源码快照与许可说明另见 [ANKI-NOTICE.md](ANKI-NOTICE.md)。\n`;

  if (check) {
    const current = existsSync(path.join(dir, "THIRD-PARTY.md")) ? readFileSync(path.join(dir, "THIRD-PARTY.md"), "utf8") : "";
    if (current !== doc) {
      console.error("third-party/THIRD-PARTY.md 已过期，请运行 npm run licenses");
      process.exit(1);
    }
    console.log("third-party/THIRD-PARTY.md 是最新的");
    return;
  }

  writeFileSync(path.join(dir, "THIRD-PARTY.md"), doc);
  console.log(`third-party/THIRD-PARTY.md：应用 ${npm.length} 个 npm 包，sidecar ${python.length} 个 Python 包，内置 ${NATIVE.length} 项`);
  for (const m of missing) console.warn("  待处理：" + m);
}

await main();
