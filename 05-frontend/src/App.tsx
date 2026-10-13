import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { NavBar } from "./components/NavBar";
import { Footer } from "./components/Footer";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ScrollToTop } from "./components/ScrollToTop";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Rooms } from "./pages/Rooms";
import { Search } from "./pages/Search";
import { ConfirmReservation } from "./pages/ConfirmReservation";
import { Payment } from "./pages/Payment";
import { RoomType } from "./pages/RoomType";
import { Bookings } from "./pages/Bookings";
import { BookingDetail } from "./pages/BookingDetail";
import { NotFound } from "./pages/NotFound";

// The staff portal and the printable documents are split into their own
// chunks: a guest browsing rooms never downloads the admin screens.
function lazyNamed<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const AdminLayout = lazyNamed(() => import("./admin/AdminLayout"), "AdminLayout");
const Overview = lazyNamed(() => import("./admin/Overview"), "Overview");
const BookingsAdmin = lazyNamed(() => import("./admin/BookingsAdmin"), "BookingsAdmin");
const NewBooking = lazyNamed(() => import("./admin/NewBooking"), "NewBooking");
const RoomsAdmin = lazyNamed(() => import("./admin/RoomsAdmin"), "RoomsAdmin");
const GuestsAdmin = lazyNamed(() => import("./admin/GuestsAdmin"), "GuestsAdmin");
const GuestDetail = lazyNamed(() => import("./admin/GuestDetail"), "GuestDetail");
const TapeChart = lazyNamed(() => import("./admin/TapeChart"), "TapeChart");
const RatePlans = lazyNamed(() => import("./admin/RatePlans"), "RatePlans");
const Reports = lazyNamed(() => import("./admin/Reports"), "Reports");
const Invoices = lazyNamed(() => import("./admin/Invoices"), "Invoices");
const Housekeeping = lazyNamed(() => import("./admin/Housekeeping"), "Housekeeping");
const Maintenance = lazyNamed(() => import("./admin/Maintenance"), "Maintenance");
const Reviews = lazyNamed(() => import("./admin/Reviews"), "Reviews");
const Users = lazyNamed(() => import("./admin/Users"), "Users");
const Audit = lazyNamed(() => import("./admin/Audit"), "Audit");
const InHouse = lazyNamed(() => import("./admin/InHouse"), "InHouse");
const Services = lazyNamed(() => import("./admin/Services"), "Services");
const SecurityLog = lazyNamed(() => import("./admin/SecurityLog"), "SecurityLog");
const InvoicePrint = lazyNamed(() => import("./print/InvoicePrint"), "InvoicePrint");
const FolioPrint = lazyNamed(() => import("./print/FolioPrint"), "FolioPrint");
const HousekeepingPrint = lazyNamed(() => import("./print/HousekeepingPrint"), "HousekeepingPrint");

