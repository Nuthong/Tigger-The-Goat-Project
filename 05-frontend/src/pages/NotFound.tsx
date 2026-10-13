import { Link } from "react-router-dom";
import { useT } from "../i18n/I18n";

export function NotFound() {
  const { t } = useT();
  return (
    <div className="page container center" style={{ paddingTop: 140, paddingBottom: 140 }}>
      <p className="eyebrow">{t("nf.tag")}</p>
      <div className="rule" style={{ marginInline: "auto" }} />
      <h1 style={{ fontSize: "clamp(32px, 5vw, 52px)" }}>{t("nf.title")}</h1>
      <p className="lede" style={{ margin: "16px auto 0", maxWidth: "34ch" }}>
        {t("nf.body")}
      </p>
      <div className="row" style={{ justifyContent: "center", marginTop: 28 }}>
        <Link to="/" className="btn btn--gold">
          {t("nf.home")}
        </Link>
        <Link to="/book" className="btn btn--outline">
          {t("nf.findRoom")}
        </Link>
      </div>
    </div>
  );
}
