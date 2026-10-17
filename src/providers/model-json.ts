export class ModelJsonError extends Error {
  constructor(public readonly output: string) {
    super("模型返回的 JSON 格式不完整，尚未保存解释。");
    this.name = "ModelJsonError";
  }
}

// Only repair unambiguous syntax outside strings. Never infer missing content.
export function parseModelJson(output: string): unknown {
  let text = output.trim().replace(/^\uFEFF/, "");
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    /* Try trailing commas only. */
  }
  let cleaned = "",
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      cleaned += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    if (c === ",") {
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === "}" || text[next] === "]") continue;
    }
    cleaned += c;
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new ModelJsonError(output);
  }
}
