import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { catalog } from "../lib/api";
import { HERO_ROOMS } from "../lib/images";
import { roomPhoto, roomTagline, roomNote, roomFacts, slugify } from "../lib/rooms";
import type { RoomType } from "../lib/types";
import { Photo } from "../components/Photo";
import { Reveal } from "../components/Reveal";
import { Stars } from "../components/Stars";
import { useT } from "../i18n/I18n";

export function Rooms() {
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const { t } = useT();

  useEffect(() => {
    catalog.roomTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  return (
    <div className="page">
      <section className="imghero" style={{ minHeight: "62vh" }}>
        <img className="imghero__img" src={HERO_ROOMS} alt="" />
        <div className="container imghero__inner">
          <Reveal>
            <p className="eyebrow">{t("nav.brand")} · Bangkok</p>
            <div className="rule" />
            <h1>{t("rooms.title")}</h1>
            <p className="lede">{t("rooms.lede")}</p>
          </Reveal>
        </div>
      </section>

      {(types ?? []).map((rt, i) => {
        const f = roomFacts(rt.room_type_id);
        return (
          <section key={rt.room_type_id} className={`section${i % 2 ? " section--alt" : ""}`}>
            <div className="container container--wide">
              <div
                className="grid grid-2"
                style={{ alignItems: "center", gap: 48, direction: i % 2 ? "rtl" : "ltr" }}
              >
                <div style={{ direction: "ltr" }}>
                  <Reveal>
                    <Link to={`/rooms/${slugify(rt.name)}`}>
                      <Photo src={roomPhoto(rt.room_type_id)} alt={rt.name} ratio="3x2" />
                    </Link>
                  </Reveal>
                </div>
                <div style={{ direction: "ltr" }}>
                  <Reveal delay={80}>
                    <p className="roomcard__type">{rt.name}</p>
                    <h2 style={{ marginTop: 8 }}>{roomTagline(rt.room_type_id) || rt.name}</h2>
                    <p className="lede" style={{ marginTop: 14, fontSize: "clamp(16px,1.8vw,20px)" }}>
                      {roomNote(rt.room_type_id)}
                    </p>
                    {f && (
                      <p className="roommeta">
                        <span>{f.size}</span>
                        <span>{t("rooms.upToGuests", { n: rt.max_occupancy })}</span>
                        <span>{f.bed}</span>
                        <span>{f.view} view</span>
                      </p>
                    )}
                    {rt.review_count > 0 && (
                      <p className="row" style={{ gap: 8, marginTop: 12 }}>
                        <Stars value={rt.avg_rating} showValue size={14} />
                        <span className="muted" style={{ fontSize: 13 }}>
                          ({rt.review_count})
                        </span>
                      </p>
                    )}
                    <p className="muted" style={{ marginTop: 14 }}>
                      {t("rooms.fromPrice")}{" "}
                      <strong>฿{Number(rt.base_price_per_night).toLocaleString()}</strong>{" "}
                      {t("rooms.perNight")}
                    </p>
                    <div className="row" style={{ marginTop: 22 }}>
                      <Link to={`/rooms/${slugify(rt.name)}`} className="btn btn--outline">
                        {t("rooms.viewRoom")}
                      </Link>
                      <Link to={`/book?rt=${rt.room_type_id}`} className="link-arrow">
                        {t("hero.availability")}
                      </Link>
                    </div>
                  </Reveal>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <section className="section section--dark">
        <div className="container center">
          <Reveal>
            <p className="eyebrow">{t("rooms.readyEyebrow")}</p>
            <div className="rule" />
            <h2 style={{ color: "var(--on-dark)" }}>{t("rooms.readyTitle")}</h2>
            <div className="row" style={{ justifyContent: "center", marginTop: 26 }}>
              <Link to="/book" className="btn btn--gold">
                {t("hero.availability")}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
