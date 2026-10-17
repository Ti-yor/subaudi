import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, ModelJsonError } from "../src/providers/model-json";

test("模型 JSON：尾逗号和代码围栏可本地恢复，字符串内容不被改写", () => {
  const original = {
    text: 'literal ,} and ,] with "quotes" and \\ slash',
    list: [1, 2],
    nested: { a: "中文" },
  };
  const json = JSON.stringify(original);
  assert.deepEqual(parseModelJson(json), original);
  assert.deepEqual(
    parseModelJson("```json\n" + json.slice(0, -1) + ",}\n```"),
    original,
  );
  assert.deepEqual(parseModelJson('{"a":[1,2,],"b":{"c":"x",},}'), {
    a: [1, 2],
    b: { c: "x" },
  });
});

test("模型 JSON：缺失内容、无引号属性、无效转义必须请求修复，不能猜补或执行", () => {
  for (const raw of [
    '{"title":"unfinished',
    '{title:"x"}',
    '{"formula":"\\alpha"}',
    '{"a":1} trailing',
    "process.exit()",
  ]) {
    assert.throws(
      () => parseModelJson(raw),
      (error: unknown) =>
        error instanceof ModelJsonError &&
        error.output === raw &&
        !error.message.includes(raw),
    );
  }
});
