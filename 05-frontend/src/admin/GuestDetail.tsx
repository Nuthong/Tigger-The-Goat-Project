import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { customers, ApiError } from "../lib/api";
import type { CustomerDetail } from "../lib/types";
import { Alert, Field, Spinner, StatusTag, TableEmpty, TierBadge } from "../components/ui";
import { Modal } from "../components/Modal";
import { useToast } from "../components/ToastProvider";
import { baht, bookingRef, fmtDate, fmtStay } from "../lib/format";
import { tierFor } from "../lib/loyalty";
import { useT } from "../i18n/I18n";

export function GuestDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const { t, lang } = useT();
  const [g, setG] = useState<CustomerDetail | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!Number.isFinite(cid)) return;
    setG(null);
    setErr("");
    customers
      .get(cid)
      .then(setG)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [cid, t]);

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">
            <Link to="/admin/guests" className="link-arrow">
              ‹ {t("gd.backToGuests")}
            </Link>
          </p>
          <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1>{g ? `${g.first_name} ${g.last_name}` : t("gd.guestFallback")}</h1>
            {g && <TierBadge tier={tierFor(g.nights).name} />}
          </span>
          {g && (
            <p className="muted" style={{ marginTop: 6 }}>
              {t("gd.guestHash", { id: g.customer_id })} ·{" "}
              {t("gd.memberSince", { date: fmtDate(g.created_at.slice(0, 10), lang) })} ·{" "}
              {g.has_login ? t("gd.hasSignIn") : t("gd.noSignInYet")}
            </p>
          )}
        </div>
        {g && (
          <button className="btn btn--sm btn--quiet" onClick={() => setEditing(true)}>
            {t("gd.editProfile")}
          </button>
        )}
      </div>

      {err && <Alert>{err}</Alert>}
      {!g && !err && <Spinner />}

      {g && (
        <>
          <div className="kpi">
            <div className="kpi__card">
              <div className="kpi__label">{t("gd.trips")}</div>
              <div className="kpi__value">{g.trips}</div>
              <div className="kpi__sub">{t("gd.tripsSub")}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("gd.nightsStayed")}</div>
              <div className="kpi__value">{g.nights}</div>
              <div className="kpi__sub">{t("gd.nightsStayedSub")}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("ga.colLifetimeValue")}</div>
              <div className="kpi__value">{baht(g.lifetime_value)}</div>
              <div className="kpi__sub">{t("gd.lifetimeValueSub")}</div>
            </div>
            <div className="kpi__card">
              <div className="kpi__label">{t("gd.upcoming")}</div>
              <div className="kpi__value">{g.upcoming}</div>
              <div className="kpi__sub">{t("gd.upcomingSub")}</div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 20 }}>
            <div className="panel">
              <div className="panel__head">{t("gd.contact")}</div>
              <table className="dtable">
                <tbody>
                  <tr>
                    <td className="muted">{t("ga.colEmail")}</td>
                    <td style={{ textAlign: "right" }}>{g.email}</td>
                  </tr>
                  <tr>
                    <td className="muted">{t("ga.colPhone")}</td>
                    <td style={{ textAlign: "right" }}>{g.phone ?? "-"}</td>
                  </tr>
                  <tr>
                    <td className="muted">{t("gd.idCard")}</td>
                    <td style={{ textAlign: "right" }}>
                      {g.id_card_no ? (
                        <span style={{ fontFamily: "ui-monospace, monospace" }}>{g.id_card_no}</span>
                      ) : (
                        <span className="tag tag--warn">{t("gd.idMissing")}</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">{t("gd.firstStay")}</td>
                    <td style={{ textAlign: "right" }}>
                      {g.first_stay ? fmtDate(g.first_stay, lang) : "-"}
                    </td>
                  </tr>
                  <tr>
                    <td className="muted">{t("gd.latestStay")}</td>
                    <td style={{ textAlign: "right" }}>
                      {g.last_stay ? fmtDate(g.last_stay, lang) : "-"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="panel">
              <div className="panel__head">{t("gd.standingRequests")}</div>
              <div style={{ padding: 16 }}>
                {g.recent_bookings.some((b) => b.note) ? (
                  <ul className="stack stack--tight" style={{ listStyle: "none", padding: 0 }}>
                    {g.recent_bookings
                      .filter((b) => b.note)
                      .slice(0, 4)
                      .map((b) => (
                        <li key={b.booking_id} style={{ fontSize: 14 }}>
                          <span className="tiny muted">{bookingRef(b.booking_id)}</span>
                          <br />
                          {b.note}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="muted" style={{ fontSize: 14 }}>
                    {t("gd.noSpecialRequests")}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel__head">{t("gd.bookingHistory")}</div>
            <div className="table-wrap">
              <table className="dtable">
                <thead>
                  <tr>
                    <th>{t("ba.colRef")}</th>
                    <th>{t("ba.colStay")}</th>
                    <th>{t("ba.colRoom")}</th>
                    <th>{t("ov.colStatus")}</th>
                    <th style={{ textAlign: "right" }}>{t("gd.colAmount")}</th>
                    <th style={{ textAlign: "right" }}>{t("gd.colBalance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.recent_bookings.map((b) => (
                    <tr key={b.booking_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link to={`/admin/bookings/${b.booking_id}`}>
                          {bookingRef(b.booking_id)}
                        </Link>
                        {b.note && (
                          <span
                            className="reqflag"
                            title={t("ba.guestRequests", { note: b.note })}
                          >
                            {" "}
                            ✎
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {fmtStay(b.check_in_date, b.check_out_date, lang)}
                      </td>
                      <td>{b.room_types || <span className="muted">-</span>}</td>
                      <td>
                        <StatusTag status={b.status} />
                      </td>
                      <td style={{ textAlign: "right" }}>{baht(b.grand_total)}</td>
                      <td style={{ textAlign: "right" }}>
                        {Number(b.balance_due) > 0.004 ? (
                          <span className="tag tag--warn">{baht(b.balance_due)}</span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {g.recent_bookings.length === 0 && (
                    <TableEmpty cols={6}>{t("ba.noBookingsYet")}</TableEmpty>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {g && editing && (
        <Modal onClose={() => setEditing(false)} maxWidth={460} labelledBy="gddlg-title">
          <h3 id="gddlg-title">{t("gd.editProfile")}</h3>
          <ProfileForm
            guest={g}
            onCancel={() => setEditing(false)}
            onSaved={(updated) => {
              setG(updated);
              setEditing(false);
              toast.success(t("gd.profileSaved"));
            }}
            onError={(m) => toast.error(m)}
          />
        </Modal>
      )}
    </>
  );
}

const PHONE_RE = /^[0-9+\-() ]*$/;
const ID_RE = /^[A-Za-z0-9 -]*$/;

function ProfileForm({
  guest,
  onSaved,
  onError,
  onCancel,
}: {
  guest: CustomerDetail;
  onSaved: (g: CustomerDetail) => void;
  onError: (m: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [first, setFirst] = useState(guest.first_name);
  const [last, setLast] = useState(guest.last_name);
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [idNo, setIdNo] = useState(guest.id_card_no ?? "");
  const [busy, setBusy] = useState(false);
  const phoneOk = PHONE_RE.test(phone) && phone.length <= 20;
  const idOk = ID_RE.test(idNo) && idNo.length <= 30;
  const valid = first.trim().length > 0 && last.trim().length > 0 && phoneOk && idOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const updated = await customers.update(guest.customer_id, {
        first_name: first.trim(),
        last_name: last.trim(),
        phone: phone.trim() || null,
        id_card_no: idNo.trim() || null,
      });
      onSaved(updated);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t("sv.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--tight" style={{ marginTop: 16 }} onSubmit={submit}>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <Field
          label={t("gd.firstName")}
          value={first}
          maxLength={60}
          required
          onChange={(e) => setFirst(e.target.value)}
        />
        <Field
          label={t("gd.lastName")}
          value={last}
          maxLength={60}
          required
          onChange={(e) => setLast(e.target.value)}
        />
      </div>
      <Field
        label={t("ga.colPhone")}
        value={phone}
        maxLength={20}
        inputMode="tel"
        onChange={(e) => setPhone(e.target.value)}
        hint={phoneOk ? undefined : t("gd.phoneInvalid")}
      />
      <Field
        label={t("gd.idCard")}
        value={idNo}
        maxLength={30}
        onChange={(e) => setIdNo(e.target.value)}
        hint={idOk ? t("gd.idHint") : t("gd.idInvalid")}
      />
      <p className="tiny">{t("gd.emailFixed", { email: guest.email })}</p>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn btn--sm btn--quiet" onClick={onCancel}>
          {t("account.cancelBtn")}
        </button>
        <button className="btn btn--sm btn--gold" disabled={busy || !valid}>
          {busy ? <Spinner /> : t("sv.save")}
        </button>
      </div>
    </form>
  );
}
