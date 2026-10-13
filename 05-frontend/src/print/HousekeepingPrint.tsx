import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { housekeeping, ApiError } from "../lib/api";
import type { HousekeepingBoardRow } from "../lib/types";
import { Alert, Spinner } from "../components/ui";
import { bookingRef, fmtDate } from "../lib/format";
import { todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";
import { PrintDoc } from "./PrintDoc";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The housekeeping daily sheet - every task scheduled for one day, floor by
 *  floor, with a sign-off column. Reads `v_housekeeping_board`.
 *  Route: /print/housekeeping/:day */
export function HousekeepingPrint() {
  const { day: param } = useParams();
  const day = param && ISO_DAY.test(param) ? param : todayISO();
  const nav = useNavigate();
  const { t, lang } = useT();
  const [rows, setRows] = useState<HousekeepingBoardRow[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setRows(null);
    setErr("");
    housekeeping
      .board(day)
      .then(setRows)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [day, t]);

  if (err) {
    return (
      <div className="printpage">
        <Alert>{err}</Alert>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="printpage">
        <Spinner />
      </div>
    );
  }

  const floors = [...new Set(rows.map((r) => r.floor))].sort((a, b) => a - b);
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <PrintDoc
      docTitle={t("hkp.title")}
      backTo="/admin/housekeeping"
      meta={[
        { label: t("hkp.date"), value: fmtDate(day, lang) },
        { label: t("hkp.tasks"), value: String(rows.length) },
        {
          label: t("hkp.progress"),
          value: t("hkp.progressValue", {
            pending: count("pending"),
            active: count("in_progress"),
            done: count("done"),
          }),
        },
        { label: t("hkp.floors"), value: floors.length ? floors.join(", ") : "-" },
      ]}
    >
      <div className="no-print printpick">
        <label>
          {t("hkp.pickDay")}{" "}
          <input
            type="date"
            value={day}
            onChange={(e) =>
              ISO_DAY.test(e.target.value) && nav(`/print/housekeeping/${e.target.value}`)
            }
          />
        </label>
      </div>

      <table className="printtable">
        <thead>
          <tr>
            <th>{t("hkp.colRoom")}</th>
            <th>{t("hkp.colTask")}</th>
            <th>{t("hkp.colRoomStatus")}</th>
            <th>{t("hkp.colAssigned")}</th>
            <th>{t("hkp.colNote")}</th>
            <th className="num">{t("hkp.colDone")}</th>
          </tr>
        </thead>
        <tbody>
          {floors.map((f) => (
            <FloorRows
              key={f}
              floor={f}
              rows={rows.filter((r) => r.floor === f)}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "#888" }}>
                {t("hkp.none")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="printdoc__note">{t("hkp.signOff")}</p>
    </PrintDoc>
  );
}

function FloorRows({ floor, rows }: { floor: number; rows: HousekeepingBoardRow[] }) {
  const { t } = useT();
  return (
    <>
      <tr className="printtable__group">
        <td colSpan={6}>{t("ra.floorLabel", { n: floor })}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.task_id}>
          <td>
            <strong>{r.room_number}</strong>
            <br />
            <span style={{ color: "#666" }}>{r.room_type}</span>
          </td>
          <td>
            {t(`taskType.${r.task_type}`)}
            <br />
            <span style={{ color: "#666" }}>{t(`hkStatus.${r.status}`)}</span>
          </td>
          <td>{t(`roomStatus.${r.room_status}`)}</td>
          <td>{r.assigned_to_name ?? "-"}</td>
          <td>
            {r.note ?? ""}
            {r.booking_id ? (
              <span style={{ color: "#666" }}>
                {r.note ? " · " : ""}
                {bookingRef(r.booking_id)}
              </span>
            ) : null}
          </td>
          <td className="num">
            <span className="printcheck" aria-hidden>
              {r.status === "done" ? "✓" : ""}
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}
