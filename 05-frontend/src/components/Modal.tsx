import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * One modal primitive for the whole app - replaces the hand-rolled
 * `role="dialog"` backdrops that were copied into several screens.
 *
 * - `Esc` and a backdrop click call `onClose`
 * - focus moves into the dialog on open and is restored to the opener on close
 * - `Tab` / `Shift+Tab` are trapped inside the dialog
 * - background scroll is locked while open
 */
export function Modal({
  onClose,
  children,
  labelledBy,
  describedBy,
  maxWidth = 460,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  maxWidth?: number;
  closeOnBackdrop?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    // lock the page scroll on <html>, the element that actually scrolls. Locking
    // <body> instead turns it into its own scroll box, and every `position:
    // sticky` element (the portal's side rail, the top bar) then snaps back to
    // its unscrolled spot. The gutter stays reserved (`scrollbar-gutter`), so
    // nothing shifts sideways either.
    const root = document.documentElement;
    const { overflow } = root.style;
    root.style.overflow = "hidden";

    // focus the first field, else the dialog itself
    const focusables = getFocusable(cardRef.current);
    (focusables[0] ?? cardRef.current)?.focus();

    return () => {
      root.style.overflow = overflow;
      openerRef.current?.focus?.();
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable(cardRef.current);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.42)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 300,
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="card"
        style={{ maxWidth, width: "100%", maxHeight: "85vh", overflow: "auto", outline: "none" }}
      >
        {children}
      </div>
    </div>
  );
}

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement);
}
