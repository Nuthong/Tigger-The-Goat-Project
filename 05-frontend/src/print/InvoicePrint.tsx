import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { bookings, invoices, ApiError } from "../lib/api";
import type { Booking, Invoice } from "../lib/types";
import { Alert, Spinner } from "../components/ui";
import { baht, bookingRef, fmtDate, fmtStay } from "../lib/format";
import { PrintDoc } from "./PrintDoc";

/** Full-page tax invoice, printable / saveable as PDF. Route: /print/invoice/:id */
export function InvoicePrint() {
  const { id } = useParams();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [bk, setBk] = useState<Booking | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const n = Number(id);
    invoices
      .get(n)
      .then(async (i) => {
        setInv(i);
        setBk(await bookings.get(i.booking_id));
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load invoice"));
  }, [id]);

  if (err) {
    return (
      <div className="printpage">
        <Alert>{err}</Alert>
      </div>
    );
  }
  if (!inv || !bk) {
    return (
      <div className="printpage">
        <Spinner />
      </div>
    );
  }

  const vatPct = `${(Number(inv.tax_rate) * 100).toFixed(0)}%`;
  const paid = Number(bk.amount_paid) - Number(bk.amount_refunded);
  const balance = Number(inv.total) - paid;

  return (
    <PrintDoc
      docTitle="Tax Invoice / ใบกำกับภาษี"
      backTo="/admin/invoices"
      watermark
      meta={[
        { label: "Bill to", value: bk.customer_name },
        { label: "Invoice no", value: inv.invoice_no },
        { label: "Issue date", value: fmtDate(inv.issued_at.slice(0, 10)) },
        { label: "Booking", value: bookingRef(inv.booking_id) },
        { label: "Stay", value: fmtStay(bk.check_in_date, bk.check_out_date) },
        {
          label: "Issued by",
          value: inv.issued_by_name ? `${inv.issued_by_name} · VAT ${vatPct}` : `VAT ${vatPct}`,
        },
      ]}
    >
      <table className="printtable">
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {/* a ฿0 discount changes nothing - leave it off the printed invoice */}
          {inv.lines
            .filter((l) => !(l.line_type === "discount" && Number(l.amount) === 0))
            .map((l) => (
              <tr key={l.line_no}>
                <td>{l.line_no}</td>
                <td>{l.description}</td>
                <td className="num">{Number(l.quantity)}</td>
                <td className="num">{baht(l.unit_price, true)}</td>
                <td className="num">{baht(l.amount, true)}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <table className="printtotals">
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td className="num">{baht(inv.subtotal, true)}</td>
          </tr>
          <tr>
            <td>VAT {vatPct}</td>
            <td className="num">{baht(inv.tax_amount, true)}</td>
          </tr>
          <tr className="grand">
            <td>Total</td>
            <td className="num">{baht(inv.total, true)}</td>
          </tr>
          <tr className="rule">
            <td>Paid</td>
            <td className="num">{baht(paid, true)}</td>
          </tr>
          <tr>
            <td>Balance due</td>
            <td className="num">{baht(balance, true)}</td>
          </tr>
        </tbody>
      </table>

      {inv.status === "void" && (
        <p className="printdoc__note">
          <strong>VOID</strong> - this invoice has been cancelled and is not valid for payment.
        </p>
      )}
      {inv.note && <p className="printdoc__note">{inv.note}</p>}
      <p className="printdoc__note">
        Prices are in Thai Baht and inclusive of {vatPct} VAT where applicable.
      </p>
    </PrintDoc>
  );
}
