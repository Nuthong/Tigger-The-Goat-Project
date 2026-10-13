import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { invoices as api, ApiError } from "../lib/api";
import type { Invoice, InvoiceLedgerStats, InvoiceRow, InvoiceStatus } from "../lib/types";
import { Alert, ChipBar, Pager, TableEmpty, TableSkeleton } from "../components/ui";
import { Modal } from "../components/Modal";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { baht, bookingRef, fmtDate } from "../lib/format";
import { useT } from "../i18n/I18n";
import { DailyRevenue } from "./DailyRevenue";

const FILTERS = ["all", "issued", "paid", "void", "draft"] as const;
type Filter = (typeof FILTERS)[number];
const PAGE = 50;

const TONE: Record<InvoiceStatus, string> = {
  draft: "",
  issued: "tag--info",
  paid: "tag--ok",
  void: "tag--danger",
};

const INVOICE_STATUS_KEY: Record<string, string> = {
  draft: "invoiceStatus.draft",
  issued: "invoiceStatus.issued",
  paid: "invoiceStatus.paid",
  void: "invoiceStatus.void",
};

export function Invoices() {
  const { t, lang } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<InvoiceLedgerStats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [adv, setAdv] = useState<Record<string, string>>({});

  const invoiceStatusLabel = (s: string) => t(INVOICE_STATUS_KEY[s] ?? s);

  // one filter per column (status has the chip bar)
  const advFields: FilterField[] = [
    { type: "text", key: "invoice_no", label: t("inv.colInvoice"), placeholder: "INV-2026-00004" },
    { type: "text", key: "booking_ref", label: t("rv.colBooking"), placeholder: "TIG-00042" },
    { type: "text", key: "guest", label: t("ba.colGuest") },
    { type: "date-range", label: t("inv.colIssued"), from: "issued_from", to: "issued_to" },
    {
      type: "number-range",
      label: t("inv.colTotal"),
      from: "min_total",
      to: "max_total",
      min: 0,
      prefix: "฿",
    },
    {
      type: "select",
      key: "balance",
      label: t("inv.colBalance"),
      options: [
        { value: "outstanding", label: t("filter.outstanding") },
        { value: "settled", label: t("filter.settled") },
      ],
    },
  ];

  // a new filter or search term starts again from the first page
  useEffect(() => setOffset(0), [filter, q, adv]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setRows(null);
      setErr("");
      api
        .list(
          {
            status: filter === "all" ? undefined : filter,
            q: q.trim() || undefined,
            limit: PAGE,
            offset,
          },
          adv,
        )
        .then((p) => {
          setTotal(p.total);
          setRows(p.items);
        })
        .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
    }, 250);
    return () => clearTimeout(timer);
  }, [filter, q, offset, adv, reloadKey, t]);

  // the header figures are whole-ledger, independent of the page or filter
  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [reloadKey]);

  async function view(id: number) {
    try {
      setOpen(await api.get(id));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("inv.couldNotOpen"));
    }
  }

  async function voidInvoice(inv: Invoice) {
    const ok = await confirm({
      title: t("inv.voidTitle", { no: inv.invoice_no }),
      body: inv.status === "paid" ? t("inv.voidBodyPaid") : t("inv.voidBodyDefault"),
      confirmLabel: t("inv.voidInvoice"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(inv.invoice_id);
    setErr("");
    try {
      await api.void(inv.invoice_id);
      toast.success(t("inv.voidedToast", { no: inv.invoice_no }));
      setOpen(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("inv.voidFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  const outstanding = stats ? Number(stats.outstanding) : null;

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("inv.eyebrow")}</p>
          <h1>{t("inv.title")}</h1>
        </div>
        <span className="muted">
          {outstanding != null
            ? t("inv.outstanding", { amount: baht(outstanding) })
            : t("inv.totalCount", { n: total.toLocaleString() })}
        </span>
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <ChipBar
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label={(f) => (f === "all" ? t("status.all") : invoiceStatusLabel(f))}
        />
        <div className="field" style={{ maxWidth: 260, margin: 0 }}>
          <input
            type="search"
            aria-label={t("inv.searchAria")}
            placeholder={t("inv.searchPlaceholder")}
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

      {err && <Alert onRetry={() => setReloadKey((k) => k + 1)}>{err}</Alert>}
      {!rows && !err && <TableSkeleton rows={8} cols={7} />}

      {rows && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("inv.colInvoice")}</th>
                  <th>{t("rv.colBooking")}</th>
                  <th>{t("ba.colGuest")}</th>
                  <th>{t("inv.colIssued")}</th>
                  <th>{t("ov.colStatus")}</th>
                  <th style={{ textAlign: "right" }}>{t("inv.colTotal")}</th>
                  <th style={{ textAlign: "right" }}>{t("inv.colBalance")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.invoice_id}
                    style={{ cursor: "pointer" }}
                    onClick={() => view(r.invoice_id)}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>{r.invoice_no}</td>
                    <td>
                      <Link
                        to={`/admin/bookings/${r.booking_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {bookingRef(r.booking_id)}
                      </Link>
                    </td>
                    <td>{r.customer_name}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.issued_at.slice(0, 10), lang)}</td>
                    <td>
                      <span className={`tag ${TONE[r.status]}`}>{invoiceStatusLabel(r.status)}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>{baht(r.total, true)}</td>
                    <td style={{ textAlign: "right" }}>{baht(r.balance_due, true)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <TableEmpty cols={7}>
                    {q.trim()
                      ? t("inv.noneMatchQuery", { q: q.trim() })
                      : filter === "all"
                        ? t("inv.noneAtAll")
                        : t("inv.noneWithStatus", { status: filter })}
                  </TableEmpty>
                )}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} limit={PAGE} total={total} onOffset={setOffset} />
        </div>
      )}

      <DailyRevenue />

      {open && (
        <Modal onClose={() => setOpen(null)} maxWidth={560} labelledBy="invdlg-title">
          <div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <p className="eyebrow">{open.invoice_no}</p>
                <h3 id="invdlg-title">{bookingRef(open.booking_id)}</h3>
              </div>
              <span className={`tag ${TONE[open.status]}`}>{invoiceStatusLabel(open.status)}</span>
            </div>
            <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
              {open.issued_by_name
                ? t("inv.issuedOnBy", {
                    date: fmtDate(open.issued_at.slice(0, 10), lang),
                    name: open.issued_by_name,
                    pct: (Number(open.tax_rate) * 100).toFixed(0),
                  })
                : t("inv.issuedOn", {
                    date: fmtDate(open.issued_at.slice(0, 10), lang),
                    pct: (Number(open.tax_rate) * 100).toFixed(0),
                  })}
            </p>

            <table className="table" style={{ marginTop: 14 }}>
              <tbody>
                {open.lines.map((l) => (
                  <tr key={l.line_no}>
                    <td>
                      {l.description}
                      {Number(l.quantity) !== 1 ? (
                        <span className="tiny"> · ×{Number(l.quantity)}</span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {baht(l.amount, true)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="muted">{t("inv.subtotal")}</td>
                  <td className="muted" style={{ textAlign: "right" }}>{baht(open.subtotal, true)}</td>
                </tr>
                <tr>
                  <td className="muted">{t("inv.vat")}</td>
                  <td className="muted" style={{ textAlign: "right" }}>{baht(open.tax_amount, true)}</td>
                </tr>
                <tr>
                  <td><strong>{t("inv.colTotal")}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{baht(open.total, true)}</strong></td>
                </tr>
              </tbody>
            </table>

            {open.note && <p className="tiny" style={{ marginTop: 10 }}>{open.note}</p>}

            <div className="row" style={{ marginTop: 18 }}>
              <button
                className="btn btn--sm btn--gold"
                onClick={() => navigate(`/print/invoice/${open.invoice_id}`)}
              >
                {t("inv.print")}
              </button>
              {open.status !== "void" && (
                <button
                  className="btn btn--sm btn--danger"
                  disabled={busy === open.invoice_id}
                  onClick={() => voidInvoice(open)}
                >
                  {t("inv.voidInvoice")}
                </button>
              )}
              <button className="btn btn--sm btn--quiet" onClick={() => setOpen(null)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
