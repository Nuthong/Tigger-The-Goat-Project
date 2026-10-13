/**
 * Shared API types - hand-mirrored from the FastAPI response models
 * (04-backend/app/schemas). Money fields arrive as strings (Numeric) and are
 * parsed at the edge with `Number(...)`.
 */

export type Role =
  | "customer"
  | "receptionist"
  | "housekeeping"
  | "accounting"
  | "manager"
  | "admin";

export interface User {
  user_id: number;
  username: string;
  email: string;
  role: Role;
  customer_id: number | null;
  staff_id: number | null;
  is_active: boolean;
  last_login_at: string | null;
  /** present for guest accounts (from the linked customer profile) */
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface AccessToken {
  access_token: string;
  token_type?: string;
  expires_in: number;
}

/* ------------------------------------------------------------------ catalog */

export type RoomStatus = "available" | "cleaning" | "maintenance" | "closed";

export interface RoomType {
  room_type_id: number;
  name: string;
  description: string | null;
  base_price_per_night: string;
  max_occupancy: number;
  /** mean guest rating 1-5, or null until the type has a review */
  avg_rating: string | null;
  review_count: number;
}

export interface ReviewItem {
  rating: number;
  comment: string | null;
  guest_name: string;
  created_at: string;
}

export interface RoomTypeReviews {
  room_type_id: number;
  name: string;
  average: string | null;
  count: number;
  distribution: Record<string, number>; // "1".."5" -> count
  items: ReviewItem[];
}

export interface Review {
  review_id: number;
  booking_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface AdminReviewRow {
  review_id: number;
  booking_id: number;
  customer_name: string;
  room_type: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface AvailableRoomType {
  room_type_id: number;
  name: string;
  description: string | null;
  price_per_night: string;
  base_price_per_night: string;
  max_occupancy: number;
  available_count: number;
  /** mean guest rating 1-5, or null when this type has no reviews yet */
  avg_rating: string | null;
  /** non-cancelled bookings ever made for this type - a popularity signal */
  booking_count: number;
}

export interface Room {
  room_id: number;
  room_number: string;
  floor: number;
  room_type_id: number;
  status: RoomStatus;
  note: string | null;
  /** derived: a guest is checked in right now */
  occupied?: boolean;
}

/** One change of a room's physical status (`room_status_log`). */
export interface RoomStatusLogRow {
  log_id: number;
  room_id: number;
  old_status: RoomStatus;
  new_status: RoomStatus;
  changed_at: string;
  changed_by: number;
  changed_by_name: string;
}

/** What one unit of an add-on is; sets how many a stay may carry (BR-29). */
export type ServiceBasis = "per_guest_night" | "per_room_night" | "per_trip" | "per_room_stay";

/** An add-on from the `service` catalog (breakfast, airport transfer ...). */
export interface Service {
  service_id: number;
  name: string;
  price: string;
  description: string | null;
  is_active: boolean;
  basis: ServiceBasis;
}

/** A catalog row for the manager's screen, with what it has sold. */
export interface ServiceCatalogRow extends Service {
  times_sold: number;
  units_sold: number;
  revenue: string;
}

export interface AvailableRoom {
  room_id: number;
  room_number: string;
  room_type: string;
  price_per_night: string;
  max_occupancy: number;
}

/* ------------------------------------------------------------------ booking */

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled";

export interface BookingRoom {
  room_id: number;
  room_number: string;
  room_type: string;
  room_type_id: number;
  price_per_night: string;
}

export interface BookingService {
  service_id: number;
  service_name: string;
  quantity: number;
  unit_price: string;
}

export type PaymentMethod = "cash" | "credit_card" | "bank_transfer" | "promptpay";
export type PaymentStatus = "pending" | "paid" | "refunded" | "failed";

/** One row of a booking's payment ledger (`payment`). */
export interface Payment {
  payment_id: number;
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  paid_at: string | null;
  reference_no: string | null;
}

export interface Booking {
  booking_id: number;
  customer_id: number;
  customer_name: string;
  staff_id: number;
  booking_date: string;
  check_in_date: string;
  check_out_date: string;
  num_guests: number;
  status: BookingStatus;
  note: string | null;
  rooms: BookingRoom[];
  services: BookingService[];
  /** the payment ledger, oldest first */
  payments: Payment[];
  grand_total: string;
  amount_paid: string;
  amount_refunded: string;
  balance_due: string;
  /** ISO UTC: when an unpaid `pending` hold lapses; null once confirmed */
  hold_expires_at: string | null;
  /** ISO UTC: cancel before this for a full refund; null once uncancellable */
  free_cancellation_deadline: string | null;
}

export interface Bill {
  booking_id: number;
  nights: number;
  room_total: string;
  service_total: string;
  grand_total: string;
  paid_total: string;
  refunded_total: string;
  balance_due: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/* ------------------------------------------------------------------ people */

export interface CustomerRow {
  customer_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  trips: number;
  nights: number;
  lifetime_value: string;
}

export interface GuestBookingRow {
  booking_id: number;
  check_in_date: string;
  check_out_date: string;
  status: BookingStatus;
  room_types: string;
  grand_total: string;
  balance_due: string;
  note: string | null;
}

export interface CustomerDetail extends CustomerRow {
  /** national ID / passport number, recorded by the front desk */
  id_card_no: string | null;
  has_login: boolean;
  upcoming: number;
  first_stay: string | null;
  last_stay: string | null;
  recent_bookings: GuestBookingRow[];
}

export interface CustomerSummary {
  trips: number;
  nights: number;
  lifetime_spend: string;
}

export interface BookingStatusCounts {
  pending: number;
  confirmed: number;
  checked_in: number;
  checked_out: number;
  cancelled: number;
  [status: string]: number;
}

/* ------------------------------------------------------------------ reports */

/** An occupied room right now - `v_current_guests` + party size and balance. */
export interface InHouseRow {
  booking_id: number;
  customer_name: string;
  room_number: string;
  room_type: string;
  check_in_date: string;
  check_out_date: string;
  num_guests: number;
  balance_due: string;
}

export interface RevenueRow {
  room_type: string;
  booking_count: number;
  total_room_nights: number;
  revenue: string;
}

export interface OccupancyRow {
  month: string;
  room_nights_sold: number;
  room_nights_capacity: number;
  occupancy_pct: number;
  adr: string;
  revpar: string;
}

export interface DailyRevenueRow {
  stay_date: string;
  bookings: number;
  room_nights: number;
  room_revenue: string;
}

export interface ForecastRow {
  date: string;
  rooms_sold: number;
  rooms_available: number;
  occupancy_pct: number;
  revenue_on_books: string;
  arrivals: number;
  departures: number;
}

export interface RateCalNight {
  date: string;
  price: string;
}

export interface RateCalRow {
  room_type_id: number;
  room_type_name: string;
  base_price_per_night: string;
  nights: RateCalNight[];
}

/* -------------------------------------------------------------- housekeeping */

export type HousekeepingStatus = "pending" | "in_progress" | "done" | "skipped";

export interface HousekeepingTask {
  task_id: number;
  room_id: number;
  room_number: string;
  room_type: string;
  floor: number;
  booking_id: number | null;
  task_type: string;
  status: HousekeepingStatus;
  scheduled_for: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  started_at: string | null;
  completed_at: string | null;
  note: string | null;
  arriving_today: boolean;
}

/** One line of the printable daily board (`v_housekeeping_board`). */
export interface HousekeepingBoardRow {
  task_id: number;
  scheduled_for: string;
  status: HousekeepingStatus;
  task_type: string;
  room_id: number;
  room_number: string;
  floor: number;
  room_type: string;
  room_status: RoomStatus;
  booking_id: number | null;
  assigned_to_name: string | null;
  note: string | null;
}

export interface StaffOption {
  staff_id: number;
  full_name: string;
  role: string;
}

/* -------------------------------------------------------------- maintenance */

export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed"
  | "cancelled";

export interface MaintenanceTicket {
  ticket_id: number;
  room_id: number | null;
  room_number: string | null;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  title: string;
  description: string | null;
  reported_by_name: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

/** An open / in-progress ticket and its age (`v_maintenance_open`). */
export interface MaintenanceBacklogRow {
  ticket_id: number;
  title: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  room_number: string | null;
  reported_by_name: string;
  assigned_to_name: string | null;
  created_at: string;
  age_days: number;
}

/* --------------------------------------------------------------- rate plans */

export type RatePlanKind = "seasonal" | "weekend" | "weekday" | "promotion";

export interface RatePlan {
  rate_plan_id: number;
  room_type_id: number;
  room_type_name: string;
  name: string;
  kind: RatePlanKind;
  price_per_night: string;
  valid_from: string;
  valid_to: string;
  applies_weekday: boolean;
  applies_weekend: boolean;
  priority: number;
  is_active: boolean;
}

export interface Quote {
  room_type_id: number;
  room_type_name: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  base_price_per_night: string;
  /** what the booking will charge: nights x the rounded nightly average */
  total: string;
  /** plain sum of the nightly plan prices (can differ from `total` by rounding) */
  rate_total: string;
  average_per_night: string;
  breakdown: { night: string; price: string }[];
}

/* ----------------------------------------------------------------- invoices */

export type InvoiceStatus = "draft" | "issued" | "paid" | "void";

export interface InvoiceRow {
  invoice_id: number;
  invoice_no: string;
  booking_id: number;
  customer_name: string;
  issued_at: string;
  status: InvoiceStatus;
  subtotal: string;
  tax_amount: string;
  total: string;
  paid_total: string;
  balance_due: string;
}

export interface InvoiceLedgerStats {
  outstanding: string;
  issued: number;
  paid: number;
  void: number;
  draft: number;
}

export interface InvoiceLine {
  line_no: number;
  line_type: "room" | "service" | "discount";
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
}

export interface Invoice {
  invoice_id: number;
  invoice_no: string;
  booking_id: number;
  issued_at: string;
  issued_by_name: string | null;
  status: InvoiceStatus;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  note: string | null;
  lines: InvoiceLine[];
}

/* -------------------------------------------------------------------- admin */

export interface UserRow {
  user_id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  customer_id: number | null;
  staff_id: number | null;
  last_login_at: string | null;
  locked_until: string | null;
  /** from the linked staff / guest record */
  full_name?: string | null;
  phone?: string | null;
  /** staff only */
  hired_at?: string | null;
}

export type AuthEventType =
  | "login_success"
  | "login_fail"
  | "logout"
  | "locked"
  | "password_change";

/** One sign-in event (`auth_event`). */
export interface AuthEventRow {
  event_id: number;
  created_at: string;
  event_type: AuthEventType;
  user_id: number | null;
  username: string | null;
  role: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

export interface AuthEventStats {
  days: number;
  login_success: number;
  login_fail: number;
  logout: number;
  locked: number;
  password_change: number;
  distinct_users: number;
}

export interface AuditRow {
  audit_id: number;
  at: string;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  data: Record<string, unknown> | null;
}

export interface ReviewStats {
  count: number;
  average: string;
  r5: number;
  r4: number;
  r3: number;
  r2: number;
  r1: number;
}
