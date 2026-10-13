import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { HOTEL } from "../lib/hotel";
import { useT, LangToggle } from "../i18n/I18n";

export function Footer() {
  const { t } = useT();
  return (
    <footer className="sitefooter">
      <div className="container container--wide">
        <div className="sitefooter__grid">
          <div className="sitefooter__brandcol">
            <Logo className="sitefooter__logo" />
            <address className="sitefooter__address">
              {HOTEL.addressLines[0]}
              <br />
              {HOTEL.addressLines[1]}
            </address>
            <div className="sitefooter__contact">
              <a href={HOTEL.phoneHref}>{HOTEL.phone}</a>
              <a href={`mailto:${HOTEL.email}`}>{HOTEL.email}</a>
            </div>
          </div>

          <nav className="sitefooter__col" aria-label={t("foot.stay")}>
            <h4 className="sitefooter__heading">{t("foot.stay")}</h4>
            <Link to="/rooms">{t("foot.rooms")}</Link>
            <Link to="/book">{t("foot.availability")}</Link>
          </nav>

          <nav className="sitefooter__col" aria-label={t("foot.accountHeading")}>
            <h4 className="sitefooter__heading">{t("foot.accountHeading")}</h4>
            <Link to="/bookings">{t("foot.account")}</Link>
            <Link to="/login">{t("foot.signIn")}</Link>
          </nav>

          <div className="sitefooter__col">
            <h4 className="sitefooter__heading">{t("lang.label")}</h4>
            <LangToggle />
          </div>
        </div>

        <div className="sitefooter__bar">
          <p>© {new Date().getFullYear()} TiggerTheGoat Inc. · A TiggerTheGoat Inc. hotel</p>
          <p className="sitefooter__credit">
            310-2209 Database Systems - Mini-DB Project · demo · hero footage:
            Wikimedia Commons CC BY-SA (Nesnad) and Mixkit
          </p>
        </div>
      </div>
    </footer>
  );
}
