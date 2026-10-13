import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { bookings, ApiError } from "../lib/api";
import type { Bill, Booking } from "../lib/types";
import { Alert, Spinner } from "../components/ui";
import { baht, bookingRef, fmtStay, statusLabel } from "../lib/format";
import { PrintDoc } from "./PrintDoc";

/** Full-page guest folio (the itemised stay bill), printable / saveable as PDF.
 *  Route: /print/folio/:id */
export function FolioPrint() {
  const { id } = useParams();
  const [bk, setBk] = useState<Booking | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const n = Number(id);
    Promise.all([bookings.get(n), bookings.bill(n)])
      .then(([b, bl]) => {
        setBk(b);
        setBill(bl);
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Could not load folio"));
  }, [id]);

  if (err) {
    return (
      <div className="printpage">
        <Alert>{err}</Alert>
      </div>
    );
  }
  if (!bk || !bill) {
    return (
      <div className="printpage">
        <Spinner />
      </div>
    );
  }

  const lines = [
    ...bk.rooms.map((r) => ({
      desc: `${r.room_type} (Room ${r.room_number})`,
      qty: `${bill.nights} night${bill.nights > 1 ? "s" : ""}`,
      unit: r.price_per_night,
      amount: Number(r.price_per_night) * bill.nights,
    })),
    ...bk.services.map((s) => ({
      desc: s.service_name,
      qty: `x${s.quantity}`,
      unit: s.unit_price,
      amount: Number(s.unit_price) * s.quantity,
    })),
  ];

  const netPaid = Number(bill.paid_total) - Number(bill.refunded_total);

  return (
    <PrintDoc
      docTitle="Guest Folio"
      backTo={`/admin/bookings/${bk.booking_id}`}
      meta={[
        { label: "Guest", value: bk.customer_name },
        { label: "Booking", value: bookingRef(bk.booking_id) },
        { label: "Room(s)", value: bk.rooms.map((r) => r.room_number).join(", ") || "-" },
        { label: "Stay", value: fmtStay(bk.check_in_date, bk.check_out_date) },
        { label: "Nights", value: String(bill.nights) },
        { label: "Status", value: statusLabel(bk.status) },
      ]}
    >
      <table className="printtable">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.desc}</td>
              <td className="num">{l.qty}</td>
              <td className="num">{baht(l.unit, true)}</td>
              <td className="num">{baht(l.amount, true)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#888" }}>
                Nothing charged to this booking.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <table className="printtotals">
        <tbody>
          <tr>
            <td>Room charges</td>
            <td className="num">{baht(bill.room_total, true)}</td>
          </tr>
          <tr>
            <td>Services</td>
            <td className="num">{baht(bill.service_total, true)}</td>
          </tr>
          <tr className="grand">
            <td>Total</td>
            <td className="num">{baht(bill.grand_total, true)}</td>
          </tr>
          <tr className="rule">
            <td>Paid</td>
            <td className="num">{baht(netPaid, true)}</td>
          </tr>
          {Number(bill.refunded_total) > 0.004 && (
            <tr>
              <td>of which refunded</td>
              <td className="num">{baht(bill.refunded_total, true)}</td>
            </tr>
          )}
          <tr>
            <td>Balance due</td>
            <td className="num">{baht(bill.balance_due, true)}</td>
          </tr>
        </tbody>
      </table>

      {bk.payments.length > 0 && (
        <table className="printtable" style={{ marginTop: 22 }}>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Date</th>
              <th>Reference</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bk.payments.map((p) => (
              <tr key={p.payment_id}>
                <td>
                  {statusLabel(p.method)} · {statusLabel(p.status)}
                </td>
                <td>{p.paid_at ? p.paid_at.slice(0, 10) : "-"}</td>
                <td>{p.reference_no ?? "-"}</td>
                <td className="num">
                  {p.status === "refunded" ? "- " : ""}
                  {baht(p.amount, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {bk.note && <p className="printdoc__note">Guest requests: {bk.note}</p>}
      <p className="printdoc__note">
        This folio is a summary of charges for your stay. A tax invoice is available on request.
      </p>
    </PrintDoc>
  );
}
