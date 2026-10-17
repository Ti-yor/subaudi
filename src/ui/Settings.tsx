import React, { useState } from "react";
import type { SettingsType, State, Theme } from "../contracts";
import { Icon, type IconName } from "./icons";
import { Scrim, errText, formatTokens, toast, toastError } from "./kit";

export type ReadingPrefs = { font: "serif" | "sans" | "kai"; size: number; width: number };
export type SettingsTab = "ai" | "reading" | "usage" | "data";
const api = window.subaudi;
const PRESETS = [
  { id: "deepseek", label: "DeepSeek", sub: "默认推荐", baseUrl: "https://api.deepseek.com", protocol: "openai", model: "deepseek-flash" },
  { id: "openai", label: "OpenAI", sub: "GPT 系列", baseUrl: "https://api.openai.com/v1", protocol: "openai", model: "gpt-4.1-mini" },
  { id: "anthropic", label: "Claude", sub: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "anthropic", model: "claude-sonnet-4-6" },
  { id: "custom", label: "其他", sub: "兼容 OpenAI", baseUrl: "", protocol: "openai", model: "" },
] as const;
const presetOf = (s: SettingsType) =>
  PRESETS.find((p) => p.id !== "custom" && p.baseUrl === s.baseUrl.replace(/\/+$/, ""))?.id ?? "custom";
const THEMES: { id: Theme; label: string; bg: string; fg: string }[] = [
  { id: "light", label: "明亮", bg: "#fbfbf9", fg: "#1d1f21" },
  { id: "sepia", label: "护眼", bg: "#f4ecdb", fg: "#33291c" },
  { id: "dark", label: "夜间", bg: "#1d1e20", fg: "#e7e5e0" },
];

