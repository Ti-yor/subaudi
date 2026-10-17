import test from "node:test";
import assert from "node:assert/strict";
import { DeepSeek } from "../src/providers/deepseek";
import { Settings } from "../src/contracts";
test("OpenAI compatible custom endpoint, JSON toggle and usage", async () => {
  const original = globalThis.fetch;
  let request: any,
    url = "";
  globalThis.fetch = async (u, init) => {
    url = String(u);
    request = init;
    return new Response(
      JSON.stringify({
        model: "custom",
        choices: [
          { finish_reason: "stop", message: { content: '{"ok":true}' } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    );
  };
  try {
    let usage: any;
    assert.deepEqual(
      await new DeepSeek("test", "custom", {
        baseUrl: "https://example.com/v1/",
        protocol: "openai",
        jsonMode: false,
      }).call("JSON", {}, new AbortController().signal, (u) => (usage = u)),
      { ok: true },
    );
    assert.equal(url, "https://example.com/v1/chat/completions");
    assert.equal(request.redirect, "error");
    const body = JSON.parse(request.body);
    assert.equal(body.thinking, undefined);
    assert.equal(body.response_format, undefined);
    assert.equal(usage.total_tokens, 12);
  } finally {
    globalThis.fetch = original;
  }
});
test("Anthropic Messages system, key headers, text and cached usage", async () => {
  const original = globalThis.fetch;
  let request: any,
    url = "";
  globalThis.fetch = async (u, init) => {
    url = String(u);
    request = init;
    return new Response(
      JSON.stringify({
        model: "claude",
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"ok":true}' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 30,
        },
      }),
    );
  };
  try {
    let usage: any;
    await new DeepSeek("test", "claude", {
      baseUrl: "https://api.anthropic.com/v1",
      protocol: "anthropic",
      jsonMode: true,
    }).call("JSON", {}, new AbortController().signal, (u) => (usage = u));
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(request.headers["x-api-key"], "test");
    const body = JSON.parse(request.body);
    assert.ok(body.system);
    assert.equal(body.messages[0].role, "user");
    assert.equal(body.response_format, undefined);
    assert.equal(usage.total_tokens, 65);
  } finally {
    globalThis.fetch = original;
  }
});
test("Settings migrates old config; rejects unsafe URL schemes and embedded secrets", () => {
  const old = {
    model: "m",
    reader: "",
    budget: 60000,
    searx: "",
    cloud: false,
  };
  assert.equal(Settings.parse(old).baseUrl, "https://api.deepseek.com");
  for (const baseUrl of [
    "file:///tmp",
    "https://key:secret@example.com/v1",
    "https://example.com?key=secret",
  ])
    assert.equal(Settings.safeParse({ ...old, baseUrl }).success, false);
});
