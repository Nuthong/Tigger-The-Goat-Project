import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Logo } from "../components/Logo";
import { LangToggle, useT } from "../i18n/I18n";
import "../styles/admin.css";

/* 16px stroke icons - kept inline so the shell has no asset deps */
const I = {
  gauge: "M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0-9a8 8 0 0 0-8 8h2m14 0h2a8 8 0 0 0-8-8Zm2.5 6.5L13 12",
  tape: "M4 7h10M4 12h15M4 17h7M4 4v16",
  calendar: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  grid: "M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z",
  users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 8v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1m14-8a3 3 0 1 0 0-6m4 12v-1a4 4 0 0 0-3-3.87",
  tag: "M20 12l-8 8-9-9V4h7l10 10-1 .5M7 7h.01",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6",
  sparkle: "M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  shield: "M12 3l8 3v6c0 4.5-3 8-8 9-5-1-8-4.5-8-9V6l8-3Z",
  star: "M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 21l1.1-6.5L2.6 9.8l6.5-.9L12 3Z",
  chart: "M4 20h16M7 20V10m5 10V4m5 16v-7",
  bed: "M3 19v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 15h18M7 10V8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2",
  cup: "M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8Zm11 1h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2m3-2v2",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3m-4 4v2",
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg className="admin__navlink__icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

interface Item {
  to: string;
  label: string;
  icon: string;
  show: boolean;
}
interface Group {
  label: string | null;
  items: Item[];
}

const ROLE_KEY: Record<string, string> = {
  customer: "role.customer",
  receptionist: "role.receptionist",
  housekeeping: "role.housekeeping",
  accounting: "role.accounting",
  manager: "role.manager",
  admin: "role.admin",
};

export function AdminLayout() {
  const { user, logout, isManager, isAdmin, canFrontDesk, canHousekeeping, canAccounting } =
    useAuth();
  const nav = useNavigate();
  const { t } = useT();
  const atRoot = useLocation().pathname === "/admin";

  const groups: Group[] = [
    {
      label: null,
      items: [
        { to: "/admin/overview", label: t("admin.nav.overview"), icon: I.gauge, show: isManager },
      ],
    },
    {
      label: t("admin.nav.groupOperations"),
      items: [
        { to: "/admin/tape", label: t("admin.nav.tape"), icon: I.tape, show: canFrontDesk },
        { to: "/admin/bookings", label: t("admin.nav.bookings"), icon: I.calendar, show: canFrontDesk },
        { to: "/admin/in-house", label: t("admin.nav.inHouse"), icon: I.bed, show: canFrontDesk },
        { to: "/admin/rooms", label: t("admin.nav.rooms"), icon: I.grid, show: true },
        { to: "/admin/guests", label: t("admin.nav.guests"), icon: I.users, show: canFrontDesk },
        {
          to: "/admin/housekeeping",
          label: t("admin.nav.housekeeping"),
          icon: I.sparkle,
          show: canHousekeeping,
        },
        { to: "/admin/maintenance", label: t("admin.nav.maintenance"), icon: I.wrench, show: true },
        { to: "/admin/reviews", label: t("admin.nav.reviews"), icon: I.star, show: true },
      ],
    },
    {
      label: t("admin.nav.groupRevenue"),
      items: [
        { to: "/admin/rates", label: t("admin.nav.ratePlans"), icon: I.tag, show: true },
        { to: "/admin/services", label: t("admin.nav.services"), icon: I.cup, show: isManager },
        { to: "/admin/reports", label: t("admin.nav.reports"), icon: I.chart, show: isManager },
        {
          to: "/admin/invoices",
          label: t("admin.nav.invoices"),
          icon: I.receipt,
          show: canAccounting,
        },
      ],
    },
    {
      label: t("admin.nav.groupAdmin"),
      items: [
        { to: "/admin/audit", label: t("admin.nav.auditTrail"), icon: I.list, show: isManager },
        { to: "/admin/users", label: t("admin.nav.usersRoles"), icon: I.shield, show: isAdmin },
        { to: "/admin/security", label: t("admin.nav.security"), icon: I.lock, show: isAdmin },
      ],
    },
  ]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show) }))
    .filter((g) => g.items.length > 0);

  const initials = (user?.username ?? "?").slice(0, 2);

  return (
    <div className="admin">
      <aside className="admin__side">
        <NavLink to="/" className="admin__brand" aria-label={t("admin.homeAria", { brand: t("nav.brand") })}>
          <Logo className="admin__logo" />
        </NavLink>

        <nav className="admin__nav">
          {groups.map((g, gi) => (
            <div key={g.label ?? `g${gi}`}>
              {g.label && <div className="admin__navgroup">{g.label}</div>}
              {g.items.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) => `admin__navlink${isActive ? " is-active" : ""}`}
                >
                  <Icon d={l.icon} />
                  {l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin__foot">
          <div className="admin__who">
            <span className="admin__avatar">{initials}</span>
            <span>
              {user?.username}
              <small>{user?.role ? t(ROLE_KEY[user.role] ?? user.role) : ""}</small>
            </span>
          </div>
          <button
            type="button"
            className="admin__signout"
            onClick={async () => {
              await logout();
              nav("/");
            }}
          >
            {t("nav.signOut")}
          </button>
        </div>
      </aside>

      <main className="admin__main">
        <div className="admin__topbar">
          <button type="button" className="backlink" onClick={() => nav(-1)}>
            ‹ {t("admin.back")}
          </button>
          {!atRoot && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="backlink"
                onClick={() => nav(isManager ? "/admin/overview" : "/admin")}
              >
                {isManager ? t("admin.nav.overview") : t("admin.home")}
              </button>
            </>
          )}
          <LangToggle className="admin__lang" />
        </div>
        <Outlet />
      </main>
    </div>
  );
}
