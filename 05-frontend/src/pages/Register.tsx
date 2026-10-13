import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Alert, Field, Spinner } from "../components/ui";
import { BackLink } from "../components/BackLink";
import { Logo } from "../components/Logo";
import { ApiError } from "../lib/api";
import { isSafeNext } from "../lib/validation";
import { useT } from "../i18n/I18n";

const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/;

export function Register() {
  const { register } = useAuth();
  const { t } = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get("next");
  const next = isSafeNext(rawNext) ? rawNext : null;
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    username: "",
    email: "",
    password: "",
  });
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const usernameOk = USERNAME_RE.test(form.username);
  const passwordOk = form.password.length >= 10;
  const pwMatch = form.password === confirmPw;
  const formValid =
    !!form.first_name.trim() &&
    !!form.last_name.trim() &&
    usernameOk &&
    passwordOk &&
    pwMatch;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!formValid) {
      setErr(
        !usernameOk
          ? t("auth.usernameBad")
          : !passwordOk
            ? t("auth.pwTooShort")
            : t("auth.pwMismatchFull"),
      );
      return;
    }
    setErr("");
    setBusy(true);
    try {
      await register(form);
      nav(next ?? "/book", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("auth.somethingWrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page container authpage authpage--wide">
      <BackLink to="/login" label={t("auth.signInTitle")} />
      <Logo className="logo--ink authpage__logo" />
      <h1 style={{ fontSize: 34 }}>{t("auth.createTitle")}</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {t("auth.createBlurb")}
      </p>

      <form className="stack" style={{ marginTop: 28 }} onSubmit={submit}>
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-2" style={{ gap: 16 }}>
          <Field
            label={t("auth.firstName")}
            value={form.first_name}
            onChange={set("first_name")}
            required
          />
          <Field
            label={t("auth.lastName")}
            value={form.last_name}
            onChange={set("last_name")}
            required
          />
        </div>
        <Field
          label={t("auth.username")}
          hint={t("auth.usernameHint")}
          value={form.username}
          onChange={set("username")}
          pattern="[A-Za-z0-9._\-]{3,50}"
          minLength={3}
          maxLength={50}
          required
        />
        <Field label={t("auth.email")} type="email" value={form.email} onChange={set("email")} required />
        <Field
          label={t("auth.password")}
          type="password"
          hint={t("auth.passwordHint")}
          value={form.password}
          onChange={set("password")}
          minLength={10}
          required
        />
        <Field
          label={t("auth.confirmPw")}
          type="password"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          minLength={10}
          required
          hint={confirmPw && !pwMatch ? t("auth.pwMismatch") : undefined}
        />
        <button className="btn btn--gold" disabled={busy || !formValid} style={{ marginTop: 4 }}>
          {busy ? <Spinner /> : t("auth.createAccountBtn")}
        </button>
      </form>

      <p className="tiny" style={{ marginTop: 22 }}>
        {t("auth.haveOne")} <Link to="/login">{t("auth.signInTitle")}</Link>
      </p>
    </div>
  );
}
