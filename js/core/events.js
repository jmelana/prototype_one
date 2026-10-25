// ---- Event data: normalize, classify, status -------------------------------
const Events = (() => {
  // Finnhub has no category field, so report types come from keywords in the event name.
  // Categories follow ForexFactory's trader-oriented set, plus Energy and Holiday.
  // Rules are checked top to bottom; first match wins, so specific rules come first
  // ("BoE Bailey Speech" is a speech, not Central Bank; "Retail Price Index" is
  // Inflation, not Growth; "Housing Price Index" is Housing, not Inflation; "ISM
  // Services Prices" is a business survey, not Inflation).
  const TYPE_RULES = [
    ["Speeches",         /speech|speaks|testimony|testifies|press conference|remarks|hearing/i],
    ["Bonds",            /auction|tender|syndication|refunding/i],
    ["Misc",             /\belection|plenum|referendum|dairy|wasde|commodit|consumer credit|debt to gdp/i],
    ["Growth",           /gdpnow|national activity/i],
    ["Central Bank",     /outlook report|monetary policy report|financial stability|marginal lending/i],
    ["Energy",           /\b(eia|api)\b|crude|\boil\b|natural gas|gasoline|distillate|heating oil|refinery|rig count|baker hughes|cushing/i],
    ["Housing",          /housing|\bhouse\b|home|building permit|mortgage|\bmba\b|construction|dwelling|property|real estate|\brent\b/i],
    ["Consumer Surveys", /consumer (confidence|sentiment|expectation|climate|morale)|michigan|\bgfk\b|westpac/i],
    ["Business Surveys", /\bpmi\b|\bism\b|\b(nfib|zew|ifo|kof|cbi|cfib)\b|tankan|fed\b.*(index|survey|activity)|empire state|confidence|sentiment|optimism|barometer|business climate|climate indicator|business conditions|tendency|outlook|survey|managers index|ai group|economy watchers|manufacturing index|services index/i],
    ["Inflation",        /inflation|\bcpif?\b|\bppi\b|\bpce\b|price|deflator/i],
    ["Central Bank",     /interest rate|rate decision|loan prime|policy rate|repo rate|key rate|cash rate|deposit (facility )?rate|lending facility|overnight (lending|borrowing)|reserve requirement|monetary|minutes|summary of opinions|copom|\bmpc\b|\bfomc\b|\b(fed|ecb|boe|boj|boc|rba|rbnz|snb|bcb|cbr|pboc|mas|rbi|riksbank|norges|bundesbank)\b|reserve balances/i],
    ["Employment",       /employ|jobless|payroll|\bjobs?\b|wage|earning|labou?r|claimant|jolts|\bhours\b|participation|jobseeker|overtime/i],
    ["Growth",           /\bgdp|growth rate|productivity|leading|coincident|economic activity|economic index|industrial|manufactur|factory|durable|capacity|production|output|orders|inventor|machinery|retail|spending|consumption|personal income|car registration|vehicle sales|car sales|redbook|wholesale sales|motorbike|fixed investment|private investment|trade|export|import|current account|touris|terms of|corporate profits/i],
  ];
  // Order shown in the Categories menu (Holiday first, Misc last).
  const TYPES = ["Holiday", "Growth", "Inflation", "Employment", "Central Bank", "Speeches", "Bonds",
                 "Housing", "Consumer Surveys", "Business Surveys", "Energy", "Misc"];
  const IMPACTS = ["high", "medium", "low"];

  function isHoliday(e) {
    return e.time.endsWith("00:00:00") && e.actual == null && e.estimate == null && e.prev == null &&
      !/election|plenum|meeting|budget|referendum/i.test(e.event);
  }
  function classify(e) {
    if (isHoliday(e)) return "Holiday";
    for (const [name, re] of TYPE_RULES) if (re.test(e.event)) return name;
    return "Misc";
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
          direction: Directions.of(e.event), // "higher" | "lower" | null: which way beats the forecast
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

  // Release state: "holiday" | "released" | "upcoming" | "awaiting" | "past".
  // An actual value wins over the clock; a passed event with no actual is "awaiting"
  // if it normally publishes numbers, else "past" (speeches, meetings). The table
  // greys the time of released and past events.
  function releaseState(e, now) {
    if (e.holiday) return "holiday";
    if (e.actual != null) return "released";
    if (e.ts > now) return "upcoming";
    return e.expectsValue ? "awaiting" : "past";
  }

  return { IMPACTS, TYPES, normalize, releaseState };
})();
