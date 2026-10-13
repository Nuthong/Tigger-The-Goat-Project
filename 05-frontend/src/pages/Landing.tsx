import { Link } from "react-router-dom";
import { Reveal } from "../components/Reveal";
import { Photo } from "../components/Photo";
import { Logo } from "../components/Logo";
import { HeroMontage } from "../components/HeroMontage";
import { useAuth } from "../auth/AuthContext";
import { useT } from "../i18n/I18n";
import { HERO, HERO_CLIPS, CITY_NIGHT } from "../lib/images";
import { roomPhoto } from "../lib/rooms";

export function Landing() {
  const { user, isStaff } = useAuth();
  const { t } = useT();

  return (
    <div className="page">
      {/* montage hero - short city clips cut together, ~3s each; degrades to the still */}
      <section className="imghero imghero--center">
        <img className="imghero__img" src={HERO} alt="" />
        <HeroMontage clips={HERO_CLIPS} poster={HERO} />
        <div className="container imghero__inner">
          <Reveal>
            <h1 className="sr-only">Tigger Oriental - a hotel in the heart of Bangkok</h1>
            <Logo className="imghero__logo" />
            <div className="row" style={{ marginTop: 34 }}>
              <Link to="/book" className="btn btn--gold">
                {t("hero.availability")}
              </Link>
              <Link
                to={user ? "/bookings" : "/login"}
                className="btn btn--outline"
                style={{ color: "#fff" }}
              >
                {user ? t("hero.account") : t("hero.signIn")}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* the house - what this place is */}
      <section className="section">
        <div className="container container--wide">
          <div className="grid grid-2" style={{ gap: 56, alignItems: "start" }}>
            <Reveal>
              <p className="eyebrow">The house</p>
              <div className="rule" />
              <h2 style={{ maxWidth: "16ch" }}>A hotel that has always belonged to Bangkok.</h2>
            </Reveal>
            <Reveal delay={90}>
              <p className="lede" style={{ marginTop: 4 }}>
                We opened when the road outside was still lit by lamp. The city
                grew up around the door, and it still sets the pace of the place -
                early meetings, long lunches, the streets picking up again after
                dark.
              </p>
              <p className="muted" style={{ marginTop: 18 }}>
                Every room is finished by hand and held against real bookings and
                housekeeping status, so what you see open is genuinely open. Your
                room number is set at check-in, by the people who know which rooms
                catch the evening light.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* full-bleed band - the city at night */}
      <section className="imghero imghero--quote">
        <img className="imghero__img" src={CITY_NIGHT} alt="" />
        <div className="container imghero__inner">
          <Reveal>
            <p className="imghero__quote">
              &ldquo;Step out of the door and the whole city is already there.&rdquo;
            </p>
            <p className="imghero__cite">- on the location, from a letter left at the desk</p>
          </Reveal>
        </div>
      </section>

      {/* the address - the neighbourhood */}
      <section className="section section--alt">
        <div className="container container--wide">
          <Reveal>
            <p className="eyebrow">The address</p>
            <div className="rule" />
            <h2 style={{ maxWidth: "20ch" }}>Step out of the lobby and you are already somewhere.</h2>
          </Reveal>
          <div className="grid grid-3" style={{ marginTop: 44, gap: 36 }}>
            <Reveal>
              <h3>The transit</h3>
              <p className="muted" style={{ marginTop: 10 }}>
                A covered walk to the BTS in two minutes, the airport rail link a
                short hop past that - the whole city without a taxi.
              </p>
            </Reveal>
            <Reveal delay={80}>
              <h3>The offices &amp; the shops</h3>
              <p className="muted" style={{ marginTop: 10 }}>
                The business district on the doorstep, and three of the city's big
                malls within a ten-minute walk.
              </p>
            </Reveal>
            <Reveal delay={160}>
              <h3>After dark</h3>
              <p className="muted" style={{ marginTop: 10 }}>
                Night markets, a jazz bar two lanes over, and the skyline lit up
                from the rooftop.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* the house in numbers */}
      <section className="section">
        <div className="container container--wide">
          <div className="statrow">
            <Reveal>
              <div className="stat">
                <div className="stat__n">155</div>
                <div className="stat__l">rooms &amp; suites, across nine floors</div>
              </div>
            </Reveal>
            <Reveal delay={70}>
              <div className="stat">
                <div className="stat__n">1876</div>
                <div className="stat__l">the year the first guest signed the book</div>
              </div>
            </Reveal>
            <Reveal delay={140}>
              <div className="stat">
                <div className="stat__n">2</div>
                <div className="stat__l">restaurants and a rooftop bar</div>
              </div>
            </Reveal>
            <Reveal delay={210}>
              <div className="stat">
                <div className="stat__n">24h</div>
                <div className="stat__l">front desk, concierge and room service</div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* rooms - a teaser, not the whole catalogue */}
      <section className="section section--alt">
        <div className="container container--wide">
          <div className="grid grid-2" style={{ gap: 48, alignItems: "center" }}>
            <Reveal>
              <Link to="/rooms">
                <Photo src={roomPhoto(5)} alt="Oriental Suite" ratio="3x2" />
              </Link>
            </Reveal>
            <Reveal delay={90}>
              <p className="eyebrow">The rooms</p>
              <div className="rule" />
              <h2 style={{ maxWidth: "16ch" }}>Five ways to look at the city.</h2>
              <p className="lede" style={{ marginTop: 14 }}>
                From a quiet room over the avenue to a suite on the top floor -
                each one held against real availability.
              </p>
              <div className="row" style={{ marginTop: 24, gap: 22 }}>
                <Link to="/rooms" className="btn btn--outline">
                  Explore rooms &amp; suites
                </Link>
                <Link to="/book" className="link-arrow">
                  Check availability
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* dark band - staff */}
      <section className="section section--dark">
        <div className="container center">
          <Reveal>
            <p className="eyebrow">For the front desk</p>
            <div className="rule" />
            <h2 style={{ color: "var(--on-dark)", maxWidth: "20ch", marginInline: "auto" }}>
              A portal built for a busy lobby.
            </h2>
            <p className="lede" style={{ maxWidth: "44ch", margin: "18px auto 0" }}>
              Book for a guest, take payment, move a room through its day, and watch
              revenue and occupancy update live - every action written to an audit log.
            </p>
            {isStaff && (
              <div className="row" style={{ justifyContent: "center", marginTop: 28 }}>
                <Link to="/admin" className="btn btn--gold">
                  Open the portal
                </Link>
              </div>
            )}
          </Reveal>
        </div>
      </section>
    </div>
  );
}
