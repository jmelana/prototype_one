// ---- MotiveWave calendar server ------------------------------------------------
// Same request and response as Finnhub's economic calendar (from/to, {economicCalendar}),
// no key. The server sends no CORS header, so browsers can't read it directly: on the
// local preview (npm run serve) requests go through the preview server's relay instead.
// Messages shown to users never name the provider.
const MotiveWave = (() => {
  const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
  const URL_BASE = LOCAL ? "/motivewave/economic-calendar" : "https://www.motivewave.com/data/economic-calendar";

  // Resolves to the raw JSON text; rejects with a readable message.
  async function fetchCalendar({ from, to }) {
    let r;
    try {
      r = await fetch(`${URL_BASE}?from=${from}&to=${to}`, { cache: "no-store", referrerPolicy: "no-referrer" });
    } catch {
      throw new Error("couldn't reach the data service");
    }
    if (r.status === 429) throw new Error("too many requests, retrying shortly");
    if (!r.ok) throw new Error(`the data service returned an error (${r.status})`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("the data service sent an unreadable response"); }
    if (!json || !Array.isArray(json.economicCalendar)) throw new Error("the data service sent an unexpected response");
    return text;
  }

  return { fetchCalendar };
})();
