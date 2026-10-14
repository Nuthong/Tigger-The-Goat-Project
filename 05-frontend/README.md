# Tigger Oriental — Room Booking web client

React 18 + Vite + TypeScript SPA for the `04-backend` API.
Design: an editorial, Mandarin-Oriental-inspired guest site (serif display, warm off-white, gold accent)
+ a dense staff portal. The original pre-build spec is [`design/ui-ux.md`](design/ui-ux.md).

**Verified:** `tsc --noEmit && vite build` passes and the app runs — the full stack
(`06-deploy/docker-compose.yml`) was brought up on `http://localhost:8081` and
login / search / bookings / dashboard were exercised against the live API.

## Run (dev)

```bash
cd 05-frontend
npm install
cp .env.example .env.local          # defaults are fine for local
npm run dev                         # http://localhost:5173
```

Vite proxies `/api` → `http://localhost:8000` (the FastAPI server), so start the backend too:

```bash
cd ../04-backend && make dev
```

Then sign in with a seed account (password `Passw0rd!2026`): `manager01`, `recep01`, `somchai`.

## Checks

```bash
npm run typecheck     # tsc --noEmit, strict
npm run lint          # eslint (flat config)
npm test              # vitest — 81 unit tests for lib/ helpers (format, validation, filters, csv, …)
npm run build         # tsc -b && vite build  -> dist/
```

## Deploy

- **Vercel / Netlify:** build command `npm run build`, output `dist`, set `VITE_API_BASE` to the API origin (e.g. `https://<api>.onrender.com/api/v1`). The API's `CORS_ORIGINS` must then include the site origin.
- **Docker (with the API behind nginx):** `docker build -t roombooking-web .` → serves `dist` on :80 and proxies `/api` to the `api` service (see `nginx.conf`).

## Structure

```
src/
├── main.tsx / App.tsx        router + shell; providers: ErrorBoundary → Auth → Toast → Dialog
├── styles/
│   ├── global.css            the guest-site design system (tokens + utilities)
│   └── admin.css             the staff-portal shell
├── lib/
│   ├── api.ts                fetch client: in-memory access token, one-shot 401 refresh + replay,
│   │                         `auth:expired` event on hard logout, typed endpoints
│   ├── types.ts              API DTOs
│   ├── format.ts             money / date / booking-ref / status-label helpers
│   ├── validation.ts         shared form guards (todayISO, isPastDate, toPositiveAmount,
│   │                         clampInt, isSafeNext) — mirror the server's Pydantic rules
│   ├── rooms.ts              per-room-type editorial copy + facts, keyed by room_type_id
│   └── images.ts             hero / room photo sources
├── auth/AuthContext.tsx      session: resume via refresh cookie, login/register/logout,
│                             role flags (isStaff, canFrontDesk, canHousekeeping, …)
├── components/
│   ├── Modal.tsx             one focus-trapping dialog primitive (Esc, scroll-lock, focus restore)
│   ├── ConfirmDialog.tsx     DialogProvider + useConfirm() / usePrompt() — replace window.confirm/prompt
│   ├── ToastProvider.tsx     useToast(): success / error / info notifications
│   ├── ErrorBoundary.tsx     render-crash recovery screen (no white page)
│   ├── ProtectedRoute.tsx    auth + per-role route guard (staff / frontdesk / housekeeping /
│   │                         accounting / manager / admin)
│   ├── Stars.tsx             read-only fractional star rating + ratingWord()
│   ├── NavBar · Footer · Logo · BackLink · Reveal · Photo · HeroMontage · Donut
│   └── ui.tsx                Field, Money, StatusTag, ChipBar, Alert, Spinner
├── pages/                    guest site
│   ├── Landing               marketing hero + bands
│   ├── Rooms · RoomType      room catalogue; RoomType shows the score, star distribution
│   │                         and recent guest reviews (`/room-types/{id}/reviews`)
│   ├── Login · Register      sign in by username / email / phone; register enforces the
│   │                         username pattern + confirm-password; safe `?next=` only
│   ├── Search                /book — auto-searches on landing; room-type / adults / children /
│   │                         view / sort filters live in the search card; sort by price / rating /
│   │                         popularity; the Room dropdown and "Check availability" links both
│   │                         drive `?rt=<id>` to focus one room type
│   ├── ConfirmReservation    /book/confirm — two-column review: stay summary (rooms + adults +
│   │                         children) + itemised booking-details card + agree-to-terms, then books
│   ├── Payment               /book/pay/:bookingId — guest pays the balance online while the room
│   │                         is held (live "held for MM:SS" countdown)
│   ├── Bookings              filterable list, ownership-scoped by the API
│   ├── BookingDetail         bill + contextual actions (check-in/out, cancel, pay, reschedule); the
│   │                         review form is shown once, then the submitted review read-only
│   └── NotFound
├── print/                    printable documents (save as PDF): tax invoice, guest folio,
│                             housekeeping daily sheet (`v_housekeeping_board`)
├── i18n/I18n.tsx             English / ไทย switch for the whole site (guest + staff)
└── admin/                    staff portal (/admin) — AdminLayout shell + role-gated routes
    ├── Overview              manager: revenue donut + occupancy table
    ├── TapeChart             reservation tape (rooms × days): month/year band, "Mon."-style day
    │                         labels, from/to date range, Fit/S/M/L column width (Fit auto-sizes to
    │                         the window), live 24h clock, per-user view saved to localStorage
    ├── BookingsAdmin · NewBooking   front desk: list + create (capacity / past-date guards)
    ├── InHouse               front desk: every occupied room right now (`v_current_guests`)
    ├── RoomsAdmin            room status board (confirm before maintenance / closed)
    ├── GuestsAdmin · GuestDetail   customer directory (search + paginated — 1000 seed guests)
    │                         + one guest's profile, ID record and stays
    ├── Housekeeping · Maintenance   cleaning board + engineering tickets
    ├── Reviews               guest-feedback board: score, distribution, filter by stars
    ├── RatePlans · RateCalendar   rate-plan CRUD + price checker; month grid of the effective
    │                         nightly rate (`fn_quote_room`)
    ├── Services              add-on catalog: price, retire (never delete), units sold
    ├── Reports               manager: revenue mix, occupancy + yield, forward book, CSV export
    ├── Invoices · DailyRevenue   accounting: ledger + invoice viewer / void; room revenue
    │                         night by night (`v_daily_revenue`)
    ├── Users                 admin: staff role change; customer accounts are role-locked —
    │                         disable or delete only; never yourself
    ├── SecurityLog           admin: sign-in activity (`auth_event`)
    └── Audit                 manager: audit trail
```