export function SettingsDialog({
  state,
  initialTab = "ai",
  close,
  refresh,
  theme,
  setTheme,
  prefs,
  setPrefs,
}: {
  state: State;
  initialTab?: SettingsTab;
  close: () => void;
  refresh: () => Promise<void>;
  theme: Theme;
  setTheme: (t: Theme) => void;
  prefs: ReadingPrefs;
  setPrefs: (p: ReadingPrefs) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [s, set] = useState<SettingsType>(state.settings);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | "running" | null>(null);
  const dirty = secret.trim() !== "" || JSON.stringify(s) !== JSON.stringify(state.settings);
  const preset = presetOf(s);
  const save = async () => {
    setSaving(true);
    try {
      await api.settings(s, secret.trim() || undefined);
      setSecret("");
      await refresh();
      toast("设置已保存");
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const runTest = async () => {
    setTest("running");
    try {
      const r = await api.testModel(s, secret.trim() || undefined);
      setTest({ ok: true, text: `连接成功 · ${r.model} · ${(r.ms / 1000).toFixed(1)} 秒` });
    } catch (e) {
      setTest({ ok: false, text: errText(e) });
    }
  };
  const tabs: [SettingsTab, string, IconName][] = [
    ["ai", "AI 服务", "spark"],
    ["reading", "阅读", "book"],
    ["usage", "用量", "layers"],
    ["data", "数据与备份", "folder"],
  ];
  const pct = state.usage.budget ? Math.min(100, (state.usage.spent / state.usage.budget) * 100) : 0;
  return (
    <Scrim onClose={close} label="设置">
      <div className="settings">
        <nav>
          <h2>设置</h2>
          {tabs.map(([id, label, icon]) => (
            <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <div className="pane">
          <div className="pane-body">
            {tab === "ai" && (
              <>
                <h3>AI 服务</h3>
                <p className="hint">
                  解释和制卡时，选中的文字及其前后段落会发送给下面的服务。阅读、高亮、批注、搜索和文字识别都在本机完成。
                </p>
                <div className="preset-row" role="group" aria-label="服务商">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      aria-pressed={preset === p.id}
                      onClick={() => {
                        setTest(null);
                        set({
                          ...s,
                          baseUrl: p.id === "custom" ? (preset === "custom" ? s.baseUrl : "") : p.baseUrl,
                          protocol: p.protocol,
                          model: p.id === "custom" && preset === "custom" ? s.model : p.model,
                        });
                      }}
                    >
                      {p.label}
                      <small>{p.sub}</small>
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>API Key</span>
                  <div className="key-row">
                    <input
                      className="input"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={state.hasKey && s.baseUrl === state.settings.baseUrl ? "已保存 · 粘贴新 Key 可替换" : "粘贴你的 API Key"}
                      value={secret}
                      onChange={(e) => {
                        setSecret(e.target.value);
                        setTest(null);
                      }}
                    />
                    <button className="btn" disabled={test === "running" || !s.model} onClick={runTest}>
                      {test === "running" ? <span className="spinner" /> : <Icon name="check" />}
                      测试连接
                    </button>
                  </div>
                  {test && test !== "running" ? (
                    <small className={"status-pill " + (test.ok ? "ok" : "bad")}>
                      <Icon name={test.ok ? "check" : "alert"} size={13} />
                      {test.text}
                    </small>
                  ) : (
                    <small>
                      Key 由系统加密保存在本机，不会出现在界面或导出文件中。
                      {state.hasKey && (
                        <>
                          {" "}
                          <a
                            href="#"
                            onClick={async (e) => {
                              e.preventDefault();
                              await api.clearKey();
                              await refresh();
                              toast("已移除 API Key");
                            }}
                          >
                            移除已保存的 Key
                          </a>
                        </>
                      )}
                    </small>
                  )}
                </label>
                <div className="grid-2">
                  <label className="field">
                    <span>模型</span>
                    <input value={s.model} placeholder="服务商的模型 ID" onChange={(e) => set({ ...s, model: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>服务地址</span>
                    <input
                      value={s.baseUrl}
                      placeholder="https://api.example.com/v1"
                      onChange={(e) => set({ ...s, baseUrl: e.target.value })}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>关于我</span>
                  <textarea
                    value={s.reader}
                    placeholder="例如：大二学生，学过微积分和线性代数，没学过实分析。希望能独立读懂证明。"
                    onChange={(e) => set({ ...s, reader: e.target.value })}
                  />
                  <small>解释会以此为起点，决定哪些前置知识需要补讲。</small>
                </label>
                <label className="check">
                  <input type="checkbox" checked={s.cloud} onChange={(e) => set({ ...s, cloud: e.target.checked })} />
                  <span>
                    启用 AI 解释
                    <small>关闭后不会发出任何网络请求；保存 Key 时会自动开启。</small>
                  </span>
                </label>
                <details className="drill">
                  <summary>
                    高级
                    <Icon name="chevronD" size={14} />
                  </summary>
                  <div className="inner">
                    <label className="field">
                      <span>接口协议</span>
                      <select
                        value={s.protocol}
                        onChange={(e) => set({ ...s, protocol: e.target.value as SettingsType["protocol"] })}
                      >
                        <option value="openai">OpenAI Chat Completions</option>
                        <option value="anthropic">Anthropic Messages</option>
                      </select>
                      <small>服务地址只填到版本路径，例如 …/v1，不要包含 /chat/completions。</small>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={s.jsonMode}
                        disabled={s.protocol === "anthropic"}
                        onChange={(e) => set({ ...s, jsonMode: e.target.checked })}
                      />
                      <span>
                        JSON 模式
                        <small>如果服务返回 400 错误，尝试关闭。</small>
                      </span>
                    </label>
                    <label className="field">
                      <span>联网检索（SearXNG）</span>
                      <input
                        value={s.searx}
                        placeholder="https://search.example.org"
                        onChange={(e) => set({ ...s, searx: e.target.value })}
                      />
                      <small>需开启 JSON 输出。配置后，提问时可让解释引用公开网页。</small>
                    </label>
                  </div>
                </details>
              </>
            )}
            {tab === "reading" && (
              <>
                <h3>阅读</h3>
                <p className="hint">对所有文字类资料生效；PDF 保持原版式。</p>
                <div className="field">
                  <span>主题</span>
                </div>
                <div className="theme-row">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      aria-pressed={theme === t.id}
                      style={{ ["--sw-bg" as any]: t.bg, ["--sw-fg" as any]: t.fg }}
                      onClick={() => setTheme(t.id)}
                    >
                      <i />
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="field">
                  <span>正文字体</span>
                  <div className="segmented">
                    {(
                      [
                        ["serif", "宋体"],
                        ["sans", "黑体"],
                        ["kai", "楷体"],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} aria-pressed={prefs.font === id} onClick={() => setPrefs({ ...prefs, font: id })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>字号 · {prefs.size}px</span>
                  <input
                    type="range"
                    min={14}
                    max={26}
                    value={prefs.size}
                    onChange={(e) => setPrefs({ ...prefs, size: +e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>行宽 · {prefs.width} 字</span>
                  <input
                    type="range"
                    min={28}
                    max={56}
                    value={prefs.width}
                    onChange={(e) => setPrefs({ ...prefs, width: +e.target.value })}
                  />
                </label>
              </>
            )}
            {tab === "usage" && (
              <>
                <h3>用量</h3>
                <p className="hint">按自然月统计 token。用量以服务商返回的数字为准；未返回时按估算值计。</p>
                <div className="usage-big">
                  <b>{formatTokens(state.usage.spent)}</b>
                  <span>
                    {state.usage.budget ? `/ ${formatTokens(state.usage.budget)} tokens · ${state.usage.month}` : `tokens · ${state.usage.month} · 不限额`}
                  </span>
                </div>
                {state.usage.budget > 0 && (
                  <div className="bar">
                    <i style={{ width: pct + "%" }} />
                  </div>
                )}
                <label className="field">
                  <span>每月上限（tokens）</span>
                  <input
                    type="number"
                    min={0}
                    step={100000}
                    value={s.budget}
                    onChange={(e) => set({ ...s, budget: Math.max(0, Math.round(+e.target.value || 0)) })}
                  />
                  <small>达到上限后暂停新的 AI 请求，下月自动恢复。填 0 表示不限。</small>
                </label>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>任务</th>
                      <th>模型</th>
                      <th className="num">tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.usage.recent.map((u, i) => (
                      <tr key={i}>
                        <td>{new Date(u.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        <td>
                          {({ teach: "解释", diagnose: "分析", review: "审查", repair: "修订", overview: "导读", flashcards: "制卡" } as Record<string, string>)[u.stage] ?? u.stage}
                        </td>
                        <td>{u.model ?? "—"}</td>
                        <td className="num">
                          {u.exact ? "" : "≈"}
                          {u.tokens.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    {!state.usage.recent.length && (
                      <tr>
                        <td colSpan={4} style={{ color: "var(--ink-3)" }}>
                          本月还没有 AI 请求。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
            {tab === "data" && (
              <>
                <h3>数据与备份</h3>
                <p className="hint">所有资料、批注和解释都保存在本机。</p>
                <div className="data-actions">
                  <div className="row">
                    <div>
                      导出备份
                      <small>资料文字、批注与解释保存为一个 JSON 文件，不含原文件和 Key。</small>
                    </div>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          const p = await api.export();
                          if (p) toast("已导出到 " + p);
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                    >
                      <Icon name="download" />
                      导出
                    </button>
                  </div>
                  <div className="row">
                    <div>
                      从备份恢复
                      <small>合并导入，不会覆盖现有内容。</small>
                    </div>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          await api.restore();
                          await refresh();
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                    >
                      <Icon name="upload" />
                      恢复
                    </button>
                  </div>
                  <div className="row">
                    <div>
                      数据文件夹
                      <small>完整备份：退出 Subaudi 后复制整个文件夹。</small>
                    </div>
                    <button className="btn" onClick={() => api.dataFolder()}>
                      <Icon name="folder" />
                      打开
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="pane-foot">
            <span className="grow">{dirty && (tab === "ai" || tab === "usage") ? "有未保存的更改" : ""}</span>
            <button className="btn" onClick={close}>
              关闭
            </button>
            {(tab === "ai" || tab === "usage") && (
              <button className="btn primary" disabled={!dirty || saving} onClick={save}>
                {saving && <span className="spinner" />}
                保存
              </button>
            )}
          </div>
        </div>
      </div>
    </Scrim>
  );
}
