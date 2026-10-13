import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Minimal toast notifications. Mount `<ToastProvider>` once near the app root and
 * call `useToast()` for `toast.success(msg)` / `toast.error(msg)` / `toast.info(msg)`.
 * Toasts stack top-right, auto-dismiss after ~4.5s, and can be dismissed by click.
 */

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
const TTL = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq.current;
      setToasts((list) => [...list, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), TTL);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 400,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: "min(360px, calc(100vw - 32px))",
        }}
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            style={{
              textAlign: "left",
              cursor: "pointer",
              border: "1px solid var(--line)",
              borderLeft: `3px solid ${TONE[t.kind]}`,
              background: "var(--bg)",
              color: "var(--ink)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              font: "inherit",
              fontSize: 14,
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            }}
          >
            {t.message}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  );
}

const TONE: Record<ToastKind, string> = {
  success: "var(--ok)",
  error: "var(--danger)",
  info: "var(--gold)",
};

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside <ToastProvider>");
  return v;
}
