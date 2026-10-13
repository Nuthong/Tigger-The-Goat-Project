import { useCallback, useEffect, useState, type FormEvent } from "react";
import { catalog, ApiError } from "../lib/api";
import type { Room, RoomStatusLogRow, RoomType } from "../lib/types";
import { useAuth } from "../auth/AuthContext";
import { Alert, CardsSkeleton, Field, Skeleton, Spinner } from "../components/ui";
import { Modal } from "../components/Modal";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmDialog";
import { baht } from "../lib/format";
import { toPositiveAmount } from "../lib/validation";
import { useT } from "../i18n/I18n";

const STATUSES = ["available", "cleaning", "maintenance", "closed"] as const;
const ROOM_STATUS_KEY: Record<string, string> = {
  available: "roomStatus.available",
  cleaning: "roomStatus.cleaning",
  maintenance: "roomStatus.maintenance",
  closed: "roomStatus.closed",
  occupied: "roomStatus.occupied",
};

export function RoomsAdmin() {
  const { isManager } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { t, lang } = useT();
  const roomStatusLabel = (s: string) => t(ROOM_STATUS_KEY[s] ?? s);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<Room | null>(null);
  const [types, setTypes] = useState<Record<number, string>>({});
  const [typeList, setTypeList] = useState<RoomType[]>([]);
  const [showTypes, setShowTypes] = useState(false);
  const [editingType, setEditingType] = useState<RoomType | null>(null);
  const [history, setHistory] = useState<RoomStatusLogRow[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const loadTypes = useCallback(() => {
    catalog
      .roomTypes()
      .then((ts: RoomType[]) => {
        setTypeList(ts);
        setTypes(Object.fromEntries(ts.map((t) => [t.room_type_id, t.name])));
      })
      .catch(() => setTypes({}));
  }, []);

  useEffect(() => loadTypes(), [loadTypes]);

  // the open room's status history (room_status_log), newest first
  useEffect(() => {
    setHistory(null);
    if (!selected) return;
    let live = true;
    catalog
      .roomStatusLog(selected.room_id, 8)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [selected]);

  const load = useCallback(() => {
    setErr("");
    catalog
      .rooms({ limit: 300 })
      .then((p) => setRooms(p.items))
      .catch((e) => setErr(e instanceof ApiError ? e.message : t("common.failedToLoad")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(room: Room, status: string) {
    if (
      (status === "maintenance" || status === "closed") &&
      room.status !== status &&
      !(await confirm({
        title: t("ra.setRoomTo", {
          n: room.room_number,
          status: roomStatusLabel(status).toLowerCase(),
        }),
        body: t("ra.setRoomBody"),
        confirmLabel: t("ra.setStatusBtn", { status: roomStatusLabel(status).toLowerCase() }),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(room.room_id);
    setErr("");
    try {
      await catalog.setRoomStatus(room.room_id, status);
      toast.success(
        t("ra.roomUpdated", { n: room.room_number, status: roomStatusLabel(status).toLowerCase() }),
      );
      setSelected(null);
      load();
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t("ra.updateFailed");
      setErr(m);
      toast.error(m);
    } finally {
      setBusy(null);
    }
  }

  const effectiveStatus = (r: Room) => (r.occupied ? "occupied" : r.status);
  const term = q.trim().toLowerCase();
  const filteredRooms = (rooms ?? []).filter((r) => {
    if (statusFilter !== "all" && effectiveStatus(r) !== statusFilter) return false;
    if (typeFilter !== "all" && String(r.room_type_id) !== typeFilter) return false;
    if (term) {
      const inNumber = r.room_number.toLowerCase().includes(term);
      const inNote = (r.note ?? "").toLowerCase().includes(term);
      if (!inNumber && !inNote) return false;
    }
    return true;
  });
  const filtersActive = statusFilter !== "all" || typeFilter !== "all" || term.length > 0;

  const byFloor = new Map<number, Room[]>();
  filteredRooms.forEach((r) => {
    byFloor.set(r.floor, [...(byFloor.get(r.floor) ?? []), r]);
  });
  const occupiedCount = (rooms ?? []).filter((r) => r.occupied).length;
  const counts = [
    { s: "occupied", n: occupiedCount },
    // an occupied room is 'available' underneath - don't double-count it there
    { s: "available", n: (rooms ?? []).filter((r) => r.status === "available" && !r.occupied).length },
    ...STATUSES.filter((s) => s !== "available").map((s) => ({
      s,
      n: (rooms ?? []).filter((r) => r.status === s).length,
    })),
  ];

  return (
    <>
      <div className="admin__head">
        <div>
          <p className="eyebrow">{t("ra.eyebrow")}</p>
          <h1>{t("ra.title")}</h1>
        </div>
        <span className="row">
          {counts.map((c) => (
            <span key={c.s} className="muted" style={{ fontSize: 13 }}>
              <span className={`roomtile__dot dot--${c.s}`} />
              {c.n} {roomStatusLabel(c.s).toLowerCase()}
            </span>
          ))}
          {isManager && (
            <button className="btn btn--sm btn--quiet" onClick={() => setShowTypes((v) => !v)}>
              {showTypes ? t("ra.hideTypes") : t("ra.roomTypes")}
            </button>
          )}
          {isManager && (
            <button className="btn btn--sm btn--gold" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? t("common.close") : t("ra.addRoom")}
            </button>
          )}
        </span>
      </div>

      {err && <Alert>{err}</Alert>}

      {rooms && rooms.length > 0 && (
        <div className="row" style={{ marginBottom: 18, gap: 10, flexWrap: "wrap" }}>
          <input
            type="search"
            placeholder={t("ra.searchPlaceholder")}
            aria-label={t("ra.searchAria")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              padding: "6px 11px",
              border: "1px solid var(--p-line)",
              borderRadius: 8,
              font: "inherit",
              minWidth: 210,
            }}
          />
          <select
            aria-label={t("ov.colStatus")}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid var(--p-line)", borderRadius: 8, font: "inherit" }}
          >
            <option value="all">{t("filter.any")}</option>
            {["occupied", ...STATUSES].map((s) => (
              <option key={s} value={s}>
                {roomStatusLabel(s)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("filter.roomType")}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid var(--p-line)", borderRadius: 8, font: "inherit" }}
          >
            <option value="all">{t("filter.any")}</option>
            {Object.entries(types).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              className="btn btn--sm btn--quiet"
              onClick={() => {
                setQ("");
                setStatusFilter("all");
                setTypeFilter("all");
              }}
            >
              {t("filter.clear")}
            </button>
          )}
        </div>
      )}

      {isManager && showTypes && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel__head">
            {t("ra.roomTypes")}
            <span className="tiny">{t("ra.typesNote")}</span>
          </div>
          <div className="table-wrap">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{t("ra.colType")}</th>
                  <th style={{ textAlign: "right" }}>{t("ra.colBasePrice")}</th>
                  <th style={{ textAlign: "right" }}>{t("ra.colSleeps")}</th>
                  <th style={{ textAlign: "right" }}>{t("ra.colRooms")}</th>
                  <th style={{ textAlign: "right" }}>{t("ra.colRating")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {typeList.map((rt) => (
                  <tr key={rt.room_type_id}>
                    <td>
                      <strong>{rt.name}</strong>
                      {rt.description && (
                        <>
                          <br />
                          <span className="tiny">{rt.description}</span>
                        </>
                      )}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {baht(rt.base_price_per_night, true)}
                    </td>
                    <td style={{ textAlign: "right" }}>{rt.max_occupancy}</td>
                    <td style={{ textAlign: "right" }}>
                      {(rooms ?? []).filter((r) => r.room_type_id === rt.room_type_id).length}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {rt.avg_rating ? `${Number(rt.avg_rating).toFixed(1)} ★` : "-"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn btn--sm btn--quiet" onClick={() => setEditingType(rt)}>
                        {t("sv.edit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingType && (
        <Modal onClose={() => setEditingType(null)} maxWidth={440} labelledBy="rtdlg-title">
          <h3 id="rtdlg-title">{t("ra.editTypeTitle", { name: editingType.name })}</h3>
          <RoomTypeForm
            rt={editingType}
            onCancel={() => setEditingType(null)}
            onDone={() => {
              toast.success(t("ra.typeSaved", { name: editingType.name }));
              setEditingType(null);
              loadTypes();
            }}
            onError={(m) => toast.error(m)}
          />
        </Modal>
      )}

      {isManager && showAdd && (
        <AddRoomForm
          types={types}
          onDone={(roomNumber) => {
            toast.success(t("ra.roomAdded", { n: roomNumber }));
            setShowAdd(false);
            load();
          }}
          onError={(m) => {
            setErr(m);
            toast.error(m);
          }}
        />
      )}

      {!rooms && !err && <CardsSkeleton count={18} height={70} />}

      {rooms && filteredRooms.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {t("ra.noRoomsMatch")}
        </p>
      )}

      {rooms &&
        [...byFloor.keys()]
          .sort((a, b) => a - b)
          .map((floor) => (
            <div className="floor" key={floor}>
              <div className="floor__label">{t("ra.floorLabel", { n: floor })}</div>
              <div className="roomgrid">
                {byFloor
                  .get(floor)!
                  .sort((a, b) => a.room_number.localeCompare(b.room_number))
                  .map((r) => (
                    <button
                      key={r.room_id}
                      className={`roomtile${r.occupied ? " is-occupied" : ""}`}
                      onClick={() => setSelected(r)}
                      disabled={busy === r.room_id}
                    >
                      <div className="roomtile__no">{r.room_number}</div>
                      <div className="roomtile__type" title={types[r.room_type_id]}>
                        {types[r.room_type_id] ?? "-"}
                      </div>
                      <div className="roomtile__status">
                        <span
                          className={`roomtile__dot dot--${r.occupied ? "occupied" : r.status}`}
                        />
                        {roomStatusLabel(r.occupied ? "occupied" : r.status)}
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          ))}

      {selected && (
        <Modal onClose={() => setSelected(null)} maxWidth={400} labelledBy="roomdlg-title">
          <div className="roomdlg__head">
            <div>
              <h3 id="roomdlg-title">{t("ra.roomTitle", { n: selected.room_number })}</h3>
              <p className="tiny" style={{ marginTop: 2 }}>
                {types[selected.room_type_id] ?? "-"} · {t("ra.floorLabel", { n: selected.floor })}
              </p>
            </div>
            <button
              type="button"
              className="roomdlg__x"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={() => setSelected(null)}
            >
              ×
            </button>
          </div>

          <div className="roomdlg__now">
            <span className={`roomtile__dot dot--${selected.status}`} />
            <span>
              {t("ra.currentStatus")}: <strong>{roomStatusLabel(selected.status)}</strong>
            </span>
          </div>
          {selected.occupied && (
            <p className="tiny" style={{ marginTop: 8, color: "#3f6ea8" }}>
              {t("ra.guestCheckedInNote")}
            </p>
          )}

          <p className="eyebrow" style={{ marginTop: 16, marginBottom: 0 }}>{t("ra.changeTo")}</p>
          <div className="roomdlg__choices">
            {STATUSES.filter((s) => s !== selected.status).map((s) => (
              <button
                key={s}
                type="button"
                className="roomdlg__choice"
                disabled={busy === selected.room_id}
                onClick={() => setStatus(selected, s)}
              >
                <span className={`roomtile__dot dot--${s}`} />
                {roomStatusLabel(s)}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--p-line)" }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>{t("ra.historyTitle")}</p>
            {!history && (
              <div className="stack stack--tight">
                <Skeleton h={12} />
                <Skeleton h={12} w="80%" />
              </div>
            )}
            {history && history.length === 0 && <p className="tiny">{t("ra.historyNone")}</p>}
            {history && history.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack stack--tight">
                {history.map((h) => (
                  <li key={h.log_id} style={{ fontSize: 13 }}>
                    <span className={`roomtile__dot dot--${h.new_status}`} />
                    {roomStatusLabel(h.old_status)} → <strong>{roomStatusLabel(h.new_status)}</strong>
                    <br />
                    <span className="tiny">
                      {t("ra.historyBy", {
                        name: h.changed_by_name,
                        when: new Date(h.changed_at).toLocaleString(lang === "th" ? "th-TH" : "en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function AddRoomForm({
  types,
  onDone,
  onError,
}: {
  types: Record<number, string>;
  onDone: (roomNumber: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useT();
  const [roomNumber, setRoomNumber] = useState("");
  const [floor, setFloor] = useState("1");
  const [typeId, setTypeId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = Object.entries(types);
  const trimmedNo = roomNumber.trim();
  const floorNum = Math.floor(Number(floor));
  const valid = trimmedNo.length > 0 && trimmedNo.length <= 10 && !!typeId && floorNum >= 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await catalog.createRoom({
        room_number: trimmedNo,
        floor: floorNum,
        room_type_id: Number(typeId),
        note: note.trim() || undefined,
      });
      onDone(trimmedNo);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("ra.couldNotAdd"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" style={{ marginBottom: 20 }} onSubmit={submit}>
      <div className="panel__head">{t("ra.newRoomPanel")}</div>
      <div
        style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, alignItems: "end" }}
      >
        <Field
          label={t("ra.roomNumberLabel")}
          value={roomNumber}
          onChange={(e) => setRoomNumber(e.target.value)}
          required
        />
        <Field
          label={t("ra.floorFieldLabel")}
          type="number"
          min={0}
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
        />
        <label className="field">
          <span>{t("ra.roomTypeLabel")}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            <option value="">{t("ra.chooseEllipsis")}</option>
            {entries.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t("ra.noteOptional")}
          value={note}
          maxLength={255}
          onChange={(e) => setNote(e.target.value)}
        />
        <div>
          <button className="btn btn--sm btn--gold" disabled={busy || !valid}>
            {busy ? <Spinner /> : t("ra.addRoom")}
          </button>
        </div>
      </div>
    </form>
  );
}

function RoomTypeForm({
  rt,
  onDone,
  onError,
  onCancel,
}: {
  rt: RoomType;
  onDone: () => void;
  onError: (m: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [price, setPrice] = useState(Number(rt.base_price_per_night).toFixed(2));
  const [sleeps, setSleeps] = useState(String(rt.max_occupancy));
  const [description, setDescription] = useState(rt.description ?? "");
  const [busy, setBusy] = useState(false);
  const parsedPrice = toPositiveAmount(price);
  const sleepsNum = Math.floor(Number(sleeps));
  const valid =
    parsedPrice != null && Number.isFinite(sleepsNum) && sleepsNum >= 1 && sleepsNum <= 20;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || parsedPrice == null) return;
    setBusy(true);
    try {
      await catalog.updateRoomType(rt.room_type_id, {
        base_price_per_night: parsedPrice.toFixed(2),
        max_occupancy: sleepsNum,
        description: description.trim() || null,
      });
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t("sv.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack--tight" style={{ marginTop: 16 }} onSubmit={submit}>
      <Field
        label={t("ra.basePriceLabel")}
        type="number"
        inputMode="decimal"
        min={0.01}
        step={0.01}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        hint={t("ra.basePriceHint")}
      />
      <Field
        label={t("ra.sleepsLabel")}
        type="number"
        min={1}
        max={20}
        value={sleeps}
        onChange={(e) => setSleeps(e.target.value)}
      />
      <Field
        label={t("sv.descLabel")}
        value={description}
        maxLength={255}
        onChange={(e) => setDescription(e.target.value)}
      />
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
