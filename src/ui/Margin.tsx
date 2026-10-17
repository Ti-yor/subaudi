import React, { useEffect, useRef, useState } from "react";
import type { AnchorType, Explanation, OverviewType } from "../contracts";
import { MarkdownView } from "./MarkdownView";
import { Icon } from "./icons";
import { mod } from "./kit";

export type Target = { anchor: AnchorType; parent: string | null };
export type Failure = { text: string; settings?: boolean; retry?: () => void };
const BASIS: Record<string, string> = {
  source_statement: "原文陈述",
  derived: "推导",
  background: "背景知识",
  interpretation: "解读",
  uncertain: "不确定",
};

export function Margin({
  exp,
  path,
  draft,
  busy,
  stage,
  failure,
  overview,
  canAsk,
  hasSearch,
  onRun,
  onCancel,
  onSelect,
  onJump,
  onOpen,
  onFlag,
  onDelete,
  onClose,
  onSettings,
  onDismissDraft,
  onExplainObstacle,
  onDismissOverview,
  scrollRef,
}: {
  exp?: Explanation;
  path: Explanation[];
  draft: (Target & { focus?: boolean }) | null;
  busy: boolean;
  stage: string;
  failure: Failure | null;
  overview: OverviewType | null;
  canAsk: boolean;
  hasSearch: boolean;
  onRun: (o: { question: string; complex: boolean; query: string }) => void;
  onCancel: () => void;
  onSelect: (e: React.MouseEvent<HTMLElement>) => void;
  onJump: (doc: string, block: string) => void;
  onOpen: (id: string) => void;
  onFlag: () => void;
  onDelete: () => void;
  onClose: () => void;
  onSettings: () => void;
  onDismissDraft: () => void;
  onExplainObstacle: (block: string, question: string) => void;
  onDismissOverview: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [question, setQuestion] = useState("");
  const [complex, setComplex] = useState(false);
  const [query, setQuery] = useState("");
  const ask = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setQuestion("");
    setQuery("");
    if (draft?.focus) requestAnimationFrame(() => ask.current?.focus());
  }, [draft]);
  const submit = () => onRun({ question, complex, query });
  const body = (id: string, text: string, className = "prose") => (
    <div className={className} data-artifact={exp!.id} data-explanation={exp!.id} data-block={id}>
      <MarkdownView text={text} />
    </div>
  );
  const quote = draft?.anchor.quote ?? exp?.anchor.quote;
  return (
    <aside className="margin" aria-label="解释">
      <div className="margin-head">
        <div className="crumbs">
          {exp && !draft && !busy && !overview ? (
            <>
              <button title="回到原文" onClick={() => onJump(exp.root.doc, exp.root.block)}>
                原文
              </button>
              {path.map((e) => (
                <React.Fragment key={e.id}>
                  <Icon name="chevronR" size={12} />
                  <button title={e.draft.title} onClick={() => onOpen(e.id)}>
                    {e.draft.title}
                  </button>
                </React.Fragment>
              ))}
            </>
          ) : (
            <span>{busy ? "正在解释" : overview ? "导读" : draft ? "解释选区" : "解释"}</span>
          )}
        </div>
        <button className="icon-btn" title={`关闭（${mod}+J）`} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="margin-body" ref={scrollRef} onMouseUp={onSelect} onContextMenu={onSelect}>
        {failure && (
          <div className="callout" role="alert">
            <Icon name="alert" />
            <div>
              {failure.text}
              {(failure.settings || failure.retry) && (
                <div className="actions">
                  {failure.settings && (
                    <button className="btn" onClick={onSettings}>
                      打开设置
                    </button>
                  )}
                  {failure.retry && (
                    <button className="btn" onClick={failure.retry}>
                      重试
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {busy ? (
          <>
            {quote && <blockquote className={"note-quote" + (quote.length > 120 ? " long" : "")}>{quote}</blockquote>}
            <div className="working" role="status">
              <span className="spinner" />
              {stage || "正在解释…"}
            </div>
            <div className="skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <button className="btn" onClick={onCancel}>
              <Icon name="stop" />
              停止
            </button>
          </>
        ) : draft ? (
          <>
            <blockquote className={"note-quote" + (draft.anchor.quote.length > 120 ? " long" : "")}>
              {draft.anchor.quote}
            </blockquote>
            <div className="composer">
              <textarea
                ref={ask}
                value={question}
                placeholder="想问什么？留空则解释这段话在这里的意思"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="opts">
                <label title="先诊断缺口，生成后再自审一轮；更慢，调用次数更多">
                  <input type="checkbox" checked={complex} onChange={(e) => setComplex(e.target.checked)} />
                  深入分析
                </label>
                {hasSearch && (
                  <label>
                    联网检索
                    <input
                      type="text"
                      value={query}
                      placeholder="检索词（可选）"
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="row">
                <button className="btn primary" onClick={submit}>
                  <Icon name="spark" />
                  {canAsk ? "解释" : "设置 AI 服务后解释"}
                </button>
                <span className="grow hint">
                  <kbd>{mod}</kbd>+<kbd>Enter</kbd>
                </span>
                <button className="btn ghost" onClick={onDismissDraft}>
                  取消
                </button>
              </div>
            </div>
            {exp && <p className="tip">当前解释仍保留，可从左侧“解释”列表回到它。</p>}
          </>
        ) : overview ? (
          <>
            <h2 className="note-title">{overview.central_question}</h2>
            <div className="note-meta">
              <span className="tag">{overview.kind === "structural_preview" ? "结构导读" : "内容导读"}</span>
              <span>{overview.scope}</span>
            </div>
            {overview.route.length > 0 && (
              <ol className="overview-route">
                {overview.route.map((r, i) => (
                  <li key={i}>{r.role}</li>
                ))}
              </ol>
            )}
            {overview.essential_prerequisites.length > 0 && (
              <div className="note-section">
                <h3>先要知道</h3>
                {overview.essential_prerequisites.map((p) => (
                  <p className="prose" key={p.term}>
                    <strong>{p.term}</strong>：{p.entry}
                  </p>
                ))}
              </div>
            )}
            {overview.likely_obstacles.length > 0 && (
              <div className="note-section">
                <h3>可能卡住的地方</h3>
                {overview.likely_obstacles.map((o) => (
                  <button
                    key={o.block_id + o.question}
                    className="obstacle"
                    onClick={() => onExplainObstacle(o.block_id, o.question)}
                  >
                    {o.question}
                    <small>{o.priority === "blocking" ? "不弄懂会读不下去" : o.priority === "useful" ? "值得先弄清" : "可选"} · 点击解释</small>
                  </button>
                ))}
              </div>
            )}
            <div className="margin-foot">
              <button className="btn" onClick={onDismissOverview}>
                收起导读
              </button>
            </div>
          </>
        ) : exp ? (
          <article>
            <blockquote
              className={"note-quote" + (exp.anchor.quote.length > 120 ? " long" : "")}
              title="点击回到原文"
              style={{ cursor: "pointer" }}
              onClick={() => onJump(exp.root.doc, exp.root.block)}
            >
              {exp.anchor.quote}
            </blockquote>
            <h2 className="note-title">{exp.draft.title}</h2>
            <div className="note-meta">
              {exp.stale && <span className="tag warn">已标记有误</span>}
              {exp.draft.status === "limited" && <span className="tag warn">资料有限</span>}
              <span>{new Date(exp.created).toLocaleDateString("zh-CN")}</span>
            </div>
            {body("brief", exp.draft.brief, "prose brief")}
            {exp.draft.sections.map((s) => (
              <section className="note-section" key={s.local_id}>
                <h3>{s.title}</h3>
                {body(s.local_id, s.body_markdown)}
              </section>
            ))}
            <div className="return">
              <h3>回到原句</h3>
              {body("return_to_source", exp.draft.return_to_source)}
            </div>
            {exp.draft.unresolved.map((u) => (
              <p className="unresolved" key={u.issue}>
                <b>{u.issue}</b>　{u.next_step}
              </p>
            ))}
            {exp.draft.micro_check && (
              <details className="drill">
                <summary>
                  自测一下
                  <small>{exp.draft.micro_check.question.slice(0, 18)}…</small>
                  <Icon name="chevronD" size={14} />
                </summary>
                <div className="inner">
                  <p>{exp.draft.micro_check.question}</p>
                  <details className="reveal">
                    <summary>提示</summary>
                    <p>{exp.draft.micro_check.hint}</p>
                  </details>
                  <details className="reveal">
                    <summary>答案</summary>
                    <p>{exp.draft.micro_check.answer}</p>
                    {exp.draft.micro_check.remediation && <p className="hint">{exp.draft.micro_check.remediation}</p>}
                  </details>
                </div>
              </details>
            )}
            <details className="drill">
              <summary>
                依据
                <small>{exp.evidence.length} 处来源</small>
                <Icon name="chevronD" size={14} />
              </summary>
              <div className="inner">
                {exp.evidence.map((e) => (
                  <div className="source" key={e.source_id}>
                    <span className="sid">{e.source_id}</span>
                    <div className="what">
                      <b>{e.title}</b>
                      <p>{e.excerpt}</p>
                      {e.doc && e.block ? (
                        <button onClick={() => onJump(e.doc!, e.block!)}>在原文中查看</button>
                      ) : e.url ? (
                        <button onClick={() => window.subaudi.external(e.url!)}>打开网页</button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {exp.draft.claims.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 12.5, margin: "14px 0 8px" }}>关键论断</h3>
                    {exp.draft.claims.map((c) => (
                      <p className="claim" key={c.local_id}>
                        {c.text} <em>（{BASIS[c.basis] ?? c.basis}{c.evidence_ids.length ? " " + c.evidence_ids.join(" ") : ""}）</em>
                      </p>
                    ))}
                  </>
                )}
                <p className="hint">{exp.review}</p>
              </div>
            </details>
            <p className="tip">在解释里划选任意词句，可以继续追问。</p>
            <div className="margin-foot">
              <button className="btn" disabled={exp.stale} onClick={onFlag}>
                <Icon name="flag" />
                {exp.stale ? "已标记有误" : "标记有误"}
              </button>
              <button className="btn ghost danger" onClick={onDelete}>
                <Icon name="trash" />
                删除
              </button>
            </div>
          </article>
        ) : (
          <div className="margin-empty">
            <h3>在页边写下读不懂的地方</h3>
            <p>选中原文里卡住你的词句，Subaudi 会补上作者省略的前提、步骤和条件，再带你回到原句。</p>
            <ol>
              <li>
                选中文字，点 <b>解释</b>，或按 <kbd>{mod}</kbd>+<kbd>E</kbd>
              </li>
              <li>
                点 <b>提问</b> 写下具体疑问
              </li>
              <li>在解释里继续划选，层层追问</li>
            </ol>
          </div>
        )}
      </div>
    </aside>
  );
}
