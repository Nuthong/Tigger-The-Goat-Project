import { useCallback, useEffect, useState } from "react";
import { catalog, maintenance, ApiError } from "../lib/api";
import type {
  MaintenanceBacklogRow,
  MaintenanceTicket,
  Room,
  TicketPriority,
} from "../lib/types";
import { Alert, ChipBar, Field, Spinner, TableEmpty, TableSkeleton } from "../components/ui";
import { AGE_BUCKETS, summariseBacklog, type AgeBucket } from "../lib/backlog";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { textHas, withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { usePrompt } from "../components/ConfirmDialog";
import { fmtDate } from "../lib/format";
import { useT } from "../i18n/I18n";

const FILTERS = ["open", "in_progress", "resolved", "closed", "all"] as const;
type Filter = (typeof FILTERS)[number];

const CATEGORIES = ["plumbing", "electrical", "hvac", "furniture", "appliance", "other"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];

const PRIORITY_TONE: Record<TicketPriority, string> = {
  urgent: "tag--danger",
  high: "tag--warn",
  normal: "tag--info",
  low: "",
};

const TICKET_STATUS_KEY: Record<string, string> = {
  open: "ticketStatus.open",
  in_progress: "ticketStatus.in_progress",
  resolved: "ticketStatus.resolved",
  closed: "ticketStatus.closed",
  cancelled: "ticketStatus.cancelled",
};

const TICKET_PRIORITY_KEY: Record<string, string> = {
  low: "ticketPriority.low",
  normal: "ticketPriority.normal",
  high: "ticketPriority.high",
  urgent: "ticketPriority.urgent",
};

const TICKET_CATEGORY_KEY: Record<string, string> = {
  plumbing: "ticketCategory.plumbing",
  electrical: "ticketCategory.electrical",
  hvac: "ticketCategory.hvac",
  furniture: "ticketCategory.furniture",
  appliance: "ticketCategory.appliance",
  other: "ticketCategory.other",
};

const BUCKET_COLOR: Record<AgeBucket, string> = {
  today: "var(--p-ok)",
  week: "var(--p-gold)",
  month: "var(--p-warn)",
  older: "var(--p-danger)",
};

/** The open-ticket backlog from `v_maintenance_open`: how much is waiting,
 *  how urgent, and for how long. */
function BacklogStrip({ rows }: { rows: MaintenanceBacklogRow[] }) {
  const { t } = useT();
  const s = summariseBacklog(rows);
  const oldest = rows.reduce<MaintenanceBacklogRow | null>(
    (o, r) => (!o || r.age_days > o.age_days ? r : o),
    null,
  );
  return (
    <div className="kpi">
      <div className="kpi__card">
        <div className="kpi__label">{t("mt.blOpen")}</div>
        <div className="kpi__value">{s.open}</div>
        <div className="kpi__sub">{t("mt.blOpenSub", { d: s.avgDays })}</div>
      </div>
      <div className="kpi__card">
        <div className="kpi__label">{t("mt.blUrgent")}</div>
        <div className="kpi__value" style={s.urgent ? { color: "var(--p-danger)" } : undefined}>
          {s.urgent}
        </div>
        <div className="kpi__sub">{t("mt.blUnassigned", { n: s.unassigned })}</div>
      </div>
      <div className="kpi__card">
        <div className="kpi__label">{t("mt.blOldest")}</div>
        <div className="kpi__value">{t("mt.blDays", { n: s.oldestDays })}</div>
        <div className="kpi__sub" title={oldest?.title}>
          {oldest ? `#${oldest.ticket_id} · ${oldest.title}` : "-"}
        </div>
      </div>
      <div className="kpi__card">
        <div className="kpi__label">{t("mt.blAge")}</div>
        <div
          role="img"
          aria-label={AGE_BUCKETS.map((b) => `${t(`mt.bl.${b}`)} ${s.buckets[b]}`).join(", ")}
          style={{
            display: "flex",
            height: 10,
            borderRadius: 5,
            overflow: "hidden",
            margin: "12px 0 10px",
            background: "var(--p-line)",
          }}
        >
          {s.open > 0 &&
            AGE_BUCKETS.map((b) =>
              s.buckets[b] > 0 ? (
                <span
                  key={b}
                  style={{ width: `${(s.buckets[b] / s.open) * 100}%`, background: BUCKET_COLOR[b] }}
                />
              ) : null,
            )}
        </div>
        <div className="kpi__sub" style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
          {AGE_BUCKETS.map((b) => (
            <span key={b} style={{ whiteSpace: "nowrap" }}>
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: 2,
                  background: BUCKET_COLOR[b],
                  marginRight: 4,
                }}
              />
              {t(`mt.bl.${b}`)} {s.buckets[b]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Maintenance() {
  const { t, lang } = useT();
  const toast = useToast();
  const prompt = usePrompt();
  const [tickets, setTickets] = useState<MaintenanceTicket[] | null>(null);
  const [backlog, setBacklog] = useState<MaintenanceBacklogRow[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [adv, setAdv] = useState<Record<string, string>>({});

  const ticketStatusLabel = (s: string) => t(TICKET_STATUS_KEY[s] ?? s);
  const ticketPriorityLabel = (p: string) => t(TICKET_PRIORITY_KEY[p] ?? p);
  const ticketCategoryLabel = (c: string) => t(TICKET_CATEGORY_KEY[c] ?? c);

  // one filter per column (the status has the chip bar); the API narrows by
  // category / priority / room / date, the text columns are matched here
  const advFields: FilterField[] = [
    {
      type: "select",
      key: "priority",
      label: t("mt.colPriority"),
      options: PRIORITIES.map((p) => ({ value: p, label: ticketPriorityLabel(p) })),
    },
    { type: "text", key: "fault", label: t("mt.colFault") },
    {
      type: "select",
      key: "category",
      label: t("mt.category"),
      options: CATEGORIES.map((c) => ({ value: c, label: ticketCategoryLabel(c) })),
    },
    {
      type: "select",
      key: "room_id",
      label: t("mt.colRoom"),
      options: [...rooms]
        .sort((a, b) => a.room_number.localeCompare(b.room_number))
        .map((r) => ({ value: String(r.room_id), label: r.room_number })),
    },
    { type: "date-range", label: t("mt.colReported"), from: "date_from", to: "date_to" },
    { type: "text", key: "reported_by", label: t("mt.reportedBy") },
  ];

  const load = useCallback(() => {
    setTickets(null);
    setErr("");
    maintenance
      .tickets({
        ...(filter === "all" ? {} : { status: filter }),
        category: adv.category || undefined,
        priority: adv.priority || undefined,
        room_id: adv.room_id ? Number(adv.room_id) : undefined,
        date_from: adv.date_from || undefined,
        date_to: adv.date_to || undefined,
      })
      .then(setTickets)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
    maintenance
      .backlog()
      .then(setBacklog)
      .catch(() => setBacklog(null));
  }, [filter, adv.category, adv.priority, adv.room_id, adv.date_from, adv.date_to, t]);

  useEffect(() => load(), [load]);

  const rows = (tickets ?? []).filter(
    (tk) =>
      (textHas(tk.title, adv.fault) ||
        textHas(tk.description, adv.fault) ||
        textHas(tk.resolution, adv.fault)) &&
      textHas(tk.reported_by_name, adv.reported_by),
  );
  useEffect(() => {
    catalog.rooms({ limit: 300 }).then((p) => setRooms(p.items)).catch(() => setRooms([]));
  }, []);

  async function act(id: number, body: Record<string, unknown>) {
    setBusy(id);
    setErr("");
    try {
      await maintenance.update(id, body);
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("mt.updateFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  async function resolve(id: number) {
    const how = await prompt({
      title: t("mt.resolveTitle"),
      label: t("mt.resolveLabel"),
      placeholder: t("mt.resolvePlaceholder"),
      required: true,
      maxLength: 500,
      confirmLabel: t("mt.resolveConfirm"),
    });
    if (how !== null) await act(id, { status: "resolved", resolution: how });
  }

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("mt.eyebrow")}</p>
          <h1>{t("mt.title")}</h1>
        </div>
        <button className="btn btn--sm btn--gold" onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("common.close") : t("mt.reportFault")}
        </button>
      </div>

      {showForm && (
        <ReportForm
          rooms={rooms}
          onDone={() => {
            setShowForm(false);
            setFilter("open");
            load();
          }}
          onError={setErr}
        />
      )}

      {backlog && <BacklogStrip rows={backlog} />}

      <div className="row" style={{ marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
        <ChipBar
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label={(f) => (f === "all" ? t("status.all") : ticketStatusLabel(f))}
        />
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert>{err}</Alert>}
      {!tickets && !err && <TableSkeleton rows={7} cols={6} />}

      {tickets && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("mt.colPriority")}</th>
                  <th>{t("mt.colFault")}</th>
                  <th>{t("mt.colRoom")}</th>
                  <th>{t("mt.colReported")}</th>
                  <th>{t("ov.colStatus")}</th>
                  <th style={{ textAlign: "right" }}>{t("mt.colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tk) => (
                  <tr key={tk.ticket_id}>
                    <td>
                      <span className={`tag ${PRIORITY_TONE[tk.priority]}`}>
                        {ticketPriorityLabel(tk.priority)}
                      </span>
                    </td>
                    <td>
                      <strong>{tk.title}</strong>
                      <br />
                      <span className="tiny">
                        {ticketCategoryLabel(tk.category)}
                        {tk.description ? ` · ${tk.description}` : ""}
                      </span>
                      {tk.resolution ? (
                        <>
                          <br />
                          <span className="tiny">✓ {tk.resolution}</span>
                        </>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {tk.room_number ?? <span className="muted">{t("mt.commonArea")}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(tk.created_at.slice(0, 10), lang)}
                      <br />
                      <span className="tiny">{tk.reported_by_name}</span>
                    </td>
                    <td>
                      <span
                        className={`tag ${
                          tk.status === "resolved" || tk.status === "closed"
                            ? "tag--ok"
                            : tk.status === "in_progress"
                              ? "tag--info"
                              : ""
                        }`}
                      >
                        {ticketStatusLabel(tk.status)}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {tk.status === "open" && (
                        <button
                          className="btn btn--sm btn--gold"
                          disabled={busy === tk.ticket_id}
                          onClick={() => act(tk.ticket_id, { status: "in_progress" })}
                        >
                          {t("mt.start")}
                        </button>
                      )}
                      {tk.status === "in_progress" && (
                        <button
                          className="btn btn--sm btn--gold"
                          disabled={busy === tk.ticket_id}
                          onClick={() => resolve(tk.ticket_id)}
                        >
                          {t("mt.resolve")}
                        </button>
                      )}
                      {tk.status === "resolved" && (
                        <button
                          className="btn btn--sm btn--quiet"
                          disabled={busy === tk.ticket_id}
                          onClick={() => act(tk.ticket_id, { status: "closed" })}
                        >
                          {t("common.close")}
                        </button>
                      )}
                      {(tk.status === "closed" || tk.status === "cancelled") && (
                        <span className="tiny">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <TableEmpty cols={6}>
                    {tickets.length > 0
                      ? t("filter.noRowsMatch")
                      : filter === "all"
                      ? t("mt.noneAtAll")
                      : t("mt.noneWithStatus", { status: ticketStatusLabel(filter).toLowerCase() })}
                  </TableEmpty>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function ReportForm({
  rooms,
  onDone,
  onError,
}: {
  rooms: Room[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await maintenance.report({
        room_id: roomId ? Number(roomId) : undefined,
        category,
        priority,
        title: title.trim(),
        description: description.trim() || undefined,
      });
      onDone();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("mt.couldNotReport"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="panel__head">{t("mt.reportFault")}</div>
      <div style={{ padding: 20 }} className="stack stack--tight">
        <Field
          label={t("mt.whatsWrong")}
          placeholder={t("mt.whatsWrongPlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid grid-3" style={{ gap: 14 }}>
          <label className="field">
            <span>{t("mt.colRoom")}</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t("mt.commonArea")}</option>
              {rooms.map((r) => (
                <option key={r.room_id} value={r.room_id}>
                  {r.room_number}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("mt.category")}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(TICKET_CATEGORY_KEY[c] ?? c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("mt.colPriority")}</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(TICKET_PRIORITY_KEY[p] ?? p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Field
          label={t("mt.detailsOptional")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="tiny" style={{ color: "var(--p-ink-dim)" }}>
          {t("mt.offSalesNote")}
        </p>
        <div>
          <button className="btn btn--sm btn--gold" disabled={busy || !title.trim()} onClick={submit}>
            {busy ? <Spinner /> : t("mt.submitTicket")}
          </button>
        </div>
      </div>
    </div>
  );
}
