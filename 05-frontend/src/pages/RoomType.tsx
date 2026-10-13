import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { catalog } from "../lib/api";
import { roomPhoto, roomTagline, roomNote, roomFacts, roomAmenities, slugify } from "../lib/rooms";
import type { RoomType as RT, RoomTypeReviews } from "../lib/types";
import { BackLink } from "../components/BackLink";
import { Spinner } from "../components/ui";
import { Reveal } from "../components/Reveal";
import { Stars, ratingWordKey } from "../components/Stars";
import { fmtDate } from "../lib/format";
import { useT } from "../i18n/I18n";

export function RoomType() {
  const { slug } = useParams();
  const { t, lang } = useT();
  const [types, setTypes] = useState<RT[] | null>(null);
  const [reviews, setReviews] = useState<RoomTypeReviews | null>(null);

  useEffect(() => {
    catalog.roomTypes().then(setTypes).catch(() => setTypes([]));
  }, []);

  const rtId = types?.find((t) => slugify(t.name) === slug)?.room_type_id;
  useEffect(() => {
    if (!rtId) return;
    setReviews(null);
    catalog.roomTypeReviews(rtId).then(setReviews).catch(() => setReviews(null));
  }, [rtId]);

  if (!types) {
    return (
      <div className="page container" style={{ paddingTop: 100 }}>
        <Spinner />
      </div>
    );
  }

  const rt = types.find((t) => slugify(t.name) === slug);
  if (!rt) {
    return (
      <div className="page container section">
        <BackLink to="/rooms" label={t("rooms.allRooms")} />
        <h1 style={{ marginTop: 16 }}>{t("rooms.notFound")}</h1>
      </div>
    );
  }

  const f = roomFacts(rt.room_type_id);
  const amenities = roomAmenities(rt.room_type_id);
  const rating = Number(rt.avg_rating) || 0;

  return (
    <div className="page">
      <section className="imghero" style={{ minHeight: "62vh" }}>
        <img className="imghero__img" src={roomPhoto(rt.room_type_id)} alt={rt.name} />
        <div className="container imghero__inner">
          <Reveal>
            <p className="eyebrow">{t("rooms.title")}</p>
            <div className="rule" />
            <h1>{rt.name}</h1>
            <p className="lede">{roomTagline(rt.room_type_id)}</p>
          </Reveal>
        </div>
      </section>

      <section className="section container" style={{ maxWidth: 820 }}>
        <BackLink to="/rooms" label={t("rooms.allRooms")} />
        <div className="grid grid-2" style={{ marginTop: 20, alignItems: "start" }}>
          <div>
            <p className="lede">{roomNote(rt.room_type_id)}</p>
            {f && (
              <p className="roommeta" style={{ marginTop: 16 }}>
                <span>{f.size}</span>
                <span>{t("rooms.upToGuests", { n: rt.max_occupancy })}</span>
                <span>{f.bed}</span>
                <span>{f.view} view</span>
              </p>
            )}
            {rt.review_count > 0 && (
              <p className="row" style={{ gap: 10, marginTop: 14 }}>
                <Stars value={rating} showValue size={15} />
                <span className="muted" style={{ fontSize: 14 }}>
                  {t(ratingWordKey(rating))} ·{" "}
                  {t("rooms.reviewCount", { n: rt.review_count, ns: rt.review_count > 1 ? "s" : "" })}
                </span>
              </p>
            )}
            <p className="muted" style={{ marginTop: 14 }}>
              {t("rooms.fromPrice")}{" "}
              <strong>฿{Number(rt.base_price_per_night).toLocaleString()}</strong>{" "}
              {t("rooms.perNight")}
            </p>
            <Link to={`/book?rt=${rt.room_type_id}`} className="btn btn--gold" style={{ marginTop: 22 }}>
              {t("hero.availability")}
            </Link>
          </div>
          <div>
            <h3 style={{ marginBottom: 12 }}>{t("rooms.inTheRoom")}</h3>
            <ul className="tick">
              {amenities.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section section--alt">
        <div className="container" style={{ maxWidth: 820 }}>
          <Reveal>
            <p className="eyebrow">{t("rooms.guestReviews")}</p>
            <div className="rule" />
          </Reveal>

          {!reviews && <Spinner />}

          {reviews && reviews.count === 0 && (
            <p className="lede" style={{ marginTop: 12 }}>
              {t("rooms.noReviewsYet")}
            </p>
          )}

          {reviews && reviews.count > 0 && (
            <>
              <div className="reviews__head" style={{ marginTop: 12 }}>
                <span className="reviews__score">{Number(reviews.average).toFixed(1)}</span>
                <span>
                  <Stars value={reviews.average} size={18} />
                  <br />
                  <span className="muted" style={{ fontSize: 14 }}>
                    {t(ratingWordKey(reviews.average))} ·{" "}
                    {t("rooms.reviewCount", { n: reviews.count, ns: reviews.count > 1 ? "s" : "" })}
                  </span>
                </span>
              </div>

              <div className="reviews__dist">
                {[5, 4, 3, 2, 1].map((s) => {
                  const nn = reviews.distribution[String(s)] ?? 0;
                  const pct = reviews.count ? (nn / reviews.count) * 100 : 0;
                  return (
                    <div key={s} className="reviews__distrow">
                      <span>{t("rooms.starLabel", { n: s })}</span>
                      <span className="reviews__bar">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <span style={{ textAlign: "right" }}>{nn}</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 24 }}>
                {reviews.items
                  .filter((r) => r.comment)
                  .slice(0, 8)
                  .map((r, i) => (
                    <div key={i} className="reviewcard">
                      <Stars value={r.rating} size={14} />
                      <p style={{ marginTop: 8 }}>{r.comment}</p>
                      <div className="reviewcard__meta">
                        <span>{r.guest_name}</span>
                        <span aria-hidden>·</span>
                        <span>{fmtDate(r.created_at.slice(0, 10), lang)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
