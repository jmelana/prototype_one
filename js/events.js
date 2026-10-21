// ---- Event data: normalize, classify, status -------------------------------
const Events = (() => {
  // Finnhub has no category field, so report types come from keywords in the event name.
  // Rules are checked top to bottom; first match wins.
  const TYPE_RULES = [
    ["Politics",      /\belection|plenum|referendum/i],
    ["Bond auctions", /auction|tender|syndication|refunding/i],
    ["Energy & commodities", /\b(eia|api)\b|baker hughes|wasde|dairy/i],
    ["Inflation",     /\bcpi|inflation|\bpce\b/i],
    ["GDP & growth",  /gdpnow/i],
    ["PMI & surveys", /fed\b.*(index|survey|activity)|\b(nfib|ism|zew|ifo)\b/i],
    ["Central bank",  /interest rate|rate decision|loan prime|\b(fed|fomc|ecb|boe|boj|boc|rba|rbnz|snb|bcb|cbr|pboc|mas|rbi|riksbank|norges|bundesbank)\b|monetary|press conference|key rate|overnight (lending|borrowing)|reserve requirement|deposit (facility )?rate|repo rate|copom|mpc|speech|minutes|summary of opinions|reserve balances/i],
    ["Housing",       /housing|\bhouse\b|home|building permit|mortgage|construction|dwelling|property|real estate|\brent/i],
    ["Inflation",     /inflation|\bcpi\b|\bppi\b|\bpce\b|price|deflator/i],
    ["Employment",    /employ|jobless|payroll|\bjobs?\b|wage|earning|labou?r|claimant|jolts|\bhours\b|participation|jobseeker|overtime/i],
    ["GDP & growth",  /\bgdp|growth rate|gdpnow|productivity|leading|coincident|economic activity|economic index/i],
    ["PMI & surveys", /\bpmi\b|\bism\b|confidence|sentiment|expectation|survey|climate|zew|ifo|tankan|michigan|outlook|\bnfib\b|fed .*index|manufacturing index|services index|business conditions|focus market|optimism|barometer|tendency|managers index|ai group|supply chain/i],
    ["Trade",         /trade|export|import|current account|touris|terms of/i],
    ["Consumer",      /retail|consumer|personal (income|spending)|household|car registration|vehicle sales|redbook|spending|consumption|car sales|motorbike|wholesale sales|household/i],
    ["Industry",      /industrial|manufactur|factory|durable|capacity|production|machinery|orders|output|inventor/i],
    ["Energy & commodities", /\beia\b|\bapi\b|crude|oil|rig count|rigs|natural gas|gasoline|distillate|wasde|dairy|commodit/i],
    ["Government & fiscal",  /budget|fiscal|government|debt|ecofin|eurogroup|treasury|tax|borrowing/i],
    ["Money & credit",       /loan|\bfdi\b|money supply|\bm[0-3]\b|credit|reserves|lending|deposit|investment|bond|private sector|foreign exchange/i],
  ];
  const IMPACTS = ["high", "medium", "low"];

  function isHoliday(e) {
    return e.time.endsWith("00:00:00") && e.actual == null && e.estimate == null && e.prev == null &&
      !/election|plenum|meeting|budget|referendum/i.test(e.event);
  }
  function classify(e) {
    if (isHoliday(e)) return "Holiday";
    for (const [name, re] of TYPE_RULES) if (re.test(e.event)) return name;
    return "Other";
  }

  // Finnhub times are UTC, "YYYY-MM-DD HH:MM:SS"
  const toDate = t => new Date(t.replace(" ", "T") + "Z");

  // Normalizes a Finnhub /calendar/economic response. Each event gets a stable id
  // from its own content (country + scheduled time + name), so alert state survives
  // reloads, re-sorting and re-filtering. Exact repeats get an occurrence suffix.
  function normalize(raw) {
    const list = Array.isArray(raw) ? raw : raw && raw.economicCalendar;
    if (!Array.isArray(list)) throw new Error("No economicCalendar array found in that file.");
    const occurrences = new Map();
    const events = list
      .filter(e => e && typeof e.time === "string" && typeof e.event === "string" && !isNaN(toDate(e.time)))
      .map(e => {
        const d = toDate(e.time);
        const type = classify(e);
        const base = `${e.country}|${e.time}|${e.event}`;
        const n = occurrences.get(base) || 0;
        occurrences.set(base, n + 1);
        return {
          ...e,
          id: n ? `${base}#${n}` : base,
          d, ts: d.getTime(), type,
          impact: IMPACTS.includes(e.impact) ? e.impact : "low",
          holiday: type === "Holiday",
          // Releases that carry numbers are expected to get an actual; speeches etc. are not.
          expectsValue: e.estimate != null || e.prev != null || e.actual != null,
          name: Countries.name(e.country),
        };
      })
      .sort((a, b) => a.ts - b.ts);
    // Flag repeats of the same country + event on the same UTC day; keep the first
    const seen = new Set();
    for (const e of events) {
      const k = e.country + "|" + e.event + "|" + e.time.slice(0, 10);
      e.dup = seen.has(k); seen.add(k);
    }
    return events;
  }

  // Release status. Confirmed release (an actual value) wins over the clock: an event
  // whose time has passed without an actual is "Awaiting", not "Released".
  function status(e, now) {
    if (e.holiday) return { kind: "holiday", label: "Holiday", title: "Market holiday" };
    if (e.actual != null) return { kind: "released", label: "Released", title: "Actual value published" };
    const ms = e.ts - now;
    if (ms > 0) return { kind: "upcoming", label: Time.countdown(ms), title: "Scheduled release" };
    if (e.expectsValue) return { kind: "awaiting", label: "Awaiting", title: "Scheduled time has passed, but the loaded data has no actual value yet" };
    return { kind: "past", label: "Past", title: "Scheduled time has passed. This event doesn't publish a value" };
  }

  return { IMPACTS, normalize, status };
})();
