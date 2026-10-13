import { useEffect, useState } from "react";
import { monthAbbr, weekdayAbbr } from "../lib/format";
import { useT } from "../i18n/I18n";

/** Live front-desk clock - local date + 24-hour time, ticks every second.
 *  e.g. "Thu. 10 Sep 2026  17:34:02" */
export function Clock({ className = "tape__clock" }: { className?: string }) {
  const { t, lang } = useT();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return (
    <p className={className} title={t("tc.frontDeskTime")}>
      {weekdayAbbr(now.getDay(), lang)} {now.getDate()} {monthAbbr(now.getMonth(), lang)}{" "}
      {now.getFullYear()}
      <span className="tape__clock__time">{time}</span>
    </p>
  );
}
