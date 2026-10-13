import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Spinner } from "./ui";

type Require =
  | "staff"
  | "frontdesk"
  | "housekeeping"
  | "accounting"
  | "manager"
  | "admin";

export function ProtectedRoute({
  children,
  require,
}: {
  children: ReactNode;
  require?: Require;
}) {
  const auth = useAuth();
  const { user, loading, isStaff } = auth;
  const loc = useLocation();

  if (loading) {
    return (
      <div className="page container center" style={{ paddingTop: 120 }}>
        <Spinner />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;

  // "staff" gate keeps guests out of the whole portal; the finer gates match the
  // links AdminLayout actually shows each role, so a deep link can't skip them.
  if (require && require !== "staff" && !isStaff) return <Navigate to="/" replace />;

  const ok: Record<Require, boolean> = {
    staff: isStaff,
    frontdesk: auth.canFrontDesk,
    housekeeping: auth.canHousekeeping,
    accounting: auth.canAccounting,
    manager: auth.isManager,
    admin: auth.isAdmin,
  };
  if (require && !ok[require]) {
    return <Navigate to={require === "staff" ? "/" : "/admin"} replace />;
  }
  return <>{children}</>;
}