/** Staff live entirely in the portal - bounce them out of the guest site. */
function GuestRoute({ children }: { children: ReactNode }) {
  const { isStaff, loading } = useAuth();
  if (loading) return null;
  if (isStaff) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** `/admin` lands each role on the board they actually work from. */
function AdminHome() {
  const { isManager, canFrontDesk, canHousekeeping, canAccounting } = useAuth();
  if (isManager) return <Navigate to="/admin/overview" replace />;
  if (canFrontDesk) return <Navigate to="/admin/tape" replace />;
  if (canHousekeeping) return <Navigate to="/admin/housekeeping" replace />;
  if (canAccounting) return <Navigate to="/admin/invoices" replace />;
  return <Navigate to="/admin/maintenance" replace />;
}

export function App() {
  const path = useLocation().pathname;
  // the portal and the printable documents both render without the guest chrome
  const chromeless = path.startsWith("/admin") || path.startsWith("/print");

  return (
    <>
      <ScrollToTop />
      {!chromeless && <NavBar />}
      <main>
        <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<GuestRoute><Landing /></GuestRoute>} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/rooms" element={<GuestRoute><Rooms /></GuestRoute>} />
          <Route path="/rooms/:slug" element={<GuestRoute><RoomType /></GuestRoute>} />
          <Route path="/book" element={<GuestRoute><Search /></GuestRoute>} />
          <Route
            path="/book/confirm"
            element={
              <GuestRoute>
                <ProtectedRoute>
                  <ConfirmReservation />
                </ProtectedRoute>
              </GuestRoute>
            }
          />
          <Route
            path="/book/pay/:bookingId"
            element={
              <GuestRoute>
                <ProtectedRoute>
                  <Payment />
                </ProtectedRoute>
              </GuestRoute>
            }
          />
          <Route path="/search" element={<Navigate to="/book" replace />} />
          <Route
            path="/bookings"
            element={
              <GuestRoute>
                <ProtectedRoute>
                  <Bookings />
                </ProtectedRoute>
              </GuestRoute>
            }
          />
          <Route
            path="/bookings/:id"
            element={
              <GuestRoute>
                <ProtectedRoute>
                  <BookingDetail />
                </ProtectedRoute>
              </GuestRoute>
            }
          />

          {/* staff portal */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute require="staff">
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<AdminHome />} />
            <Route
              path="overview"
              element={
                <ProtectedRoute require="manager">
                  <Overview />
                </ProtectedRoute>
              }
            />
            <Route
              path="tape"
              element={
                <ProtectedRoute require="frontdesk">
                  <TapeChart />
                </ProtectedRoute>
              }
            />
            <Route
              path="bookings"
              element={
                <ProtectedRoute require="frontdesk">
                  <BookingsAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="bookings/new"
              element={
                <ProtectedRoute require="frontdesk">
                  <NewBooking />
                </ProtectedRoute>
              }
            />
            <Route
              path="bookings/:id"
              element={
                <ProtectedRoute require="frontdesk">
                  <BookingDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="in-house"
              element={
                <ProtectedRoute require="frontdesk">
                  <InHouse />
                </ProtectedRoute>
              }
            />
            <Route path="rooms" element={<RoomsAdmin />} />
            <Route
              path="guests"
              element={
                <ProtectedRoute require="frontdesk">
                  <GuestsAdmin />
                </ProtectedRoute>
              }
            />
            <Route
              path="guests/:id"
              element={
                <ProtectedRoute require="frontdesk">
                  <GuestDetail />
                </ProtectedRoute>
              }
            />
            <Route path="rates" element={<RatePlans />} />
            <Route
              path="services"
              element={
                <ProtectedRoute require="manager">
                  <Services />
                </ProtectedRoute>
              }
            />
            <Route
              path="reports"
              element={
                <ProtectedRoute require="manager">
                  <Reports />
                </ProtectedRoute>
              }
            />
            <Route
              path="invoices"
              element={
                <ProtectedRoute require="accounting">
                  <Invoices />
                </ProtectedRoute>
              }
            />
            <Route
              path="housekeeping"
              element={
                <ProtectedRoute require="housekeeping">
                  <Housekeeping />
                </ProtectedRoute>
              }
            />
            <Route path="maintenance" element={<Maintenance />} />
            <Route path="reviews" element={<Reviews />} />
            <Route
              path="audit"
              element={
                <ProtectedRoute require="manager">
                  <Audit />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute require="admin">
                  <Users />
                </ProtectedRoute>
              }
            />
            <Route
              path="security"
              element={
                <ProtectedRoute require="admin">
                  <SecurityLog />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route
            path="/print/invoice/:id"
            element={
              <ProtectedRoute require="staff">
                <InvoicePrint />
              </ProtectedRoute>
            }
          />
          <Route
            path="/print/folio/:id"
            element={
              <ProtectedRoute require="staff">
                <FolioPrint />
              </ProtectedRoute>
            }
          />

          <Route
            path="/print/housekeeping/:day"
            element={
              <ProtectedRoute require="staff">
                <HousekeepingPrint />
              </ProtectedRoute>
            }
          />

          <Route path="/dashboard" element={<Navigate to="/admin" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </main>
      {!chromeless && <Footer />}
    </>
  );
}
