// ---- Countries: names, flags, regions -------------------------------------
const Countries = (() => {
  const NAME_OVERRIDES = {
    EU: "Euro Area", WW: "World", US: "United States", HK: "Hong Kong", MO: "Macao",
    MM: "Myanmar", PS: "Palestine", CG: "Republic of the Congo", XK: "Kosovo",
  };
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* old browser */ }

  const nameCache = new Map();
  function name(code) {
    if (!nameCache.has(code)) {
      let n = NAME_OVERRIDES[code];
      if (!n) { try { n = (regionNames && regionNames.of(code)) || code; } catch { n = code; } }
      nameCache.set(code, n);
    }
    return nameCache.get(code);
  }

  const regionOf = new Map();
  for (const [region, codes] of Object.entries(COUNTRY_REGIONS)) codes.forEach(c => regionOf.set(c, region));
  const REGION_ORDER = [...Object.keys(COUNTRY_REGIONS), "Other"];
  const region = code => regionOf.get(code) || "Other";

  // Round SVG flags from flag-icons; "WW" (World) has no flag, so it gets a globe.
  function flag(code) {
    if (code === "WW") return `<span class="flag flag-world" aria-hidden="true">${Icons.globe}</span>`;
    if (!/^[A-Z]{2}$/.test(code)) return `<span class="flag" aria-hidden="true"></span>`;
    return `<span class="flag fi fis fi-${code.toLowerCase()}" aria-hidden="true"></span>`;
  }

  return { name, flag, region, REGION_ORDER };
})();
