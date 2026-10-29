// ---- Better or worse than forecast --------------------------------------------
// Which way is good for each report, from the currency's point of view (the usual
// trading-calendar convention): an actual above forecast is "better" when higher is
// better, "worse" when lower is better. The data has no such field, so it comes from
// keywords in the event name. Rules are checked top to bottom; first match wins, so
// specific rules come first. Unmatched reports get no direction and are never colored.
const Directions = (() => {
  const RULES = [
    // Exceptions to the broad rules below.
    ["higher", /overnight borrowing rate|vote hike|budget value|budget balance/i],
    ["lower",  /vote cut/i],
    // Never colored: no comparable figure, or the direction isn't clear-cut.
    [null,     /speech|speaks|testimony|press conference|remarks|hearing|minutes|summary of opinions|holiday|election|plenum|referendum|auction|tender|cftc|rig count|mortgage rate|natural gas|borrowing|debt|deficit|\bimports\b|reserve balances|foreign exchange reserves|fx reserves|wasde|dairy/i],
    // Lower is better: unemployment and job losses, rising oil inventories.
    ["lower",  /unemploy|jobless|claimant|initial claims|continuing claims|job cuts|layoff|redundanc|jobseeker|bankrupt|insolvenc|crude oil|gasoline|distillate|heating oil|cushing|refinery/i],
    // Higher is better: activity, jobs, spending, trade surplus, prices and rates.
    ["higher", /\bgdp|growth|production|output|manufactur|industrial|factory|orders|sales|retail|spending|consumption|income|earning|wage|employ|payroll|jobs?\b|job (openings|quits)|hours|participation|productivity|pmi|\bism\b|confidence|sentiment|optimism|climate|conditions|expectations|barometer|outlook|survey|index|indicator|activity|capacity|utili[sz]ation|exports?\b|trade|balance|current account|surplus|inflation|\bcpif?\b|\bppi\b|\bpce\b|price|deflator|labou?r cost|interest rate|rate decision|loan prime|policy rate|repo rate|key rate|cash rate|deposit|lending|loans?\b|credit|money supply|\bm[1-4]\b|housing|house|home|building|permits|starts|construction|mortgage|registrations|touris|investment|\bfdi\b|foreign direct|monetary base|overtime pay|capital expenditure|capex|profits|flows|redbook|inventor/i],
  ];

  // "higher" | "lower" | null for an event name.
  function of(name) {
    for (const [dir, re] of RULES) if (re.test(name)) return dir;
    return null;
  }

  // What the actual is judged against: the forecast, or (when usePrevious is on and
  // there's no forecast) the previous value. null when there's nothing to compare with.
  function basis(e, usePrevious = false) {
    if (e.estimate != null) return "forecast";
    return usePrevious && e.prev != null ? "previous" : null;
  }

  // "better" | "worse" | null for an event with an actual and something to compare it with.
  function verdict(e, usePrevious = false) {
    const against = basis(e, usePrevious);
    if (e.actual == null || !against || !e.direction) return null;
    const a = Number(e.actual), f = Number(against === "forecast" ? e.estimate : e.prev);
    if (!Number.isFinite(a) || !Number.isFinite(f) || a === f) return null;
    return (a > f) === (e.direction === "higher") ? "better" : "worse";
  }

  return { of, basis, verdict };
})();
