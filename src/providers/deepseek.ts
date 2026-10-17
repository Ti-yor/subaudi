import { z } from "zod";
import type { SettingsType } from "../contracts";
import { parseModelJson } from "./model-json";
export class DeepSeek {
  constructor(
    private key: string,
    private model: string,
    private config: Pick<SettingsType, "baseUrl" | "protocol" | "jsonMode"> = {
      baseUrl: "https://api.deepseek.com",
      protocol: "openai",
      jsonMode: true,
    },
  ) {}
  async call(
    system: string,
    input: unknown,
    signal: AbortSignal,
    onUsage: (v: unknown) => void,
  ) {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const anthropic = this.config.protocol === "anthropic";
    const hostname = new URL(base).hostname;
    const provider = hostname === "api.deepseek.com" ? "DeepSeek" : hostname;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (anthropic) {
      headers["x-api-key"] = this.key;
      headers["anthropic-version"] = "2023-06-01";
    } else headers.Authorization = `Bearer ${this.key}`;
    const body = anthropic
      ? {
          model: this.model,
          system: system + "\nReturn only a JSON object.",
          messages: [{ role: "user", content: JSON.stringify(input) }],
          max_tokens: 4096,
        }
      : {
          model: this.model,
          messages: [
            {
              role: "system",
              content: system + "\nReturn only a JSON object.",
            },
            { role: "user", content: JSON.stringify(input) },
          ],
          ...(this.config.jsonMode
            ? { response_format: { type: "json_object" } }
            : {}),
          ...(hostname === "api.openai.com"
            ? { max_completion_tokens: 4096 }
            : { max_tokens: 4096 }),
          stream: false,
          ...(hostname === "api.deepseek.com"
            ? { thinking: { type: "disabled" } }
            : {}),
        };
    let response: Response;
    try {
      response = await fetch(
        base + (anthropic ? "/messages" : "/chat/completions"),
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
        },
      );
    } catch {
      throw Error(
        signal.aborted
          ? "已取消；费用可能已产生"
          : "网络失败或超时；费用未知，不自动重试",
      );
    }
    if (!response.ok) {
      const reasons: Record<number, string> = {
        400: "请求参数或模型名称不被支持，请检查模型设置",
        401: "API Key 无效，请在设置中重新导入",
        402: "账户余额不足，请检查服务商账户",
        403: "账户没有访问此模型的权限",
        429: "请求过于频繁，请稍后重试",
        500: "服务暂时异常，请稍后重试",
        503: "服务繁忙，请稍后重试",
      };
      throw Error(
        `${provider} ${response.status}：${reasons[response.status] ?? "服务请求失败，请检查网络与模型设置"}`,
      );
    }
    let raw: any;
    try {
      raw = await response.json();
    } catch {
      throw Error("API 返回了无法读取的服务响应，请稍后重试；本次未保存解释。");
    }
    if (anthropic) {
      const u = raw.usage;
      if (
        u &&
        Number.isFinite(u.input_tokens) &&
        Number.isFinite(u.output_tokens)
      ) {
        raw.usage = {
          prompt_tokens:
            u.input_tokens +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0),
          completion_tokens: u.output_tokens,
          total_tokens:
            u.input_tokens +
            u.output_tokens +
            (u.cache_read_input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0),
        };
      }
      raw.choices = [
        {
          finish_reason:
            raw.stop_reason === "end_turn" ? "stop" : raw.stop_reason,
          message: {
            content: Array.isArray(raw.content)
              ? raw.content
                  .filter((b: any) => b.type === "text")
                  .map((b: any) => b.text)
                  .join("")
              : null,
          },
        },
      ];
    }
    const usage = z
      .object({
        prompt_tokens: z.number().int().nonnegative().max(1000000000),
        completion_tokens: z.number().int().nonnegative().max(1000000000),
        total_tokens: z.number().int().nonnegative().max(1000000000),
        prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
        prompt_cache_miss_tokens: z.number().int().nonnegative().optional(),
      })
      .safeParse(raw.usage);
    onUsage(
      usage.success
        ? {
            ...usage.data,
            response_model:
              typeof raw.model === "string"
                ? raw.model.slice(0, 150)
                : "alias/unknown",
          }
        : null,
    );
    const out = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string().nullable(),
              message: z.object({ content: z.string().nullable() }),
            }),
          )
          .min(1),
      })
      .parse(raw);
    const choice = out.choices[0];
    // Only real truncation / filtering is fatal. "end_turn", "stop_sequence", "eos" or a null reason
    // from OpenAI-compatible servers all mean a complete answer; a broken JSON body is still caught below.
    const cut = ["length", "max_tokens", "content_filter", "model_context_window_exceeded"];
    if (cut.includes(choice.finish_reason ?? "") || !choice.message.content?.trim())
      throw Error("输出为空或截断；未保存成功缓存");
    return parseModelJson(choice.message.content);
  }
}
