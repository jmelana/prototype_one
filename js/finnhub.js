// ---- Finnhub client --------------------------------------------------------------
// Calls the economic calendar straight from the browser (Finnhub allows any origin).
// Messages shown to users never name the provider.
// The key goes in the `token` query parameter: Finnhub's CORS preflight doesn't
// allow the X-Finnhub-Token header.
const Finnhub = (() => {
  const URL_BASE = "https://finnhub.io/api/v1/calendar/economic";

  // Resolves to the raw JSON text; rejects with a readable message.
  async function fetchCalendar(apiKey, { from, to }) {
    let r;
    try {
      r = await fetch(`${URL_BASE}?from=${from}&to=${to}&token=${encodeURIComponent(apiKey)}`,
        { cache: "no-store", referrerPolicy: "no-referrer" });
    } catch {
      throw new Error("couldn't reach the data service");
    }
    if (r.status === 401) throw new Error("the data service rejected the access key");
    if (r.status === 403) throw new Error("access to calendar data was refused");
    if (r.status === 429) throw new Error("too many requests, retrying shortly");
    if (!r.ok) throw new Error(`the data service returned an error (${r.status})`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("the data service sent an unreadable response"); }
    if (!json || !Array.isArray(json.economicCalendar)) throw new Error("the data service sent an unexpected response");
    return text;
  }

  // The bundled sample is only downloaded when it's needed.
  function loadSample() {
    if (typeof SAMPLE_CALENDAR !== "undefined") return Promise.resolve(SAMPLE_CALENDAR);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "js/data/sample-calendar.js";
      s.onload = () => resolve(SAMPLE_CALENDAR);
      s.onerror = () => reject(new Error("Couldn't load the sample data."));
      document.head.appendChild(s);
    });
  }

  return { fetchCalendar, loadSample };
})();
