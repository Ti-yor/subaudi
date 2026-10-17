import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e)
    .replace(/^Error invoking remote method '[^']+': /, "")
    .replace(/^(Error|ZodError): /, "");

/* ───────── toasts ───────── */
type ToastItem = {
  id: number;
  text: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
};
let pushToast: (t: ToastItem) => void = () => {};
let seq = 0;
export function toast(
  text: string,
  opts: { kind?: "info" | "error"; action?: ToastItem["action"] } = {},
) {
  pushToast({ id: ++seq, text, kind: opts.kind ?? "info", action: opts.action });
}
export const toastError = (e: unknown, action?: ToastItem["action"]) =>
  toast(errText(e), { kind: "error", action });
export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((v) => [...v.filter((x) => x.text !== t.text), t].slice(-3));
      setTimeout(
        () => setItems((v) => v.filter((x) => x.id !== t.id)),
        t.kind === "error" ? 9000 : 3800,
      );
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={"toast " + t.kind} role={t.kind === "error" ? "alert" : undefined}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                setItems((v) => v.filter((x) => x.id !== t.id));
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="x" aria-label="关闭" onClick={() => setItems((v) => v.filter((x) => x.id !== t.id))}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ───────── menu ───────── */
export type MenuItem =
  | "sep"
  | {
      label: string;
      icon?: IconName;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
    };
export type MenuState = { x: number; y: number; items: MenuItem[] } | null;
export function menuAt(el: Element, items: MenuItem[], align: "left" | "right" = "left"): MenuState {
  const r = el.getBoundingClientRect();
  return { x: align === "right" ? r.right : r.left, y: r.bottom + 4, items, ...(align === "right" ? { alignRight: true } : {}) } as any;
}
export function Menu({ state, close }: { state: MenuState; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!state || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    let left = (state as any).alignRight ? state.x - width : state.x;
    let top = state.y;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    if (top + height > innerHeight - 8) top = Math.max(8, state.y - height - 40);
    setPos({ left, top });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [state]);
  useEffect(() => {
    if (!state) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    };
    addEventListener("pointerdown", down, true);
    addEventListener("keydown", key, true);
    addEventListener("blur", close);
    return () => {
      removeEventListener("pointerdown", down, true);
      removeEventListener("keydown", key, true);
      removeEventListener("blur", close);
    };
  }, [state]);
  if (!state) return null;
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={pos ?? { left: state.x, top: state.y, visibility: "hidden" }}
    >
      {state.items.map((item, i) =>
        item === "sep" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? "danger" : ""}
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onClick();
            }}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
            {item.checked && (
              <span className="check-mark">
                <Icon name="check" size={14} />
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

/* ───────── dialog ───────── */
export function Scrim({
  children,
  onClose,
  top,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  top?: boolean;
  label: string;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div
      className={"scrim" + (top ? " top" : "")}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  );
}

type Ask = {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};
let pushAsk: (a: Ask) => void = () => {};
export const confirmAction = (a: Omit<Ask, "resolve">) =>
  new Promise<boolean>((resolve) => pushAsk({ ...a, resolve }));
export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    pushAsk = setAsk;
  }, []);
  if (!ask) return null;
  const done = (ok: boolean) => {
    ask.resolve(ok);
    setAsk(null);
  };
  return (
    <Scrim onClose={() => done(false)} label={ask.title}>
      <div className="dialog">
        <h2>{ask.title}</h2>
        {ask.body && <p>{ask.body}</p>}
        <div className="actions">
          <button className="btn" onClick={() => done(false)}>
            取消
          </button>
          <button
            autoFocus
            className={"btn " + (ask.danger ? "danger solid" : "primary")}
            onClick={() => done(true)}
          >
            {ask.confirm}
          </button>
        </div>
      </div>
    </Scrim>
  );
}

export const formatTokens = (n: number) =>
  n >= 1_000_000
    ? (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M"
    : n >= 1000
      ? (n / 1000).toFixed(n >= 100_000 ? 0 : 1) + "k"
      : String(n);
export const formatBytes = (n: number) =>
  n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
export const isMac = navigator.platform.startsWith("Mac");
export const mod = isMac ? "⌘" : "Ctrl";
