import { build } from "esbuild";
import { mkdir, cp, rm, writeFile, readFile } from "node:fs/promises";
// `npm run build -- --dev` keeps sourcemaps and readable output for debugging.
const dev = process.argv.includes("--dev");
await rm("dist", { recursive: true, force: true });
await mkdir("dist/prompts", { recursive: true });
const common = {
  bundle: true,
  minify: !dev,
  sourcemap: dev,
  legalComments: "none",
  logLevel: "warning",
  define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"' },
};
await Promise.all([
  build({ ...common, entryPoints: ["src/main.ts"], platform: "node", format: "cjs", outfile: "dist/main.cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/preload.ts"], platform: "node", format: "cjs", outfile: "dist/preload.cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/ui/app.tsx"], platform: "browser", format: "esm", outfile: "dist/app.js", target: "chrome130" }),
]);
await cp("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "dist/pdf.worker.min.mjs");
// cmaps: CJK PDFs need them. standard_fonts: non-embedded base-14 fonts. wasm: JPX/JBIG2 decoders only.
await cp("node_modules/pdfjs-dist/cmaps", "dist/cmaps", { recursive: true });
await cp("node_modules/pdfjs-dist/standard_fonts", "dist/standard_fonts", {
  recursive: true,
  filter: (f) => !/LICENSE/i.test(f),
});
await mkdir("dist/wasm");
for (const f of ["openjpeg.wasm", "jbig2.wasm", "qcms_bg.wasm"])
  await cp("node_modules/pdfjs-dist/wasm/" + f, "dist/wasm/" + f).catch(() => {});
// Only prompts referenced by the manifest ship; older template versions stay in git history.
const manifest = JSON.parse(await readFile("prompts/manifest.json", "utf8"));
await cp("prompts/manifest.json", "dist/prompts/manifest.json");
await cp("prompts/explanation.schema.json", "dist/prompts/explanation.schema.json");
for (const f of new Set(Object.values(manifest.tasks))) await cp("prompts/" + f, "dist/prompts/" + f);
await writeFile(
  "dist/index.html",
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:;"><title>Subaudi</title><link rel="stylesheet" href="app.css"><script>document.documentElement.dataset.theme=localStorage.getItem("theme")||"light"</script><div id="root"></div><script type="module" src="app.js"></script></html>`,
);
