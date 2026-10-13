import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * React Router keeps the old scroll offset when the route changes, so a long
 * board (Rooms, Bookings) would open the next page halfway down. Snap back to the
 * top on every pathname change - a `?query` change is in-page state, so it is
 * left alone. The jump is instant even though `html` is `scroll-behavior: smooth`,
 * so the view never visibly slides around.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);

  return null;
}
