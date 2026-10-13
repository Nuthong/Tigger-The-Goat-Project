import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "./Modal";

/**
 * Promise-based confirm / prompt dialogs - drop-in replacements for
 * `window.confirm` and `window.prompt`, which are inconsistent and can't be
 * styled. Mount `<DialogProvider>` once near the app root, then:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Cancel booking?", tone: "danger" })) { ... }
 *
 *   const prompt = usePrompt();
 *   const how = await prompt({ title: "How was it fixed?", required: true });
 *   if (how !== null) { ... }
 */

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
type PromptFn = (opts: PromptOptions) => Promise<string | null>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);
const PromptCtx = createContext<PromptFn | null>(null);

type State =
  | { kind: "none" }
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "none" });
  const close = useCallback(() => setState({ kind: "none" }), []);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise((resolve) => setState({ kind: "confirm", opts, resolve })),
    [],
  );
  const prompt = useCallback<PromptFn>(
    (opts) => new Promise((resolve) => setState({ kind: "prompt", opts, resolve })),
    [],
  );

  return (
    <ConfirmCtx.Provider value={confirm}>
      <PromptCtx.Provider value={prompt}>
        {children}
        {state.kind === "confirm" && (
          <ConfirmDialog
            opts={state.opts}
            onDone={(v) => {
              state.resolve(v);
              close();
            }}
          />
        )}
        {state.kind === "prompt" && (
          <PromptDialog
            opts={state.opts}
            onDone={(v) => {
              state.resolve(v);
              close();
            }}
          />
        )}
      </PromptCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx);
  if (!fn) throw new Error("useConfirm must be used inside <DialogProvider>");
  return fn;
}

export function usePrompt(): PromptFn {
  const fn = useContext(PromptCtx);
  if (!fn) throw new Error("usePrompt must be used inside <DialogProvider>");
  return fn;
}

function ConfirmDialog({
  opts,
  onDone,
}: {
  opts: ConfirmOptions;
  onDone: (v: boolean) => void;
}) {
  const titleId = useId();
  return (
    <Modal onClose={() => onDone(false)} labelledBy={titleId} maxWidth={420}>
      <h3 id={titleId}>{opts.title}</h3>
      {opts.body != null && (
        <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>
          {opts.body}
        </div>
      )}
      <div className="row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
        <button className="btn btn--sm btn--quiet" onClick={() => onDone(false)}>
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <button
          className={`btn btn--sm ${opts.tone === "danger" ? "btn--danger" : "btn--gold"}`}
          onClick={() => onDone(true)}
        >
          {opts.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

function PromptDialog({
  opts,
  onDone,
}: {
  opts: PromptOptions;
  onDone: (v: string | null) => void;
}) {
  const titleId = useId();
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();
  const invalid = useMemo(() => opts.required && trimmed.length === 0, [opts.required, trimmed]);

  function submit() {
    if (invalid) {
      inputRef.current?.focus();
      return;
    }
    onDone(trimmed.length === 0 && !opts.required ? "" : trimmed);
  }

  return (
    <Modal onClose={() => onDone(null)} labelledBy={titleId} maxWidth={440}>
      <h3 id={titleId}>{opts.title}</h3>
      {opts.body != null && (
        <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>
          {opts.body}
        </div>
      )}
      <label className="field" style={{ marginTop: 14 }}>
        {opts.label && <span>{opts.label}</span>}
        <input
          ref={inputRef}
          value={value}
          placeholder={opts.placeholder}
          maxLength={opts.maxLength}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        {invalid && <span className="hint" style={{ color: "var(--danger)" }}>Required.</span>}
      </label>
      <div className="row" style={{ marginTop: 18, justifyContent: "flex-end" }}>
        <button className="btn btn--sm btn--quiet" onClick={() => onDone(null)}>
          {opts.cancelLabel ?? "Cancel"}
        </button>
        <button
          className={`btn btn--sm ${opts.tone === "danger" ? "btn--danger" : "btn--gold"}`}
          disabled={invalid}
          onClick={submit}
        >
          {opts.confirmLabel ?? "OK"}
        </button>
      </div>
    </Modal>
  );
}
