import type { Service } from "../lib/types";
import { addonCap, toggleAddon, type AddonPicks, type StayShape } from "../lib/addons";
import { baht } from "../lib/format";
import { useT } from "../i18n/I18n";

/**
 * A list of the active add-on services (`service`), each with one Add button.
 * Adding covers the whole stay (BR-29) - breakfast for every guest every
 * morning, an extra bed every night, the transfer both ways - and the row says
 * exactly what that is and what it costs. Used by the guest checkout and the
 * staff booking form; the parent owns the picks, keeps them at full cover as
 * the stay changes (`coverPicks`) and sends them as `services` on `POST /bookings`.
 */
export function AddonPicker({
  catalog,
  picks,
  stay,
  onChange,
  disabled = false,
}: {
  catalog: Service[];
  picks: AddonPicks;
  stay: StayShape;
  onChange: (next: AddonPicks) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  if (catalog.length === 0) {
    return <p className="tiny">{t("addons.none")}</p>;
  }
  const n = Math.max(1, stay.nights);
  const r = Math.max(1, stay.rooms);
  const g = Math.max(1, stay.guests);
  const plural = { ns: n > 1 ? "s" : "", rs: r > 1 ? "s" : "", gs: g > 1 ? "s" : "" };
  return (
    <ul className="stack stack--tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {catalog.map((s) => {
        const on = picks[s.service_id] !== undefined;
        const qty = addonCap(s.basis, stay);
        const cover = t(`addons.cover.${s.basis}`, { n, r, g, ...plural });
        return (
          <li
            key={s.service_id}
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--line, #e6e0d3)",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <strong style={{ fontWeight: on ? 600 : 500 }}>{s.name}</strong>
              <span className="tiny"> · {baht(s.price)}</span>
              {s.description && (
                <>
                  <br />
                  <span className="tiny">{s.description}</span>
                </>
              )}
              <br />
              <span className="tiny" style={{ color: on ? "var(--ink)" : undefined }}>
                {cover} = {baht(Number(s.price) * qty)}
              </span>
            </span>
            <button
              type="button"
              className={`btn btn--sm ${on ? "btn--gold" : "btn--quiet"}`}
              style={{ flexShrink: 0, minWidth: 92 }}
              disabled={disabled}
              aria-pressed={on}
              aria-label={t(on ? "addons.removeAria" : "addons.addAria", { name: s.name })}
              onClick={() => onChange(toggleAddon(picks, s, stay))}
            >
              {on ? `✓ ${t("addons.added")}` : `+ ${t("addons.add")}`}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
