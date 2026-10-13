/**
 * Tiny typed fetch client for the Room Booking API.
 *
 * - Same-origin: prod serves the SPA behind nginx which proxies `/api` → FastAPI;
 *   dev uses the Vite proxy (see vite.config.ts). Base path comes from
 *   `VITE_API_BASE` (default `/api/v1`).
 * - Auth: short-lived access token kept in memory (never localStorage); the
 *   refresh token is an httpOnly cookie, so every call sends `credentials`.
 * - Errors: any non-2xx throws `ApiError` carrying the server's `detail`/`code`.
 */
import type {
  AccessToken,
  AdminReviewRow,
  AuditRow,
  AuthEventRow,
  AuthEventStats,
  AvailableRoom,
  AvailableRoomType,
  Bill,
  Booking,
  BookingStatusCounts,
  CustomerDetail,
  CustomerRow,
  CustomerSummary,
  DailyRevenueRow,
  ForecastRow,
  HousekeepingBoardRow,
  HousekeepingTask,
  InHouseRow,
  Invoice,
  InvoiceLedgerStats,
  InvoiceRow,
  MaintenanceBacklogRow,
  MaintenanceTicket,
  OccupancyRow,
  Page,
  Quote,
  RateCalRow,
  RatePlan,
  Review,
  ReviewStats,
  RevenueRow,
  Room,
  RoomStatusLogRow,
  RoomType,
  RoomTypeReviews,
  Service,
  ServiceCatalogRow,
  StaffOption,
  User,
  UserRow,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

let accessToken: string | null = null;

/** Set (or clear) the in-memory access token used for `Authorization`. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Fired once when a request 401s and the refresh cookie can no longer mint a new
 * access token. `AuthContext` listens for it to drop the user to logged-out so
 * `ProtectedRoute` can bounce to `/login` - instead of every screen showing a
 * raw "Request failed (401)".
 */
export const AUTH_EXPIRED_EVENT = "auth:expired";

/** In-flight refresh, shared so a burst of 401s triggers only one refresh call. */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = auth.refresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** Column filters from an "Advanced filters" panel, sent as-is (blank = off). */
export type ColumnFilters = Record<string, string>;

function qs(params?: Query): string {
  if (!params) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

interface Options {
  method?: string;
  body?: unknown;
  query?: Query;
  auth?: boolean;
}

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = opts;

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    return fetch(`${BASE}${path}${qs(query)}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let res: Response;
  try {
    res = await doFetch();
    // Access token likely expired mid-session: silently refresh once and replay.
    if (res.status === 401 && auth) {
      if (await tryRefresh()) {
        res = await doFetch();
      } else {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
    }
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0, "network");
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload: unknown = text ? safeJson(text) : null;

  if (!res.ok) {
    const detail =
      (isRecord(payload) && typeof payload.detail === "string" && payload.detail) ||
      `Request failed (${res.status})`;
    const code =
      (isRecord(payload) && typeof payload.code === "string" && payload.code) || "error";
    throw new ApiError(detail, res.status, code);
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/* ================================================================== auth */

export const auth = {
  async login(username: string, password: string): Promise<AccessToken> {
    const t = await request<AccessToken>("/auth/login", {
      method: "POST",
      auth: false,
      body: { username, password },
    });
    setAccessToken(t.access_token);
    return t;
  },

  async register(body: {
    username: string;
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    phone?: string;
  }): Promise<AccessToken> {
    const t = await request<AccessToken>("/auth/register", {
      method: "POST",
      auth: false,
      body,
    });
    setAccessToken(t.access_token);
    return t;
  },

  /** Exchange the refresh cookie for a fresh access token. Returns false when
   *  there is no valid session (so the app can render as logged-out). */
  async refresh(): Promise<boolean> {
    try {
      const t = await request<AccessToken>("/auth/refresh", {
        method: "POST",
        auth: false,
      });
      setAccessToken(t.access_token);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    }
  },

  me(): Promise<User> {
    return request<User>("/auth/me");
  },

  updateProfile(body: {
    first_name?: string;
    last_name?: string;
    phone?: string | null;
  }): Promise<User> {
    return request<User>("/auth/me", { method: "PATCH", body });
  },

  async logout(): Promise<void> {
    await request<unknown>("/auth/logout", { method: "POST" });
    setAccessToken(null);
  },

  changePassword(current_password: string, new_password: string): Promise<void> {
    return request<void>("/auth/change-password", {
      method: "POST",
      body: { current_password, new_password },
    });
  },
};

/* =============================================================== catalog */

export const catalog = {
  roomTypes(): Promise<RoomType[]> {
    return request<RoomType[]>("/room-types");
  },

  typeAvailability(checkIn: string, checkOut: string): Promise<AvailableRoomType[]> {
    return request<AvailableRoomType[]>("/room-types/availability", {
      query: { check_in: checkIn, check_out: checkOut },
    });
  },

  roomTypeReviews(roomTypeId: number): Promise<RoomTypeReviews> {
    return request<RoomTypeReviews>(`/room-types/${roomTypeId}/reviews`, { auth: false });
  },

  rooms(params: { status?: string; limit?: number; offset?: number } = {}): Promise<Page<Room>> {
    return request<Page<Room>>("/rooms", { query: params });
  },

  roomAvailability(checkIn: string, checkOut: string): Promise<AvailableRoom[]> {
    return request<AvailableRoom[]>("/rooms/availability", {
      query: { check_in: checkIn, check_out: checkOut },
    });
  },

  createRoom(body: {
    room_number: string;
    floor: number;
    room_type_id: number;
    note?: string;
  }): Promise<Room> {
    return request<Room>("/rooms", { method: "POST", body });
  },

  setRoomStatus(roomId: number, status: string): Promise<Room> {
    return request<Room>(`/rooms/${roomId}/status`, { method: "PATCH", body: { status } });
  },

  /** Who moved this room between statuses, and when - newest first. */
  roomStatusLog(roomId: number, limit = 12): Promise<RoomStatusLogRow[]> {
    return request<RoomStatusLogRow[]>(`/rooms/${roomId}/status-log`, { query: { limit } });
  },

  /** Manager edits a category's list price, description or capacity. */
  updateRoomType(
    roomTypeId: number,
    body: { description?: string | null; base_price_per_night?: string; max_occupancy?: number },
  ): Promise<RoomType> {
    return request<RoomType>(`/room-types/${roomTypeId}`, { method: "PATCH", body });
  },
};

/* ============================================================== services */

export const services = {
  /** Public - the active add-ons a stay can carry. */
  list(): Promise<Service[]> {
    return request<Service[]>("/services", { auth: false });
  },
  /** Manager - every service, retired ones too, with units sold and revenue. */
  catalog(): Promise<ServiceCatalogRow[]> {
    return request<ServiceCatalogRow[]>("/services/catalog");
  },
  create(body: {
    name: string;
    price: string;
    description?: string | null;
    is_active?: boolean;
  }): Promise<Service> {
    return request<Service>("/services", { method: "POST", body });
  },
  update(
    id: number,
    body: { name?: string; price?: string; description?: string | null; is_active?: boolean },
  ): Promise<Service> {
    return request<Service>(`/services/${id}`, { method: "PATCH", body });
  },
};

/* ============================================================== bookings */

export interface BookingCreate {
  customer_id?: number;
  check_in_date: string;
  check_out_date: string;
  num_guests?: number;
  note?: string;
  rooms: { room_id?: number; room_type_id?: number }[];
  services?: { service_id: number; quantity?: number }[];
}

type Transition = "check-in" | "check-out" | "cancel" | "no-show";

export const bookings = {
  list(
    status?: string,
    params: {
      limit?: number;
      offset?: number;
      arriving_on?: string;
      departing_on?: string;
      stay_from?: string;
      stay_to?: string;
      room_type_id?: number;
      payment_status?: "paid" | "unpaid";
      min_guests?: number;
      max_guests?: number;
      q?: string;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<Booking>> {
    return request<Page<Booking>>("/bookings", { query: { status, ...params, ...filters } });
  },

  get(id: number): Promise<Booking> {
    return request<Booking>(`/bookings/${id}`);
  },

  bill(id: number): Promise<Bill> {
    return request<Bill>(`/bookings/${id}/bill`);
  },

  create(body: BookingCreate): Promise<Booking> {
    return request<Booking>("/bookings", { method: "POST", body });
  },

  transition(id: number, action: Transition): Promise<Booking> {
    return request<Booking>(`/bookings/${id}/${action}`, { method: "POST" });
  },

  /** How many bookings sit in each lifecycle status (whole book, or the caller's
   *  own for a guest) - one aggregate call, not a full listing. */
  statusCounts(): Promise<BookingStatusCounts> {
    return request<BookingStatusCounts>("/bookings/status-counts");
  },

  /** Front desk moves a pending / confirmed booking to a new date window. */
  reschedule(
    id: number,
    body: { check_in_date: string; check_out_date: string },
  ): Promise<Booking> {
    return request<Booking>(`/bookings/${id}/dates`, { method: "PATCH", body });
  },

  pay(id: number, body: { amount: string | number; method: string; reference_no?: string }) {
    return request<unknown>(`/bookings/${id}/payments`, { method: "POST", body });
  },

  /** Guest checkout - clears the whole outstanding balance in one online payment. */
  settle(id: number, body: { method: string; reference_no?: string }): Promise<Bill> {
    return request<Bill>(`/bookings/${id}/pay`, { method: "POST", body });
  },

  /** Front desk posts an add-on to an open folio (price locked now). */
  addService(id: number, body: { service_id: number; quantity?: number }): Promise<Booking> {
    return request<Booking>(`/bookings/${id}/services`, { method: "POST", body });
  },

  /** Take an add-on off an open folio; anything paid for it is refunded. */
  removeService(id: number, serviceId: number): Promise<Booking> {
    return request<Booking>(`/bookings/${id}/services/${serviceId}`, { method: "DELETE" });
  },

  review(id: number, body: { rating: number; comment?: string }) {
    return request<Review>(`/bookings/${id}/review`, { method: "POST", body });
  },

  /** The review left for this stay, or null when there isn't one yet. */
  async getReview(id: number): Promise<Review | null> {
    try {
      return await request<Review>(`/bookings/${id}/review`);
    } catch {
      return null;
    }
  },
};

/* ============================================================= customers */

export const customers = {
  list(
    params: {
      q?: string;
      limit?: number;
      offset?: number;
      joined_from?: string;
      joined_to?: string;
      min_ltv?: number;
      max_ltv?: number;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<CustomerRow>> {
    return request<Page<CustomerRow>>("/customers", { query: { ...params, ...filters } });
  },
  get(id: number): Promise<CustomerDetail> {
    return request<CustomerDetail>(`/customers/${id}`);
  },
  /** Front desk corrects contact details or records the ID / passport number. */
  update(
    id: number,
    body: {
      first_name?: string;
      last_name?: string;
      phone?: string | null;
      id_card_no?: string | null;
    },
  ): Promise<CustomerDetail> {
    return request<CustomerDetail>(`/customers/${id}`, { method: "PATCH", body });
  },
  /** Loyalty figures for the signed-in guest - one query, not every booking. */
  mySummary(): Promise<CustomerSummary> {
    return request<CustomerSummary>("/customers/me/summary");
  },
};

/* =============================================================== reports */

export const reports = {
  revenueByRoomType(): Promise<RevenueRow[]> {
    return request<RevenueRow[]>("/reports/revenue-by-room-type");
  },
  occupancy(): Promise<OccupancyRow[]> {
    return request<OccupancyRow[]>("/reports/occupancy");
  },
  dailyRevenue(params: { from?: string; to?: string } = {}): Promise<DailyRevenueRow[]> {
    return request<DailyRevenueRow[]>("/reports/daily-revenue", { query: params });
  },
  forecast(days?: number): Promise<ForecastRow[]> {
    return request<ForecastRow[]>("/reports/forecast", { query: { days } });
  },
  rateCalendar(month?: string): Promise<RateCalRow[]> {
    return request<RateCalRow[]>("/reports/rate-calendar", { query: { month } });
  },
  /** Every occupied room right now (reads `v_current_guests`). */
  inHouse(): Promise<InHouseRow[]> {
    return request<InHouseRow[]>("/reports/in-house");
  },
};

/* ========================================================== housekeeping */

export const housekeeping = {
  tasks(
    params: {
      day?: string;
      status?: string;
      room_id?: number;
      task_type?: string;
      assigned_to?: number;
    } = {},
  ): Promise<HousekeepingTask[]> {
    return request<HousekeepingTask[]>("/housekeeping/tasks", { query: params });
  },
  create(body: {
    room_id: number;
    task_type?: string;
    scheduled_for?: string;
    assigned_to?: number;
    note?: string;
  }): Promise<HousekeepingTask> {
    return request<HousekeepingTask>("/housekeeping/tasks", { method: "POST", body });
  },
  update(taskId: number, body: Record<string, unknown>): Promise<HousekeepingTask> {
    return request<HousekeepingTask>(`/housekeeping/tasks/${taskId}`, { method: "PATCH", body });
  },
  /** The printable daily sheet (reads `v_housekeeping_board`). */
  board(day?: string): Promise<HousekeepingBoardRow[]> {
    return request<HousekeepingBoardRow[]>("/housekeeping/board", { query: { day } });
  },
  autoAssign(
    day?: string,
  ): Promise<{ assigned: number; by_staff: { staff_id: number; name: string; count: number }[] }> {
    return request("/housekeeping/auto-assign", { method: "POST", query: { day } });
  },
};

/* =========================================================== maintenance */

export const maintenance = {
  tickets(
    params: {
      status?: string;
      open_only?: boolean;
      category?: string;
      priority?: string;
      room_id?: number;
      date_from?: string;
      date_to?: string;
    } = {},
  ): Promise<MaintenanceTicket[]> {
    return request<MaintenanceTicket[]>("/maintenance/tickets", { query: params });
  },
  /** Open tickets with their age in days (reads `v_maintenance_open`). */
  backlog(): Promise<MaintenanceBacklogRow[]> {
    return request<MaintenanceBacklogRow[]>("/maintenance/backlog");
  },
  report(body: {
    room_id?: number;
    category?: string;
    priority?: string;
    title: string;
    description?: string;
  }): Promise<MaintenanceTicket> {
    return request<MaintenanceTicket>("/maintenance/tickets", { method: "POST", body });
  },
  update(ticketId: number, body: Record<string, unknown>): Promise<MaintenanceTicket> {
    return request<MaintenanceTicket>(`/maintenance/tickets/${ticketId}`, {
      method: "PATCH",
      body,
    });
  },
};

/* ============================================================ rate plans */

export const ratePlans = {
  list(params: { active_only?: boolean } = {}): Promise<RatePlan[]> {
    return request<RatePlan[]>("/rate-plans", { query: params });
  },
  quote(roomTypeId: number, checkIn: string, checkOut: string): Promise<Quote> {
    return request<Quote>("/rate-plans/quote", {
      query: { room_type_id: roomTypeId, check_in: checkIn, check_out: checkOut },
    });
  },
  create(body: {
    room_type_id: number;
    name: string;
    kind?: string;
    price_per_night: string | number;
    valid_from: string;
    valid_to: string;
    applies_weekday?: boolean;
    applies_weekend?: boolean;
    priority?: number;
    is_active?: boolean;
  }): Promise<RatePlan> {
    return request<RatePlan>("/rate-plans", { method: "POST", body });
  },
  update(
    id: number,
    body: {
      name?: string;
      price_per_night?: string | number;
      priority?: number;
      is_active?: boolean;
    },
  ): Promise<RatePlan> {
    return request<RatePlan>(`/rate-plans/${id}`, { method: "PATCH", body });
  },
  remove(id: number): Promise<void> {
    return request<void>(`/rate-plans/${id}`, { method: "DELETE" });
  },
};

/* ============================================================== invoices */

export const invoices = {
  list(
    params: {
      status?: string;
      unpaid_only?: boolean;
      q?: string;
      limit?: number;
      offset?: number;
      issued_from?: string;
      issued_to?: string;
      min_total?: number;
      max_total?: number;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<InvoiceRow>> {
    return request<Page<InvoiceRow>>("/invoices", { query: { ...params, ...filters } });
  },
  /** Whole-ledger tallies for the header - outstanding across every invoice, not
   *  just the visible page. */
  stats(): Promise<InvoiceLedgerStats> {
    return request<InvoiceLedgerStats>("/invoices/stats");
  },
  get(id: number): Promise<Invoice> {
    return request<Invoice>(`/invoices/${id}`);
  },
  forBooking(bookingId: number): Promise<Invoice> {
    return request<Invoice>(`/bookings/${bookingId}/invoice`);
  },
  issue(
    bookingId: number,
    body: { tax_rate?: string | number; discount?: string | number; note?: string } = {},
  ): Promise<Invoice> {
    return request<Invoice>(`/bookings/${bookingId}/invoice`, { method: "POST", body });
  },
  void(id: number): Promise<Invoice> {
    return request<Invoice>(`/invoices/${id}/void`, { method: "POST" });
  },
};

/* ================================================================= admin */

export const adminApi = {
  staff(role?: string): Promise<StaffOption[]> {
    return request<StaffOption[]>("/admin/staff", { query: { role } });
  },
  users(
    params: {
      kind?: "staff" | "guest";
      q?: string;
      limit?: number;
      offset?: number;
      role?: string;
      is_active?: boolean;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<UserRow>> {
    return request<Page<UserRow>>("/admin/users", { query: { ...params, ...filters } });
  },
  updateUser(
    userId: number,
    body: { role?: string; is_active?: boolean; unlock?: boolean },
  ): Promise<UserRow> {
    return request<UserRow>(`/admin/users/${userId}`, { method: "PATCH", body });
  },
  createEmployee(body: {
    username: string;
    password: string;
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
    role: string;
  }): Promise<UserRow> {
    return request<UserRow>("/admin/users", { method: "POST", body });
  },
  deleteUser(userId: number): Promise<void> {
    return request<void>(`/admin/users/${userId}`, { method: "DELETE" });
  },
  audit(
    params: {
      entity_type?: string;
      action?: string;
      limit?: number;
      offset?: number;
      actor?: string;
      at_from?: string;
      at_to?: string;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<AuditRow>> {
    return request<Page<AuditRow>>("/admin/audit", { query: { ...params, ...filters } });
  },
  reviews(
    params: {
      rating?: number;
      q?: string;
      limit?: number;
      offset?: number;
      created_from?: string;
      created_to?: string;
      room_type_id?: number;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<AdminReviewRow>> {
    return request<Page<AdminReviewRow>>("/admin/reviews", { query: { ...params, ...filters } });
  },
  /** Rating count / average / star split across every review, not just a page. */
  reviewStats(): Promise<ReviewStats> {
    return request<ReviewStats>("/admin/reviews/stats");
  },
  /** The sign-in log (`auth_event`), newest first. */
  authEvents(
    params: {
      event_type?: string;
      q?: string;
      limit?: number;
      offset?: number;
      at_from?: string;
      at_to?: string;
    } = {},
    filters: ColumnFilters = {},
  ): Promise<Page<AuthEventRow>> {
    return request<Page<AuthEventRow>>("/admin/auth-events", {
      query: { ...params, ...filters },
    });
  },
  authEventStats(days = 7): Promise<AuthEventStats> {
    return request<AuthEventStats>("/admin/auth-events/stats", { query: { days } });
  },
};