## Assets

- `public/hero-1.mp4` … `public/hero-5.mp4` — the full-bleed landing hero **montage**: five
  short Bangkok clips cut together, each held ~3 s with a gentle crossfade, looping
  (`src/components/HeroMontage.tsx`, list in `HERO_CLIPS` in `src/lib/images.ts`). All served
  from the app's own origin — CSP allows `media-src 'self'`. Wat Arun from the river
  (Wikimedia Commons, **CC BY-SA 4.0**, credited in the site footer) + four **Mixkit** clips
  (skyline at dusk, night lights, wok stir-fry, silk) — sources and licences in
  [`HERO-VIDEOS.md`](HERO-VIDEOS.md). 720p H.264, ~3–5 MB each.
  The montage has a still poster (`HERO` in `src/lib/images.ts`) and degrades to that image if
  `prefers-reduced-motion` is set; a clip that fails to load is skipped on the next cut.
  **Swap in the property's own footage** — replace the files (keep the `hero-N.mp4` names) or
  edit `HERO_CLIPS`.
- Room photography is placeholder Unsplash URLs — urban Bangkok interiors, keyed by
  `room_type_id` in `src/lib/rooms.ts` (`ROOM_EDITORIAL`); hero/story stills in `src/lib/images.ts`.

## Notes

- **Guests** book for themselves, pay online, reschedule or cancel their own stays, and review
  after check-out. **Staff** book for any guest, take payments at the desk, check in / out and
  move room status.
- `ProtectedRoute` guards `/bookings*` (any auth) and every `/admin/*` route by the role that
  `AdminLayout` shows the link to (front desk / housekeeping / accounting / manager / admin), so a
  deep link can't skip the nav.
- All money is displayed `฿#,###.00`; the API returns decimal strings, the client never does math on money it will send back — it echoes the API's `balance_due`.
- **Client guardrails mirror the server's rules** so a control is disabled before a doomed request
  goes out: no check-in date in the past, guests ≤ room capacity, payment `0 < amount ≤ balance`,
  rate-plan `valid_to ≥ valid_from`, etc. The matching server checks live in
  `04-backend` (`schemas/booking.py`, `services/booking_service.py`, `services/ops_service.py`).
