import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminApi, ApiError } from "../lib/api";
import type { UserRow } from "../lib/types";
import { useAuth } from "../auth/AuthContext";
import { Alert, Field, Pager, Spinner, TableEmpty, TableSkeleton } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { fmtDate } from "../lib/format";
import { useT } from "../i18n/I18n";

// a customer's role is fixed at sign-up - only staff roles are picked here
const STAFF_ROLES = ["receptionist", "housekeeping", "accounting", "manager", "admin"] as const;
const PAGE = 25;

const ROLE_KEY: Record<string, string> = {
  customer: "role.customer",
  receptionist: "role.receptionist",
  housekeeping: "role.housekeeping",
  accounting: "role.accounting",
  manager: "role.manager",
  admin: "role.admin",
};

function isLocked(u: UserRow): boolean {
  return u.locked_until != null && new Date(u.locked_until) > new Date();
}
function isCustomer(u: UserRow): boolean {
  return u.role === "customer" || u.customer_id != null;
}

export function Users() {
  const { t, lang } = useT();
  const { user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [staff, setStaff] = useState<UserRow[] | null>(null);
  const [staffTotal, setStaffTotal] = useState(0);
  const [guests, setGuests] = useState<UserRow[] | null>(null);
  const [guestTotal, setGuestTotal] = useState(0);
  const [guestOffset, setGuestOffset] = useState(0);
  const [q, setQ] = useState("");
  const [sq, setSq] = useState("");
  const [reload, setReload] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [adv, setAdv] = useState<Record<string, string>>({});

  const roleLabel = (r: string) => t(ROLE_KEY[r] ?? r);

  // one filter per column - they narrow both tables (staff and guest logins)
  const advFields: FilterField[] = [
    { type: "text", key: "username", label: t("us.colUsername") },
    { type: "text", key: "email", label: t("us.colEmail") },
    {
      type: "select",
      key: "role",
      label: t("us.colRole"),
      options: [...STAFF_ROLES, "customer"].map((r) => ({ value: r, label: roleLabel(r) })),
    },
    { type: "text", key: "name", label: t("us.colLinked") },
    { type: "date-range", label: t("us.colLastLogin"), from: "login_from", to: "login_to" },
    {
      type: "select",
      key: "never_signed_in",
      label: t("us.signedIn"),
      options: [
        { value: "false", label: t("us.signedInYes") },
        { value: "true", label: t("us.signedInNever") },
      ],
    },
    {
      type: "select",
      key: "is_active",
      label: t("ov.colStatus"),
      options: [
        { value: "true", label: t("us.active") },
        { value: "false", label: t("us.disabled") },
      ],
    },
  ];

  // debounce the search box; a new term restarts the guest paging
  useEffect(() => {
    const timer = setTimeout(() => setSq(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => setGuestOffset(0), [sq, adv]);

  // a role filter decides which of the two tables can have rows at all
  const onlyGuests = adv.role === "customer";
  const onlyStaff = !!adv.role && adv.role !== "customer";

  useEffect(() => {
    setErr("");
    if (onlyGuests) {
      setStaff([]);
      setStaffTotal(0);
      return;
    }
    setStaff(null);
    adminApi
      .users({ kind: "staff", q: sq || undefined, limit: 200 }, adv)
      .then((p) => {
        setStaff(p.items);
        setStaffTotal(p.total);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [sq, adv, onlyGuests, reload, t]);

  useEffect(() => {
    if (onlyStaff) {
      setGuests([]);
      setGuestTotal(0);
      return;
    }
    setGuests(null);
    const rest = { ...adv };
    delete rest.role; // guest logins all have the customer role
    adminApi
      .users({ kind: "guest", q: sq || undefined, limit: PAGE, offset: guestOffset }, rest)
      .then((p) => {
        setGuests(p.items);
        setGuestTotal(p.total);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [sq, guestOffset, adv, onlyStaff, reload, t]);

  const refresh = () => setReload((r) => r + 1);

  async function patch(u: UserRow, body: { role?: string; is_active?: boolean; unlock?: boolean }) {
    setBusy(u.user_id);
    setErr("");
    try {
      await adminApi.updateUser(u.user_id, body);
      toast.success(t("us.updatedToast", { name: u.username }));
      refresh();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("mt.updateFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  async function del(u: UserRow) {
    const ok = await confirm({
      title: t("us.deleteTitle", { name: u.username }),
      body: isCustomer(u) ? t("us.deleteBodyCustomer") : t("us.deleteBodyStaff"),
      confirmLabel: t("us.deleteConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(u.user_id);
    setErr("");
    try {
      await adminApi.deleteUser(u.user_id);
      toast.success(t("us.deletedToast", { name: u.username }));
      refresh();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("us.deleteFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  function StatusCell({ u }: { u: UserRow }) {
    return isLocked(u) ? (
      <span className="tag tag--warn">{t("us.locked")}</span>
    ) : u.is_active ? (
      <span className="tag tag--ok">{t("us.active")}</span>
    ) : (
      <span className="tag tag--danger">{t("us.disabled")}</span>
    );
  }

  function ActionCell({ u }: { u: UserRow }) {
    const isSelf = u.user_id === me?.user_id;
    return (
      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        {isLocked(u) && (
          <button
            className="btn btn--sm btn--gold"
            disabled={busy === u.user_id}
            onClick={() => patch(u, { unlock: true })}
          >
            {t("us.unlock")}
          </button>
        )}
        <button
          className="btn btn--sm btn--quiet"
          style={{ marginLeft: 6 }}
          disabled={busy === u.user_id || (isSelf && u.is_active)}
          title={isSelf && u.is_active ? t("us.cantDisableSelf") : undefined}
          onClick={() => patch(u, { is_active: !u.is_active })}
        >
          {u.is_active ? t("us.disable") : t("us.enable")}
        </button>
        {!isSelf && (
          <button
            className="btn btn--sm btn--danger"
            style={{ marginLeft: 6 }}
            disabled={busy === u.user_id}
            onClick={() => del(u)}
          >
            {t("us.delete")}
          </button>
        )}
      </td>
    );
  }

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("au.eyebrow")}</p>
          <h1>{t("us.title")}</h1>
        </div>
        <span className="row">
          <span className="muted">
            {t("us.staffGuestCount", { staff: staffTotal, guests: guestTotal.toLocaleString() })}
          </span>
          <button className="btn btn--sm btn--gold" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? t("common.close") : t("us.addEmployee")}
          </button>
        </span>
      </div>

      {showAdd && (
        <AddEmployeeForm
          onDone={(name) => {
            toast.success(t("us.createdToast", { name }));
            setShowAdd(false);
            refresh();
          }}
          onError={(m) => {
            setErr(m);
            toast.error(m);
          }}
        />
      )}

      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="field" style={{ maxWidth: 320, margin: 0 }}>
          <input
            type="search"
            aria-label={t("us.searchAria")}
            placeholder={t("us.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert onRetry={refresh}>{err}</Alert>}
      {!staff && !err && <TableSkeleton rows={5} cols={7} />}

      {staff && (
        <div className="panel">
          <div className="panel__head">{t("us.employees")}</div>
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("us.colUsername")}</th>
                  <th>{t("us.colEmail")}</th>
                  <th>{t("us.colRole")}</th>
                  <th>{t("us.colLinked")}</th>
                  <th>{t("us.colLastLogin")}</th>
                  <th>{t("ov.colStatus")}</th>
                  <th style={{ textAlign: "right" }}>{t("us.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => {
                  const isSelf = u.user_id === me?.user_id;
                  return (
                    <tr key={u.user_id}>
                      <td>
                        <strong>{u.username}</strong>
                        {isSelf && <span className="tiny"> · {t("us.you")}</span>}
                        {u.full_name && (
                          <>
                            <br />
                            <span className="tiny">{u.full_name}</span>
                          </>
                        )}
                      </td>
                      <td className="muted">
                        {u.email}
                        {u.phone && (
                          <>
                            <br />
                            <span className="tiny">{u.phone}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <select
                          className="minisel"
                          aria-label={t("us.roleForUser", { name: u.username })}
                          value={u.role}
                          disabled={busy === u.user_id || isSelf}
                          title={isSelf ? t("us.cantChangeOwnRole") : undefined}
                          onChange={(e) => patch(u, { role: e.target.value })}
                        >
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="tiny" style={{ whiteSpace: "nowrap" }}>
                        {u.staff_id ? t("us.staffLinked", { id: u.staff_id }) : "-"}
                        {u.hired_at && (
                          <>
                            <br />
                            {t("us.hiredOn", { date: fmtDate(u.hired_at, lang) })}
                          </>
                        )}
                      </td>
                      <td className="tiny">
                        {u.last_login_at ? fmtDate(u.last_login_at.slice(0, 10), lang) : t("us.never")}
                      </td>
                      <td>
                        <StatusCell u={u} />
                      </td>
                      <ActionCell u={u} />
                    </tr>
                  );
                })}
                {staff.length === 0 && (
                  <TableEmpty cols={7}>{t("us.noStaffMatch")}</TableEmpty>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!guests && !err && (
        <div style={{ marginTop: 20 }}>
          <TableSkeleton rows={8} cols={6} />
        </div>
      )}

      {guests && (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel__head">{t("us.guestAccounts")}</div>
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("us.colUsername")}</th>
                  <th>{t("us.colEmail")}</th>
                  <th>{t("us.colLinked")}</th>
                  <th>{t("us.colLastLogin")}</th>
                  <th>{t("ov.colStatus")}</th>
                  <th style={{ textAlign: "right" }}>{t("us.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((u) => (
                  <tr key={u.user_id}>
                    <td>
                      <strong>{u.username}</strong>
                      {u.full_name && (
                        <>
                          <br />
                          <span className="tiny">{u.full_name}</span>
                        </>
                      )}
                    </td>
                    <td className="muted">
                      {u.email}
                      {u.phone && (
                        <>
                          <br />
                          <span className="tiny">{u.phone}</span>
                        </>
                      )}
                    </td>
                    <td className="tiny" style={{ whiteSpace: "nowrap" }}>
                      {u.customer_id ? (
                        <Link to={`/admin/guests/${u.customer_id}`}>
                          {t("us.customerLinked", { id: u.customer_id })}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="tiny">
                      {u.last_login_at ? fmtDate(u.last_login_at.slice(0, 10), lang) : t("us.never")}
                    </td>
                    <td>
                      <StatusCell u={u} />
                    </td>
                    <ActionCell u={u} />
                  </tr>
                ))}
                {guests.length === 0 && (
                  <TableEmpty cols={6}>{t("us.noGuestMatch")}</TableEmpty>
                )}
              </tbody>
            </table>
          </div>
          <Pager
            offset={guestOffset}
            limit={PAGE}
            total={guestTotal}
            onOffset={setGuestOffset}
          />
        </div>
      )}
    </>
  );
}

function AddEmployeeForm({
  onDone,
  onError,
}: {
  onDone: (name: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useT();
  const roleLabel = (r: string) => t(ROLE_KEY[r] ?? r);
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    username: "",
    email: "",
    phone: "",
    password: "",
    role: "receptionist",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const usernameOk = /^[A-Za-z0-9_.-]{3,50}$/.test(f.username);
  const valid =
    !!f.first_name.trim() &&
    !!f.last_name.trim() &&
    usernameOk &&
    /.+@.+\..+/.test(f.email) &&
    f.password.length >= 10;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await adminApi.createEmployee({
        username: f.username.trim(),
        password: f.password,
        email: f.email.trim(),
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        phone: f.phone.trim() || undefined,
        role: f.role,
      });
      onDone(`${f.first_name.trim()} ${f.last_name.trim()}`);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("us.couldNotCreate"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" style={{ marginBottom: 20 }} onSubmit={submit}>
      <div className="panel__head">{t("us.newEmployeeTitle")}</div>
      <div style={{ padding: 20 }} className="stack stack--tight">
        <div className="grid grid-3" style={{ gap: 14 }}>
          <Field label={t("us.firstName")} value={f.first_name} onChange={set("first_name")} required />
          <Field label={t("us.lastName")} value={f.last_name} onChange={set("last_name")} required />
          <label className="field">
            <span>{t("us.colRole")}</span>
            <select value={f.role} onChange={set("role")}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-3" style={{ gap: 14 }}>
          <Field
            label={t("us.colUsername")}
            hint={t("us.usernameHint")}
            value={f.username}
            onChange={set("username")}
            required
          />
          <Field label={t("us.colEmail")} type="email" value={f.email} onChange={set("email")} required />
          <Field label={t("us.phoneOptional")} value={f.phone} onChange={set("phone")} />
        </div>
        <Field
          label={t("us.tempPassword")}
          type="password"
          hint={t("us.tempPasswordHint")}
          value={f.password}
          onChange={set("password")}
          minLength={10}
          required
        />
        <div>
          <button className="btn btn--sm btn--gold" disabled={busy || !valid}>
            {busy ? <Spinner /> : t("us.createAccount")}
          </button>
        </div>
      </div>
    </form>
  );
}
