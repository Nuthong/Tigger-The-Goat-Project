# UI / UX — "Aria"

Design spec for the Room Booking web client. Built before implementation.

**Two surfaces, one system:**
- **Guest site** — editorial, image-forward, **Mandarin-Oriental-inspired** (serif display, warm off-white,
  a single gold accent, full-bleed photography):
  - `/` landing · `/rooms` **presentation** (a section per room category, "View room" / "Check availability")
    · `/rooms/:type` room detail · `/book` the **dated availability → booking** flow (grouped by category)
    · `/bookings` the guest's own stays.
- **Staff portal** (`/admin/*`) — a dense operations console: dark sidebar (268px), a `‹ Back` topbar on
  every page, KPI row, **donut charts** (revenue by type, bookings by status), data-first tables with inline
  actions, a room-status grid, a New booking wizard. Staff hitting a guest route are redirected here.

Photography: placeholder shots from Unsplash keyed by room type (`src/lib/images.ts`); every image sits on
a warm gradient so a failed load still looks deliberate (`components/Photo.tsx`). Swap for the property's own shoot.

---

## 1. Design language

Reference: **apple.com** marketing + account pages.

| Token | Value | Notes |
|---|---|---|
| Type family | `-apple-system, "SF Pro Text/Display", Inter, …` | system font first |
| Display headline | `clamp(40px, 7vw, 80px)`, weight 600, tracking `-0.015em`, line-height 1.07 | hero |
| Section headline | `clamp(30px, 4.6vw, 48px)` | |
| Body | 17px / 1.47 | |
| Ink | `#1d1d1f` on `#fff`; dim `#6e6e73` | |
| Accent | `#0071e3` (hover `#0077ed`) | links + primary buttons only |
| Surfaces | white / `#f5f5f7` alt bands / `#000` "pro" band | full-bleed alternating |
| Radius | 18px cards, **980px pill** buttons | |
| Shadow | `0 4px 24px rgba(0,0,0,.06)`, lift on hover | |
| Motion | one calm `fade + 28px rise` on scroll, `cubic-bezier(.16,1,.3,1)`, ~0.9s | honours `prefers-reduced-motion` |
| Nav | 48px, sticky, `rgba(255,255,255,.72)` + `backdrop-filter: blur(20px)` | |
| Content width | 980px (text) / 1200px (grids) | centered, 22px gutters |

All of the above lives in `../src/styles/global.css` as CSS custom properties + utility classes. No CSS framework.

---

## 2. Screens & wireframes

### 2.1 Landing `/`  (public)

```
┌ nav: Aria · Find a room · Sign in ─────────────────────────┐
│                                                            │
│                    Stay, simply.               (hero)      │
│         Real-time availability, one-tap booking…           │
│              [ Find a room ]   Sign in ›                   │
│                                                            │
├─ alt band ────────────────────────────────────────────────┤
│   Only the rooms that are actually free.                   │
│   ┌ Live availability ┐ ┌ Transparent bills ┐ ┌ History ┐  │
│   └──────────────────┘ └──────────────────┘ └─────────┘   │
├─ dark band  "For the front desk" ─────────────────────────┤
│   Check-in to check-out, in a few clicks.                  │
│   ┌ Role-aware ┐ ┌ Audited ┐ ┌ Reporting ┐                 │
├─ closing CTA ─────────────────────────────────────────────┤
│            Ready when you are.                             │
│       [ Find a room ]  [ Create an account ]               │
└───────────────────────────────────────────────────────────┘
```

### 2.2 Sign in `/login` · Register `/register`
Narrow (380–420px) centered column. Label-above inputs, focus ring in accent, pill submit.
Login page lists the seed demo accounts.

### 2.3 Find a room `/search`  (public; booking action = staff only)

```
Pick your dates.
┌ card ───────────────────────────────────────┐
│  Check in [date]   Check out [date]  [Search]│
└─────────────────────────────────────────────┘
  3 nights

┌ Standard ┐  ┌ Deluxe ┐  ┌ Suite ┐        (grid of room cards)
│ Room 101 │  │Room 203│  │Room 304│
│ Sleeps 2 │  │Sleeps 3│  │Sleeps 2│
│ ฿900/nt  │  │฿1,800  │  │฿3,800  │
│ [Book]*  │  │ [Book]*│  │ [Book]*│   * staff only; guests see a note
└──────────┘  └────────┘  └────────┘
```
Staff "Book" → modal: guest customer ID + guests → `POST /bookings` → go to detail.

### 2.4 Bookings `/bookings`
Filter pills (all / pending / confirmed / checked_in / checked_out / cancelled).
Table: `# · stay · rooms · guests · status pill · Open ›`.
Customer sees only their own rows (server-enforced); staff sees all.

### 2.5 Booking detail `/bookings/:id`
Two cards: **Rooms/Extras** and **Bill** (rooms · nights, extras, − paid, **Balance due**).
Actions card (contextual):
- staff + `confirmed` → **Check in**
- staff + `checked_in` → **Check out**
- staff/owner + `pending|confirmed` → **Cancel** (danger)
- staff + balance > 0 → payment row (amount + method → `POST …/payments`)
- owner + `checked_out` → review (rating + comment → `POST …/review`)

### 2.6 Staff portal `/admin/*`  (receptionist + manager)

Dark sticky sidebar (Overview · Bookings · Rooms · Guests) + warm content area. `/dashboard` redirects here.

- **Overview** — 4 KPIs (in-house now · arrivals expected · revenue · latest occupancy),
  revenue-by-room-type bars, a "today: arrivals & in-house" table, monthly occupancy.
- **Bookings** — full management table: status filter pills, pagination, **inline actions per row**
  (Check in / Check out / Cancel) that call the API and refresh in place. Row → booking detail.
- **Rooms** — status grid grouped by floor; each tile shows number + status dot; click → set
  available / maintenance / closed (writes `room_status_log`).
- **Guests** — searchable directory from `GET /customers`: trips + lifetime value, ordered by value.

---

## 3. User flows

**Guest books a stay (via desk)**
`/search` → choose dates → see rooms → (guest asks desk) → staff signs in →
`/search` book modal → `/bookings/:id` → take payment → check in → check out → guest reviews.

**Manager reviews performance**
sign in → `/dashboard` → revenue bars + occupancy table.

**Returning guest**
open app → silent refresh via cookie → `/bookings` shows their trips.

---

## 4. Accessibility & states

- Every input has a visible `<label>`; focus ring is a 4px accent halo.
- Buttons show a spinner + `disabled` while a request is in flight.
- Errors render in a red inline `.alert`; success in green.
- `prefers-reduced-motion`: reveals appear instantly, smooth-scroll off.
- Colour is never the only signal — status also carries text.

---

## 5. Security posture (UI side — see `../../SECURITY.md` §3)

- Access token in memory only; refresh token is an `HttpOnly` cookie.
- One silent refresh + replay on a `401`, then bounce to `/login`.
- No `dangerouslySetInnerHTML`. No secrets in the bundle (only `VITE_API_BASE`).
- `ProtectedRoute` gates `/bookings*` (auth) and `/dashboard` (manager).
