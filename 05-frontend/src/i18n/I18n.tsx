import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  LANG_STORAGE_KEY,
  pickInitialLang,
  translate,
  type Lang,
} from "../lib/i18n";

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** translate a key, filling `{name}` placeholders from `vars` */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nCtx = createContext<I18nValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() =>
    pickInitialLang(readStored(), typeof navigator !== "undefined" ? navigator.language : undefined),
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* private mode - the choice just won't persist */
    }
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useT(): I18nValue {
  const v = useContext(I18nCtx);
  if (!v) throw new Error("useT must be used inside <I18nProvider>");
  return v;
}

/** EN / ไทย switch - a two-button pill. */
export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useT();
  const pick = useCallback((l: Lang) => () => setLang(l), [setLang]);
  return (
    <div
      className={`langtoggle${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={t("lang.label")}
    >
      <button
        type="button"
        className={`langtoggle__opt${lang === "en" ? " is-on" : ""}`}
        aria-pressed={lang === "en"}
        onClick={pick("en")}
      >
        {t("lang.en")}
      </button>
      <button
        type="button"
        className={`langtoggle__opt${lang === "th" ? " is-on" : ""}`}
        aria-pressed={lang === "th"}
        onClick={pick("th")}
      >
        {t("lang.th")}
      </button>
    </div>
  );
}
