import { useEffect, useState } from "react";
import { getBusinessTimezone } from "../services/businessTime";
import { businessDate } from "../utils/slotTime";

export default function useBusinessClock() {
  const [now, setNow] = useState(() => Date.now());
  const [timezone, setTimezone] = useState(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setNow(Date.now());
      getBusinessTimezone().then((zone) => { if (active) setTimezone(zone); })
        .catch(() => { if (active) setTimezone(null); });
    };
    // Defer initial refresh; the first render remains closed until configured.
    const initial = window.setTimeout(refresh, 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const configTimer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.clearInterval(configTimer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return { now, timezone, today: businessDate(timezone, now) };
}
