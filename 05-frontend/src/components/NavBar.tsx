import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useT, LangToggle } from "../i18n/I18n";

export function NavBar() {
  const { user, logout } = useAuth();
  const { t } = useT();
  const nav = useNavigate();

  const link = ({ isActive }: { isActive: boolean }) =>
    `nav__link${isActive ? " is-active" : ""}`;

  return (
    <header className="nav">
      <div className="container container--wide nav__inner">
        <NavLink to="/" className="nav__brand">
          Tigger&nbsp;Oriental
        </NavLink>
        <nav className="nav__links">
          <NavLink to="/rooms" className={link}>
            {t("nav.rooms")}
          </NavLink>
          {user && (
            <NavLink to="/bookings" className={link}>
              {t("nav.account")}
            </NavLink>
          )}
          <NavLink to="/book" className="btn btn--sm btn--gold">
            {t("nav.book")}
          </NavLink>
          {user ? (
            <button
              className="btn btn--sm btn--quiet"
              onClick={async () => {
                await logout();
                nav("/");
              }}
            >
              {t("nav.signOut")}
            </button>
          ) : (
            <NavLink to="/login" className="nav__link">
              {t("nav.signIn")}
            </NavLink>
          )}
          <LangToggle />
        </nav>
      </div>
    </header>
  );
}
