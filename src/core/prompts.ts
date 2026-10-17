import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
export function parseModelOutput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  stage: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields = [
    ...new Set(
      result.error.issues.map((issue) => issue.path.join(".") || "输出结构"),
    ),
  ].slice(0, 3);
  throw Error(
    `${stage}未完成：模型返回的格式不符合要求（${fields.join("、")}）。请重试；本次结果未保存为成功解释。`,
  );
}
export function loadPrompt(directory: string, name: string) {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  const filename = manifest.tasks[name];
  if (typeof filename !== "string" || !/^[-a-z]+\.v\d+\.txt$/.test(filename))
    throw Error("未知任务模板");
  return readFileSync(path.join(directory, filename), "utf8");
}
export function taskInput(task: string, input: unknown) {
  if (!input || typeof input !== "object") throw Error("任务输入必须是对象");
  const value = { ...(input as Record<string, unknown>), task };
  if (task !== "teach" && task !== "repair")
    delete (value as Record<string, unknown>).output_schema;
  return value;
}
