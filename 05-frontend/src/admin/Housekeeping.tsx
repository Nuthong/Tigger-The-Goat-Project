import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { housekeeping, catalog, adminApi, ApiError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import type { HousekeepingStatus, HousekeepingTask, Room, StaffOption } from "../lib/types";
import { Alert, ChipBar, Field, Spinner, TableEmpty, TableSkeleton } from "../components/ui";
import { FilterPanel, type FilterField } from "../components/FilterPanel";
import { activeFilterCount, inDateRange, isOneOf, textHas, withFilter } from "../lib/filters";
import { useToast } from "../components/ToastProvider";
import { fmtDate } from "../lib/format";
import { todayISO } from "../lib/validation";
import { useT } from "../i18n/I18n";

const FILTERS = ["today", "pending", "in_progress", "done", "all"] as const;
type Filter = (typeof FILTERS)[number];

const TASK_TYPES = [
  "checkout_clean",
  "stayover_clean",
  "deep_clean",
  "turndown",
  "inspection",
] as const;

const TASK_TYPE_KEY: Record<string, string> = {
  checkout_clean: "taskType.checkout_clean",
  stayover_clean: "taskType.stayover_clean",
  deep_clean: "taskType.deep_clean",
  turndown: "taskType.turndown",
  inspection: "taskType.inspection",
};

const HK_STATUS_KEY: Record<string, string> = {
  pending: "hkStatus.pending",
  in_progress: "hkStatus.in_progress",
  done: "hkStatus.done",
  skipped: "hkStatus.skipped",
};

const NEXT: Record<HousekeepingStatus, { to: HousekeepingStatus; labelKey: string } | null> = {
  pending: { to: "in_progress", labelKey: "mt.start" },
  in_progress: { to: "done", labelKey: "hk.markClean" },
  done: null,
  skipped: { to: "pending", labelKey: "hk.reopen" },
};

export function Housekeeping() {
  const { t, lang } = useT();
  const toast = useToast();
  const { user } = useAuth();
  const myStaffId = user?.staff_id ?? null;
  const [tasks, setTasks] = useState<HousekeepingTask[] | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<Filter>("today");
  const [mineOnly, setMineOnly] = useState(user?.role === "housekeeping" && myStaffId != null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [adv, setAdv] = useState<Record<string, string>>({});

  const taskTypeLabel = (v: string) => t(TASK_TYPE_KEY[v] ?? v);
  const hkStatusLabel = (s: string) => t(HK_STATUS_KEY[s] ?? s);

  // one filter per column (the status has the chip bar). The board is loaded
  // whole for the chip, so these narrow it in the browser.
  const advFields: FilterField[] = [
    { type: "text", key: "room", label: t("mt.colRoom"), placeholder: "305" },
    {
      type: "select",
      key: "floor",
      label: t("hk.floor"),
      options: [...new Set(rooms.map((r) => r.floor))]
        .sort((a, b) => a - b)
        .map((f) => ({ value: String(f), label: t("hk.floorLabel", { n: f }) })),
    },
    {
      type: "select",
      key: "room_type",
      label: t("filter.roomType"),
      options: [...new Set((tasks ?? []).map((tk) => tk.room_type))]
        .sort()
        .map((n) => ({ value: n, label: n })),
    },
    {
      type: "select",
      key: "arriving",
      label: t("hk.arrivalTodayTag"),
      options: [
        { value: "true", label: t("common.yes") },
        { value: "false", label: t("common.no") },
      ],
    },
    {
      type: "select",
      key: "task_type",
      label: t("hk.colTask"),
      options: TASK_TYPES.map((v) => ({ value: v, label: taskTypeLabel(v) })),
    },
    { type: "text", key: "note", label: t("hk.note") },
    { type: "date-range", label: t("hk.colScheduled"), from: "from", to: "to" },
    {
      type: "select",
      key: "assigned_to",
      label: t("hk.colAssignedTo"),
      options: [
        { value: "none", label: t("hk.unassigned") },
        ...staff.map((s) => ({ value: String(s.staff_id), label: s.full_name })),
      ],
    },
  ];

  const load = useCallback(() => {
    setTasks(null);
    setErr("");
    const params =
      filter === "today"
        ? { day: todayISO() }
        : filter === "all"
          ? {}
          : { status: filter };
    housekeeping
      .tasks(params)
      .then(setTasks)
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [filter, t]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    adminApi.staff("housekeeping").then(setStaff).catch(() => setStaff([]));
    catalog.rooms({ limit: 300 }).then((p) => setRooms(p.items)).catch(() => setRooms([]));
  }, []);

  async function act(task: HousekeepingTask, body: Record<string, unknown>) {
    setBusy(task.task_id);
    setErr("");
    try {
      await housekeeping.update(task.task_id, body);
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("mt.updateFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  const counts = (tasks ?? []).reduce<Record<string, number>>((m, tk) => {
    m[tk.status] = (m[tk.status] ?? 0) + 1;
    return m;
  }, {});

  const unassigned = (tasks ?? []).filter(
    (tk) => tk.status === "pending" && tk.assigned_to == null,
  ).length;

  const arrivalPrep = (tasks ?? []).filter(
    (tk) => tk.arriving_today && tk.status !== "done",
  ).length;

  // rooms a guest walks into today float to the top of the board; the column
  // filters (a floor lets a housekeeper focus on their own section) narrow it
  const rows = tasks
    ? [...tasks]
        .filter((tk) => !mineOnly || tk.assigned_to === myStaffId)
        .filter(
          (tk) =>
            textHas(tk.room_number, adv.room) &&
            isOneOf(tk.floor, adv.floor) &&
            isOneOf(tk.room_type, adv.room_type) &&
            isOneOf(tk.arriving_today, adv.arriving) &&
            isOneOf(tk.task_type, adv.task_type) &&
            textHas(tk.note, adv.note) &&
            inDateRange(tk.scheduled_for, adv.from, adv.to) &&
            (adv.assigned_to === "none"
              ? tk.assigned_to == null
              : isOneOf(tk.assigned_to, adv.assigned_to)),
        )
        .sort((a, b) => Number(b.arriving_today) - Number(a.arriving_today))
    : null;

  async function autoAssign() {
    setAssigning(true);
    setErr("");
    try {
      const day = filter === "today" ? todayISO() : undefined;
      const r = await housekeeping.autoAssign(day);
      toast.success(
        r.assigned
          ? t("hk.autoAssignedToast", {
              n: r.assigned,
              ns: r.assigned === 1 ? "" : "s",
              byN: r.by_staff.length,
              byNs: r.by_staff.length === 1 ? "" : "s",
            })
          : t("hk.nothingToAssign"),
      );
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("hk.autoAssignFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("hk.eyebrow")}</p>
          <h1>{t("hk.title")}</h1>
        </div>
        <span className="row">
          {(["pending", "in_progress", "done"] as const).map((s) => (
            <span key={s} className="muted" style={{ fontSize: 13 }}>
              <span className={`roomtile__dot dot--${s === "done" ? "available" : "cleaning"}`} />
              {counts[s] ?? 0} {hkStatusLabel(s).toLowerCase()}
            </span>
          ))}
          {arrivalPrep > 0 && (
            <span className="tag tag--warn" style={{ fontSize: 12 }}>
              {t("hk.arrivalsToday", { n: arrivalPrep, ns: arrivalPrep === 1 ? "" : "s" })}
            </span>
          )}
          <button
            className="btn btn--sm btn--quiet"
            disabled={assigning || unassigned === 0}
            title={unassigned === 0 ? t("hk.autoAssignAllOwned") : t("hk.autoAssignHint")}
            onClick={autoAssign}
          >
            {assigning
              ? t("hk.assigning")
              : unassigned
                ? t("hk.autoAssignCount", { n: unassigned })
                : t("hk.autoAssign")}
          </button>
          <Link
            to={`/print/housekeeping/${todayISO()}`}
            className="btn btn--sm btn--quiet"
            title={t("hk.printSheetHint")}
          >
            {t("hk.printSheet")}
          </Link>
          <button className="btn btn--sm btn--gold" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? t("common.close") : t("hk.newTask")}
          </button>
        </span>
      </div>

      {showAdd && (
        <AddTaskForm
          rooms={rooms}
          staff={staff}
          onDone={(roomNo) => {
            toast.success(t("hk.taskAddedToast", { room: roomNo }));
            setShowAdd(false);
            setFilter("pending");
            load();
          }}
          onError={(m) => {
            setErr(m);
            toast.error(m);
          }}
        />
      )}

      <div className="row" style={{ marginBottom: 18, gap: 14, flexWrap: "wrap" }}>
        <ChipBar
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label={(f) => (f === "today" ? t("hk.filterToday") : f === "all" ? t("status.all") : hkStatusLabel(f))}
        />
        {myStaffId != null && (
          <button
            className={`btn btn--sm ${mineOnly ? "btn--gold" : "btn--quiet"}`}
            onClick={() => setMineOnly((v) => !v)}
          >
            {mineOnly ? t("hk.myTasks") : t("hk.everyone")}
          </button>
        )}
        <FilterPanel
          fields={advFields}
          values={adv}
          onChange={(k, v) => setAdv((a) => withFilter(a, k, v))}
          onClear={() => setAdv({})}
        />
      </div>

      {err && <Alert>{err}</Alert>}
      {!tasks && !err && <TableSkeleton rows={8} cols={6} />}

      {tasks && (
        <div className="panel">
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("mt.colRoom")}</th>
                  <th>{t("hk.colTask")}</th>
                  <th>{t("hk.colScheduled")}</th>
                  <th>{t("hk.colAssignedTo")}</th>
                  <th>{t("ov.colStatus")}</th>
                  <th style={{ textAlign: "right" }}>{t("mt.colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((tk) => {
                  const next = NEXT[tk.status];
                  const locked = tk.status === "done";
                  const needsAssignee = tk.status === "pending" && tk.assigned_to == null;
                  return (
                    <tr key={tk.task_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <strong>{tk.room_number}</strong>
                        {tk.arriving_today && (
                          <span
                            className="tag tag--warn"
                            style={{ marginLeft: 6, fontSize: 10 }}
                            title={t("hk.arrivalTodayTitle")}
                          >
                            {t("hk.arrivalTodayTag")}
                          </span>
                        )}
                        <br />
                        <span className="tiny">
                          {t("hk.floorRoomType", { floor: tk.floor, type: tk.room_type })}
                        </span>
                      </td>
                      <td>
                        {taskTypeLabel(tk.task_type)}
                        {tk.note ? (
                          <>
                            <br />
                            <span className="tiny">{tk.note}</span>
                          </>
                        ) : null}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(tk.scheduled_for, lang)}</td>
                      <td>
                        <select
                          className="minisel"
                          aria-label={t("hk.assigneeAria", { room: tk.room_number })}
                          value={tk.assigned_to ?? ""}
                          disabled={busy === tk.task_id || locked}
                          title={locked ? t("hk.lockedTitle") : undefined}
                          onChange={(e) =>
                            act(tk, {
                              assigned_to: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">{t("hk.unassigned")}</option>
                          {staff.map((s) => (
                            <option key={s.staff_id} value={s.staff_id}>
                              {s.full_name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span
                          className={`tag ${
                            tk.status === "done"
                              ? "tag--ok"
                              : tk.status === "in_progress"
                                ? "tag--info"
                                : ""
                          }`}
                        >
                          {hkStatusLabel(tk.status)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {next ? (
                          <button
                            className="btn btn--sm btn--gold"
                            disabled={busy === tk.task_id || needsAssignee}
                            title={needsAssignee ? t("hk.needsAssigneeTitle") : undefined}
                            onClick={() => act(tk, { status: next.to })}
                          >
                            {t(next.labelKey)}
                          </button>
                        ) : (
                          <span className="tiny">-</span>
                        )}
                        {tk.status === "pending" && (
                          <button
                            className="btn btn--sm btn--quiet"
                            style={{ marginLeft: 6 }}
                            disabled={busy === tk.task_id}
                            onClick={() => act(tk, { status: "skipped" })}
                          >
                            {t("hk.skip")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(rows ?? []).length === 0 && (
                  <TableEmpty cols={6}>
                    {tasks.length > 0 && activeFilterCount(advFields, adv) > 0
                      ? t("filter.noRowsMatch")
                      : tasks.length > 0 && mineOnly
                        ? t("hk.nothingAssignedToYou")
                        : filter === "today"
                          ? t("hk.nothingOnBoardToday")
                          : t("hk.nothingOnBoard")}
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

function AddTaskForm({
  rooms,
  staff,
  onDone,
  onError,
}: {
  rooms: Room[];
  staff: StaffOption[];
  onDone: (roomNumber: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useT();
  const [roomId, setRoomId] = useState("");
  const [taskType, setTaskType] = useState("deep_clean");
  const [scheduledFor, setScheduledFor] = useState(todayISO());
  const [assignedTo, setAssignedTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const sorted = [...rooms].sort((a, b) => a.room_number.localeCompare(b.room_number));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!roomId) return;
    setBusy(true);
    try {
      await housekeeping.create({
        room_id: Number(roomId),
        task_type: taskType,
        scheduled_for: scheduledFor || undefined,
        assigned_to: assignedTo ? Number(assignedTo) : undefined,
        note: note.trim() || undefined,
      });
      onDone(sorted.find((r) => r.room_id === Number(roomId))?.room_number ?? roomId);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("hk.couldNotAddTask"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" style={{ marginBottom: 20 }} onSubmit={submit}>
      <div className="panel__head">{t("hk.newTaskFormTitle")}</div>
      <div style={{ padding: 20 }} className="stack stack--tight">
        <div className="grid grid-3" style={{ gap: 14 }}>
          <label className="field">
            <span>{t("mt.colRoom")}</span>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
              <option value="">{t("hk.chooseEllipsis")}</option>
              {sorted.map((r) => (
                <option key={r.room_id} value={r.room_id}>
                  {r.room_number}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t("hk.colTask")}</span>
            <select value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              {TASK_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t(TASK_TYPE_KEY[v])}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t("hk.scheduledFor")}
            type="date"
            value={scheduledFor}
            min={todayISO()}
            onChange={(e) => setScheduledFor(e.target.value)}
          />
        </div>
        <div className="grid grid-2" style={{ gap: 14 }}>
          <label className="field">
            <span>{t("hk.assignToOptional")}</span>
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">{t("hk.unassigned")}</option>
              {staff.map((s) => (
                <option key={s.staff_id} value={s.staff_id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t("hk.noteOptional")}
            value={note}
            maxLength={255}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <button className="btn btn--sm btn--gold" disabled={busy || !roomId}>
            {busy ? <Spinner /> : t("hk.addTask")}
          </button>
        </div>
      </div>
    </form>
  );
}
