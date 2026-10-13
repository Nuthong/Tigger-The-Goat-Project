import { Link, useNavigate } from "react-router-dom";

/** A quiet "‹ back" affordance. Give it `to` for a fixed target, else it pops history. */
export function BackLink({ to, label = "Back" }: { to?: string; label?: string }) {
  const nav = useNavigate();
  const cls = "backlink";
  if (to) {
    return (
      <Link to={to} className={cls}>
        ‹ {label}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={() => nav(-1)}>
      ‹ {label}
    </button>
  );
}
