import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";

export type WorkerCommand = { exe: string; args: string[] };

/**
 * A long-lived JSON-lines sidecar. Requests are answered strictly in order, so
 * replies are matched FIFO (an `id` echo is optional). One process is reused
 * across calls, which removes the PyInstaller cold start (and, for OCR, the
 * model load) that previously happened on every page.
 */
export class LineWorker {
  private child?: ChildProcessWithoutNullStreams;
  private queue: {
    resolve: (v: any) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
    cleanup: () => void;
  }[] = [];
  private stderr = "";
  constructor(
    private name: string,
    private command: () => WorkerCommand,
    private limit = 300 * 1024 * 1024,
  ) {}
  get busy() {
    return this.queue.length > 0;
  }
  call(
    payload: Record<string, unknown>,
    { timeout = 120_000, signal }: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<any> {
    if (signal?.aborted) return Promise.reject(Error(this.name + "已取消"));
    try {
      if (!this.child) this.start();
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise((resolve, reject) => {
      const abort = () => this.stop(Error(this.name + "已取消"));
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () =>
          this.stop(
            Error(`${this.name}超过 ${Math.round(timeout / 1000)} 秒未响应，已停止`),
          ),
        timeout,
      );
      this.queue.push({
        resolve,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener("abort", abort),
      });
      this.child!.stdin.write(JSON.stringify(payload) + "\n");
    });
  }
  private start() {
    const cmd = this.command();
    if (/[\\/]/.test(cmd.exe) && !existsSync(cmd.exe))
      throw Error(this.name + "组件缺失，请重新安装 Subaudi");
    const child = spawn(cmd.exe, cmd.args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.stderr = "";
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > this.limit)
        return this.stop(Error(this.name + "输出过大"));
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("{")) continue; // upstream diagnostics, not replies
        let reply: any;
        try {
          reply = JSON.parse(line);
        } catch {
          continue;
        }
        const next = this.queue.shift();
        if (!next) continue;
        clearTimeout(next.timer);
        next.cleanup();
        if (reply.error) next.reject(Error(String(reply.error)));
        else next.resolve("result" in reply ? reply.result : reply);
      }
    });
    // Always drain stderr: a full pipe would otherwise stall the sidecar.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-2000);
    });
    child.stdin.on("error", () => this.stop(Error(this.name + "连接中断")));
    child.on("error", () => this.stop(Error("无法启动" + this.name)));
    child.on("close", (code) => {
      if (this.child !== child) return;
      const tail = this.stderr.trim().split("\n").pop();
      this.stop(
        Error(
          `${this.name}意外退出（${code ?? "?"}）${tail ? "：" + tail.slice(0, 200) : ""}`,
        ),
      );
    });
  }
  stop(reason = Error(this.name + "已关闭")) {
    const child = this.child;
    this.child = undefined;
    if (child) {
      child.stdin.end();
      setTimeout(() => child.kill(), 2000).unref();
    }
    for (const p of this.queue.splice(0)) {
      clearTimeout(p.timer);
      p.cleanup();
      p.reject(reason);
    }
  }
}
