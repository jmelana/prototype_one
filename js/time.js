// ---- Time zones, formatting, countdowns -----------------------------------
// All conversion goes through Intl with an IANA zone, so DST and date-line
// changes come from the browser's tz database rather than fixed offsets.
const Time = (() => {
  const LOCAL_ZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  })();

  // "local" follows the viewer's system zone, matching the app's original behavior.
  const ZONES = [
    { group: "General", id: "local", city: "Local time" },
    { group: "General", id: "UTC", city: "UTC" },
    { group: "Americas", id: "America/New_York", city: "New York" },
    { group: "Americas", id: "America/Chicago", city: "Chicago" },
    { group: "Americas", id: "America/Toronto", city: "Toronto" },
    { group: "Americas", id: "America/Los_Angeles", city: "Los Angeles" },
    { group: "Americas", id: "America/Sao_Paulo", city: "São Paulo" },
    { group: "Europe & Africa", id: "Europe/London", city: "London" },
    { group: "Europe & Africa", id: "Europe/Berlin", city: "Frankfurt" },
    { group: "Europe & Africa", id: "Europe/Paris", city: "Paris" },
    { group: "Europe & Africa", id: "Europe/Zurich", city: "Zurich" },
    { group: "Europe & Africa", id: "Europe/Moscow", city: "Moscow" },
    { group: "Europe & Africa", id: "Africa/Johannesburg", city: "Johannesburg" },
    { group: "Asia & Pacific", id: "Asia/Dubai", city: "Dubai" },
    { group: "Asia & Pacific", id: "Asia/Kolkata", city: "Mumbai" },
    { group: "Asia & Pacific", id: "Asia/Singapore", city: "Singapore" },
    { group: "Asia & Pacific", id: "Asia/Hong_Kong", city: "Hong Kong" },
    { group: "Asia & Pacific", id: "Asia/Shanghai", city: "Shanghai" },
    { group: "Asia & Pacific", id: "Asia/Tokyo", city: "Tokyo" },
    { group: "Asia & Pacific", id: "Australia/Sydney", city: "Sydney" },
    { group: "Asia & Pacific", id: "Pacific/Auckland", city: "Auckland" },
  ];

  const resolve = id => (id === "local" || !id ? LOCAL_ZONE : id);
  function isValid(id) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: resolve(id) }); return true; } catch { return false; }
  }

  const cache = new Map();
  function fmt(key, opts) {
    if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(opts.locale, opts));
    return cache.get(key);
  }

  // 24-hour HH:MM in the zone, the usual convention on trading calendars.
  function time(d, zone) {
    const tz = resolve(zone);
    return fmt("t|" + tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(d);
  }

  // Calendar date in the zone as "YYYY-MM-DD", used to group rows by day.
  function dayKey(d, zone) {
    const tz = resolve(zone);
    const p = {};
    for (const x of fmt("k|" + tz, { locale: "en-US", year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).formatToParts(d)) p[x.type] = x.value;
    return `${p.year}-${p.month}-${p.day}`;
  }

  // Label for a "YYYY-MM-DD" key. Formatted at UTC noon so the key's own date is shown.
  function dayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return fmt("dl", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(y, m - 1, d, 12)));
  }

  // Calendar arithmetic on "YYYY-MM-DD" keys (done at UTC noon, so DST can't shift the date).
  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
  }
  const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400e3);
  function shortDay(key) {
    const [y, m, d] = key.split("-").map(Number);
    return fmt("sd", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  }

  // "Thu 22" for the day tabs.
  function tabDay(key) {
    const [y, m, d] = key.split("-").map(Number);
    return `${fmt("wd", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)))} ${d}`;
  }

  // "UTC−4", "UTC+5:30", "UTC" for the zone's offset at the given instant.
  function offset(zone, at = new Date()) {
    const tz = resolve(zone);
    let name = "";
    try {
      name = fmt("o|" + tz, { locale: "en-US", timeZone: tz, timeZoneName: "shortOffset" })
        .formatToParts(at).find(p => p.type === "timeZoneName").value;
    } catch {
      // Older engines: derive the offset from wall-clock parts.
      const p = {};
      for (const x of fmt("w|" + tz, { locale: "en-US", timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(at)) p[x.type] = +x.value;
      const mins = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at.getTime()) / 60000 / 15) * 15;
      name = mins === 0 ? "GMT" : `GMT${mins < 0 ? "-" : "+"}${Math.floor(Math.abs(mins) / 60)}${Math.abs(mins) % 60 ? ":" + String(Math.abs(mins) % 60).padStart(2, "0") : ""}`;
    }
    return name.replace("GMT", "UTC").replace("-", "−");
  }

  function zoneLabel(z, at) {
    if (z.id === "local") return `Local: ${LOCAL_ZONE.split("/").pop().replace(/_/g, " ")} (${offset("local", at)})`;
    if (z.id === "UTC") return "UTC";
    return `${z.city} (${offset(z.id, at)})`;
  }

  // "In 25 minutes", "In 3 hours", "In 2 days". Floors so it never overstates the wait.
  const rtf = (() => { try { return new Intl.RelativeTimeFormat(undefined, { numeric: "always" }); } catch { return null; } })();
  function countdown(ms) {
    const min = Math.floor(ms / 60000);
    let text;
    if (min < 1) return "In under a minute";
    if (min < 60) text = rel(min, "minute");
    else if (min < 48 * 60) text = rel(Math.floor(min / 60), "hour");
    else text = rel(Math.floor(min / 1440), "day");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  // Precise time left for the alarm window: "2 hours 15 minutes", "4 minutes 32 seconds".
  function timeLeft(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const part = (n, u) => `${n} ${u}${n === 1 ? "" : "s"}`;
    if (d) return `${part(d, "day")} ${part(h, "hour")}`;
    if (h) return `${part(h, "hour")} ${part(m, "minute")}`;
    if (m) return `${part(m, "minute")} ${part(sec, "second")}`;
    return part(sec, "second");
  }

  // Date text as a JavaFX DatePicker shows it: the locale's short date with a 4-digit
  // year ("10/19/2026" in the US, "2026-10-19" in Canada, "19/10/2026" in the UK).
  function shortDateFmt(locale) {
    return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" });
  }
  function pickerDate(key, locale) {
    return shortDateFmt(locale).formatToParts(new Date(key + "T00:00:00Z"))
      .map(p => p.type === "year" ? key.slice(0, 4) : p.value).join("");
  }
  // Reads typed text back in the same field order; null when it isn't a real date.
  function parsePickerDate(text, locale) {
    const order = shortDateFmt(locale).formatToParts(new Date(Date.UTC(2026, 0, 5)))
      .map(p => p.type).filter(t => t === "year" || t === "month" || t === "day");
    const nums = String(text).trim().split(/\D+/).filter(Boolean).map(Number);
    if (nums.length !== 3) return null;
    const v = {};
    order.forEach((t, i) => { v[t] = nums[i]; });
    if (v.year < 100) v.year += 2000;
    const d = new Date(Date.UTC(v.year, v.month - 1, v.day));
    if (d.getUTCFullYear() !== v.year || d.getUTCMonth() !== v.month - 1 || d.getUTCDate() !== v.day) return null;
    return d.toISOString().slice(0, 10);
  }

  function rel(n, unit) { return rtf ? rtf.format(n, unit) : `in ${n} ${unit}${n === 1 ? "" : "s"}`; }

  return { ZONES, LOCAL_ZONE, resolve, isValid, time, dayKey, dayLabel, addDays, daysBetween, shortDay, tabDay, offset, zoneLabel, countdown, timeLeft, pickerDate, parsePickerDate };
})();
