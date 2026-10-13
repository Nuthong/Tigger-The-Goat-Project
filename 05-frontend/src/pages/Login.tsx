import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Alert, Field, Spinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { Logo } from "../components/Logo";
import { ApiError } from "../lib/api";
import { isSafeNext } from "../lib/validation";
import { useT } from "../i18n/I18n";

export function Login() {
  const { login, isStaff } = useAuth();
  const { t } = useT();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const candidateNext = params.get("next") || loc.state?.from || null;
  const next = isSafeNext(candidateNext) ? candidateNext : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(username, password);
      nav(next ?? (isStaff ? "/admin" : "/bookings"), { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("auth.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page container authpage">
      <BackLink to="/" label={t("common.home")} />
      <Logo className="logo--ink authpage__logo" />
      <h1 style={{ fontSize: 34 }}>{t("auth.signInTitle")}</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {next ? t("auth.signInToFinish") : t("auth.welcomeBack")}
      </p>

      <form className="stack stack--roomy" style={{ marginTop: 28 }} onSubmit={submit}>
        {err && <Alert>{err}</Alert>}
        <Field
          label={t("auth.userField")}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Field
          label={t("auth.password")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="btn btn--gold" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? <Spinner /> : t("auth.signInBtn")}
        </button>
      </form>

      <p className="tiny" style={{ marginTop: 22 }}>
        {t("auth.noAccount")}{" "}
        <Link to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}>
          {t("auth.createOne")}
        </Link>
      </p>
      <div className="demobox">
        <p className="demobox__title">{t("auth.demoAccounts")}</p>
        <p>
          <code>manager01</code> manager · <code>recep01</code> front desk ·{" "}
          <code>somchai</code> guest
        </p>
        <p style={{ marginTop: 4 }}>
          {t("auth.demoPw")} <code>Passw0rd!2026</code>
        </p>
      </div>
    </div>
  );
}
