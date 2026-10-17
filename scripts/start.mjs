import { spawn } from "node:child_process";
import electron from "electron";
delete process.env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  windowsHide: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 1));
