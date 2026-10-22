// ---- App: state, wiring, timers ------------------------------------------------
// Started by auth.js after login, with the decrypted Finnhub key.
function startApp({ apiKey, onLogout }) {
  const $ = id => document.getElementById(id);
  const TICK_MS = 15000;
  const REFRESH_MS = 5 * 60e3;

  const groups = CountryGroups.create();
  let events = [];
  let byId = new Map();
  const alerts = Alerts.create({ isReleased: id => { const e = byId.get(id); return !!e && e.actual != null; } });
  const state = Filters.initial();
  const prefs = Store.get("prefs", {}) || {};
  // Saved default zone (older saves kept the last-used zone as `zone`).
  let defaultZone = [prefs.defaultZone, prefs.zone].find(z => z && Time.isValid(z)) || "local";
  let zone = defaultZone;
  // Positive/negative colors for Actual and Previous (Settings → Display). The presets
  // have light-mode variants in the CSS; custom colors apply as picked in both themes.
  const hex = c => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
  // Blue / pink is the default; older saves used "default" to mean green/red before it was.
  let valueColors = prefs.valueColors && (prefs.valueColors.mode === "greenred" ||
    (prefs.valueColors.mode === "custom" && hex(prefs.valueColors.pos) && hex(prefs.valueColors.neg)))
    ? prefs.valueColors : { mode: "bluepink" };
  function applyValueColors() {
    const root = document.documentElement, custom = valueColors.mode === "custom";
    if (valueColors.mode === "bluepink") root.dataset.values = "bluepink"; else delete root.dataset.values;
    if (custom) { root.style.setProperty("--pos", valueColors.pos); root.style.setProperty("--neg", valueColors.neg); }
    else { root.style.removeProperty("--pos"); root.style.removeProperty("--neg"); }
  }
  applyValueColors();
  // Theme (Settings → Display): "dark" (default), "light", or "system" to match the computer.
  let theme = ["dark", "light", "system"].includes(prefs.theme) ? prefs.theme : "dark";
  function applyTheme() {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
  applyTheme();
  const savePrefs = () => Store.set("prefs", { defaultZone, valueColors, theme });
  // Countries shown when the app opens and after "Clear all".
  const DEFAULT_GROUPS = ["g20"];
  state.groups = new Set(DEFAULT_GROUPS);

  // Calendar date of an event in the displayed zone; holidays keep their own date.
  // Cached per zone because filtering and counting ask for it repeatedly.
  function dayOf(e) {
    if (e.holiday) return e.time.slice(0, 10);
    const c = e.dayIn || (e.dayIn = {});
    return c[zone] || (c[zone] = Time.dayKey(e.d, zone));
  }

  // ---- Date range ----------------------------------------------------------------
  // Dates are calendar days in the displayed zone. The From/To fields hold `picked`
  // (default: Monday to Sunday of the current week). `day` narrows the table to one
  // day without changing the fields: null (the whole range), "today" (follows the
  // clock) or a "YYYY-MM-DD" date picked from the day tabs. state.range is what the
  // table actually filters on.
  const MAX_RANGE_DAYS = 60;
  const today = () => Time.dayKey(new Date(), zone);
  function defaultRange() {
    const t = today();
    const weekday = new Date(t + "T12:00:00Z").getUTCDay(); // 0 = Sunday
    const monday = Time.addDays(t, -((weekday + 6) % 7));
    return { from: monday, to: Time.addDays(monday, 6) };
  }
  let picked = defaultRange();
  let shownWeek = defaultRange(); // the default as of the last day rollover
  let day = null;
  const selectedDay = () => (day === "today" ? today() : day);
  const isDefaultRange = () => { const d = defaultRange(); return picked.from === d.from && picked.to === d.to; };
  const applyRange = () => { const k = selectedDay(); state.range = k ? { from: k, to: k } : { ...picked }; };
  applyRange();

  function rangeChanged() { applyRange(); render(); ensureRangeLoaded(); }
  // Clicking the selected day again goes back to the whole range.
  function selectDay(key) {
    if (key && key === today()) key = "today";
    day = !key || key === day ? null : key;
    rangeChanged();
  }

  // `moved` is the end the user changed; the other end follows to keep the range valid.
  function setPicked(from, to, moved = "from") {
    if (from > to) { if (moved === "from") to = from; else from = to; }
    if (Time.daysBetween(from, to) > MAX_RANGE_DAYS) {
      if (moved === "from") to = Time.addDays(from, MAX_RANGE_DAYS); else from = Time.addDays(to, -MAX_RANGE_DAYS);
    }
    picked = { from, to };
    day = null; // editing the range means "show the range"
    rangeChanged();
  }
  function renderDates() {
    $("dateFrom").value = Time.pickerDate(picked.from);
    $("dateTo").value = Time.pickerDate(picked.to);
    $("dateFromPick").value = picked.from;
    $("dateToPick").value = picked.to;
    const t = $("todayBtn");
    t.setAttribute("aria-pressed", day === "today");
    t.title = day === "today" ? "Showing today only. Click to show the selected dates" : "Show today only";
    // Only Today locks the range. With another day picked, the fields stay usable and
    // changing them goes back to showing the whole range (see setPicked).
    for (const id of ["dateFrom", "dateTo", "dateFromPick", "dateToPick", "prevWeek", "nextWeek", "rangeBtn"]) $(id).disabled = day === "today";
    // Phones show the range as one compact button ("Oct 19 – 25") that opens the date fields.
    const [fm, fd] = Time.shortDay(picked.from).split(" "), [tm, td] = Time.shortDay(picked.to).split(" ");
    $("rangeText").textContent = picked.from === picked.to ? `${fm} ${fd}` : fm === tm ? `${fm} ${fd} – ${td}` : `${fm} ${fd} – ${tm} ${td}`;
    // Reset appears only away from the current week; its space stays reserved.
    $("thisWeek").classList.toggle("is-away", !isDefaultRange());
  }
  $("todayBtn").addEventListener("click", () => selectDay(today()));
  // Back to Monday–Sunday of this week, showing the whole week. Other filters stay.
  $("thisWeek").addEventListener("click", () => {
    picked = defaultRange(); day = null;
    rangeChanged();
    $("nextWeek").focus(); // the reset button hides itself
  });

  // Day tabs: one per day of the picked range (2 to 7 days), plus "Week" for all of it.
  // Counts reflect every other filter.
  function renderDayTabs() {
    const box = $("daytabs");
    const days = Time.daysBetween(picked.from, picked.to) + 1;
    box.hidden = loading || days < 2 || days > 7;
    if (box.hidden) return;
    const counts = new Map(), high = new Set();
    for (const e of unavailable() ? [] : Filters.apply(events, { ...state, range: { ...picked } }, groups, dayOf)) {
      const k = dayOf(e);
      counts.set(k, (counts.get(k) || 0) + 1);
      if (e.impact === "high") high.add(k);
    }
    const n = c => `${c.toLocaleString()} event${c === 1 ? "" : "s"}`;
    let total = 0;
    counts.forEach(c => { total += c; });
    const t = today(), sel = selectedDay();
    const tab = (key, label, count, cls = "", extra = "", aria = label) =>
      `<button type="button" class="daytab${cls}" data-day="${key}" aria-pressed="${(key || null) === (sel || null)}" aria-label="${esc(aria)}: ${n(count)}">
        <span class="dt-day">${label}${extra}</span><span class="dt-n${count ? "" : " is-zero"}">${count.toLocaleString()}</span></button>`;
    let html = tab("", "Week", total, " week", "", "Whole range");
    for (let i = 0; i < days; i++) {
      const k = Time.addDays(picked.from, i);
      // Today shows in the accent colour; no badge or high-impact dot (the Impact column has those).
      html += tab(k, Time.tabDay(k), counts.get(k) || 0, k < t ? " is-past" : k === t ? " is-today" : "", "",
        Time.dayLabel(k) + (k === t ? " (today)" : "") + (high.has(k) ? ", has a high-impact release" : ""));
    }
    box.innerHTML = html;
    // Keep the selected tab in view when the row scrolls sideways (phones).
    const on = box.querySelector('[aria-pressed="true"]');
    if (on && box.scrollWidth > box.clientWidth) box.scrollLeft = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2;
  }
  $("daytabs").addEventListener("click", e => {
    const b = e.target.closest(".daytab");
    if (b) selectDay(b.dataset.day || null);
  });
  $("prevWeek").addEventListener("click", () => setPicked(Time.addDays(picked.from, -7), Time.addDays(picked.to, -7)));
  $("nextWeek").addEventListener("click", () => setPicked(Time.addDays(picked.from, 7), Time.addDays(picked.to, 7)));
  // Date fields work like a JavaFX DatePicker: an editable field showing the locale's
  // short date, committed with Enter or on leaving it (bad text reverts), and a calendar
  // button (or Alt+Down / F4) that opens the calendar.
  for (const [id, end] of [["dateFrom", "from"], ["dateTo", "to"]]) {
    const input = $(id), pick = $(id + "Pick");
    const apply = key => key ? setPicked(end === "from" ? key : picked.from, end === "to" ? key : picked.to, end) : renderDates();
    const open = () => { try { pick.showPicker(); } catch { input.focus(); } };
    input.addEventListener("change", () => apply(Time.parsePickerDate(input.value)));
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") apply(Time.parsePickerDate(input.value));
      else if (e.key === "Escape") renderDates();
      else if (e.key === "F4" || (e.altKey && e.key === "ArrowDown")) { e.preventDefault(); open(); }
    });
    pick.addEventListener("change", () => apply(pick.value));
    $(id + "Box").querySelector(".tb-calbtn").addEventListener("click", e => { e.preventDefault(); if (!input.disabled) open(); });
    // Touch screens: tapping the date opens the calendar instead of the keyboard.
    if (matchMedia("(pointer: coarse)").matches) { input.readOnly = true; input.addEventListener("click", open); }
  }
  // The date fields and the Countries and time zone dropdowns never highlight when clicked.
  // Reached with Tab, they get a faint border (kbd-focus) so keyboard focus stays visible.
  let keyboardNav = false;
  document.addEventListener("keydown", e => { if (e.key === "Tab") keyboardNav = true; }, true);
  document.addEventListener("pointerdown", () => { keyboardNav = false; }, true);
  for (const [control, box] of [["dateFrom", "dateFromBox"], ["dateTo", "dateToBox"], ["countryPreset", "countryPick"], ["tz", "tzPick"]]) {
    $(control).addEventListener("focus", () => $(box).classList.toggle("kbd-focus", keyboardNav));
    $(control).addEventListener("blur", () => $(box).classList.remove("kbd-focus"));
  }

  // ---- Option sources ----------------------------------------------------------
  const visibleTypes = () => [...new Set(events.map(e => e.type))];
  // Fixed order (Holiday first, above a separator; Misc last), like ForexFactory's list.
  function typeOptions() {
    const c = Filters.countBy(events, state, groups, "types", "type", dayOf);
    const have = new Set(visibleTypes());
    const types = Events.TYPES.filter(t => have.has(t)).map(t => ({ value: t, label: t, count: c.get(t) || 0 }));
    if (types[0] && types[0].value === "Holiday" && types[1]) types[1].sep = true;
    return types;
  }
  function impactOptions() {
    const c = Filters.countBy(events, state, groups, "impacts", "impact", dayOf);
    return Events.IMPACTS.map(v => ({
      value: v, label: v[0].toUpperCase() + v.slice(1), count: c.get(v) || 0,
      prefix: `<span class="imp imp-${v}" aria-hidden="true"><i></i><i></i><i></i></span>`,
    }));
  }
  const STATUSES = [["upcoming", "Upcoming"], ["awaiting", "Awaiting"], ["released", "Released"], ["past", "Past"]];
  function statusOptions() {
    const c = Filters.countBy(events, state, groups, "statuses", (e, now) => e.holiday ? null : Events.status(e, now).kind, dayOf);
    return STATUSES.map(([v, label]) => ({ value: v, label, count: c.get(v) || 0 }));
  }
  // Countries in the data plus every group member, so any group can be picked.
  function allCountryCodes() {
    const s = new Set(events.map(e => e.country));
    groups.all().forEach(g => g.members.forEach(c => s.add(c)));
    return [...s];
  }

  // ---- Toolbar -----------------------------------------------------------------
  const typeDD = new MultiSelect($("ddTypes"), {
    label: "Categories", icon: Icons.list,
    options: typeOptions, selected: () => state.types,
    onToggle: v => { state.types = Filters.toggle(state.types, v, visibleTypes()); render(); },
    onAll: () => { state.types = null; render(); },
    onClear: () => { state.types = new Set(); render(); },
  });
  const impactDD = new MultiSelect($("ddImpact"), {
    label: "Impact", icon: Icons.gauge,
    options: impactOptions, selected: () => state.impacts,
    onToggle: v => { state.impacts = Filters.toggle(state.impacts, v, Events.IMPACTS); render(); },
    onAll: () => { state.impacts = null; render(); },
    onClear: () => { state.impacts = new Set(); render(); },
  });
  const statusDD = new MultiSelect($("ddStatus"), {
    label: "Status", icon: Icons.clock,
    options: statusOptions, selected: () => state.statuses,
    onToggle: v => { state.statuses = Filters.toggle(state.statuses, v, STATUSES.map(s => s[0])); render(); },
    onAll: () => { state.statuses = null; render(); },
    onClear: () => { state.statuses = new Set(); render(); },
  });


  // Countries dropdown on the title line: one preset at a time (Entire world, a built-in
  // group or one of yours), or "Choose countries…" for individual countries without
  // making a group. Picked countries show as the country's name or "3 countries".
  let presetKey = "";
  function renderCountryPreset() {
    const sel = $("countryPreset");
    const key = groups.all().map(g => g.id + ":" + g.name).join("|");
    if (key !== presetKey) {
      presetKey = key;
      const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
      const custom = groups.custom();
      // No headings: presets, then your groups and the two actions, split by separators
      // (a JavaFX ChoiceBox takes Separator items the same way).
      sel.innerHTML = opt("all", "Entire world")
        + groups.builtins().map(g => opt(g.id, g.name)).join("")
        + `<option value="custom" disabled></option>`
        + (custom.length ? `<hr>${custom.map(g => opt(g.id, g.name)).join("")}` : "")
        + `<hr>${opt("choose", "Choose countries…")}${opt("edit", "Edit groups…")}`;
    }
    const single = state.groups.size === 1 && !state.countries.size && groups.get([...state.groups][0]);
    const picked = !state.groups.size ? [...state.countries] : [];
    const custom = sel.querySelector('option[value="custom"]');
    custom.textContent = picked.length === 1 ? Countries.name(picked[0]) : picked.length ? `${picked.length} countries` : "Custom selection";
    custom.hidden = !(state.groups.size || state.countries.size) || !!single;
    sel.value = !state.groups.size && !state.countries.size ? "all" : single ? [...state.groups][0] : "custom";
    $("countryPick").title = picked.length > 1 ? picked.map(Countries.name).sort().join(", ") : "Countries";
    fitSelect(sel);
  }
  $("countryPreset").addEventListener("change", e => {
    const v = e.target.value;
    if (v === "edit") { renderCountryPreset(); return openSettings("groups"); }
    if (v === "choose") { renderCountryPreset(); MultiSelect.closeOthers(); return picker.open(); }
    state.groups = v === "all" ? new Set() : new Set([v]);
    state.countries = new Set();
    render();
  });

  const picker = new CountryPicker($("countryDialog"), {
    countries: allCountryCodes,
    selection: () => [...(Filters.countrySet(state, groups) || [])], // start from what's shown
    onApply: codes => { state.groups = new Set(); state.countries = new Set(codes); render(); },
    onSaveAsGroup: codes => { openSettings("groups"); settings.newGroup(codes); },
  });
  $("countryDialog").addEventListener("close", () => { if (!settings.isOpen) $("countryPreset").focus(); });

  // ---- Time zone -------------------------------------------------------------------
  // The status-bar dropdown changes the zone for this session. The default zone
  // (Settings → Display) is saved and used whenever the app opens.
  function zoneOptionsHtml(selected) {
    const at = new Date(), byGroup = new Map();
    for (const z of Time.ZONES) {
      if (!byGroup.has(z.group)) byGroup.set(z.group, []);
      byGroup.get(z.group).push(z);
    }
    const extra = Time.ZONES.some(z => z.id === selected) ? ""
      : `<option value="${esc(selected)}">${esc(selected)} (${Time.offset(selected, at)})</option>`;
    // Regions split by separators rather than headings (a JavaFX ChoiceBox takes Separator items).
    return extra + [...byGroup].map(([, zs]) =>
      zs.map(z => `<option value="${esc(z.id)}">${esc(Time.zoneLabel(z, at))}</option>`).join("")).join("<hr>");
  }
  function buildZones() { $("tz").innerHTML = zoneOptionsHtml(zone); $("tz").value = zone; fitSelect($("tz")); }
  // A select is as wide as its longest option; size it to the chosen one so the ▾ sits by the text.
  const measure = document.createElement("canvas").getContext("2d");
  function fitSelect(sel) {
    const cs = getComputedStyle(sel);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
    sel.style.width = Math.ceil(measure.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4) + "px";
  }
  document.fonts && document.fonts.ready.then(() => { fitSelect($("tz")); fitSelect($("countryPreset")); }); // re-fit once Inter has loaded
  function setZone(id) {
    const wasDefault = isDefaultRange();
    zone = id;
    if (wasDefault) picked = defaultRange(); // keep "this week" relative to the new zone
    shownWeek = defaultRange();
    buildZones();
    renderZoneNote();
    rangeChanged();
  }
  $("tz").addEventListener("focus", () => buildZones()); // refresh offsets across DST changes
  $("tz").addEventListener("change", e => setZone(e.target.value));
  function zoneText() {
    const z = Time.ZONES.find(x => x.id === zone);
    const off = Time.offset(zone);
    if (zone === "local") return `local time, ${Time.LOCAL_ZONE.replace(/_/g, " ")} (${off})`;
    if (zone === "UTC") return "UTC";
    return `${z ? z.city : zone} time (${off})`;
  }
  function renderZoneNote() { $("thTime").title = "Times in " + zoneText(); }

  const q = $("q"), qClear = $("qClear");
  function setQuery(v) { q.value = v; state.q = v; qClear.hidden = !v; render(); }
  q.addEventListener("input", () => { state.q = q.value; qClear.hidden = !q.value; render(); });
  q.addEventListener("keydown", e => { if (e.key === "Escape" && q.value) { e.preventDefault(); setQuery(""); } });
  qClear.addEventListener("click", () => { setQuery(""); q.focus(); });
  // Phones: the date fields open from the compact range button.
  $("rangeBtn").addEventListener("click", () => {
    const open = !$("topbar").classList.contains("show-dates");
    $("topbar").classList.toggle("show-dates", open);
    $("rangeBtn").setAttribute("aria-expanded", open);
  });
  // Phones: search hides behind an icon to save a row of the top bar.
  $("searchToggle").addEventListener("click", () => {
    const open = !$("topbar").classList.contains("show-search");
    $("topbar").classList.toggle("show-search", open);
    $("searchToggle").setAttribute("aria-expanded", open);
    if (open) q.focus();
  });
  // Phones: date headers stick just below the sticky top bar, so track its height.
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", $("topbar").getBoundingClientRect().height + "px")).observe($("topbar"));
  }

  // ---- Settings ----------------------------------------------------------------
  const settings = new SettingsPanel($("settings"), {
    groups, alerts,
    countries: allCountryCodes,
    valueColors: {
      get: () => valueColors,
      set: v => { valueColors = v; applyValueColors(); savePrefs(); },
      current: () => {
        const cs = getComputedStyle(document.documentElement);
        return { pos: cs.getPropertyValue("--pos").trim(), neg: cs.getPropertyValue("--neg").trim() };
      },
    },
    theme: { get: () => theme, set: t => { theme = t; applyTheme(); savePrefs(); } },
    timezone: {
      options: zoneOptionsHtml,
      get: () => defaultZone,
      set: id => { defaultZone = id; savePrefs(); setZone(id); }, // also switch the current view
    },
    onClose: () => { $("gear").setAttribute("aria-expanded", "false"); if (!$("alarmDialog").open) $("gear").focus(); },
  });
  function openSettings(tab) {
    MultiSelect.closeOthers();
    settings.open(tab);
    $("gear").setAttribute("aria-expanded", "true");
  }
  $("gear").addEventListener("click", () => settings.isOpen ? settings.close() : openSettings());

  groups.onChange(() => {
    for (const id of state.groups) if (!groups.get(id)) state.groups.delete(id); // deleted group
    render(); // edits change membership, so results can change
  });

  // ---- Reset filters ---------------------------------------------------------------
  // No chips: each dropdown already shows its value. A "Reset filters" link appears at
  // the start of the filter line whenever a filter differs from its default.
  const filtersAreDefault = () => !state.q.trim() && !state.types && !state.impacts && !state.statuses && state.holidays === "show" && !state.countries.size
    && state.groups.size === DEFAULT_GROUPS.length && DEFAULT_GROUPS.every(g => state.groups.has(g));
  function renderActive(shown) {
    $("active").innerHTML = filtersAreDefault() ? ""
      : `<button type="button" class="linkbtn" data-act="filters" title="Back to G20, all impact levels, categories and statuses, no search">Reset filters</button>`;
    const total = events.filter(e => !e.dup).length;
    $("count").innerHTML = `<b>${shown.toLocaleString()}</b> of ${total.toLocaleString()} events`;
  }
  function resetFilters() {
    Object.assign(state, { q: "", types: null, impacts: null, statuses: null, holidays: "show", groups: new Set(DEFAULT_GROUPS), countries: new Set() });
    q.value = ""; qClear.hidden = true;
  }
  function clearFilter(act) {
    switch (act) {
      case "types": state.types = null; break;
      case "impacts": state.impacts = null; break;
      case "statuses": state.statuses = null; break;
      case "filters": resetFilters(); break;
      case "range": picked = defaultRange(); day = null; return rangeChanged();
      case "all": resetFilters(); picked = defaultRange(); day = null; return rangeChanged();
    }
    render();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("#active [data-act], .empty-row [data-act]");
    if (b) clearFilter(b.dataset.act);
  });

  // ---- Table -----------------------------------------------------------------------
  const table = new EventsTable($("rows"), {
    alerts,
    onBell: e => alerts.toggle(e.id, e.ts, `${e.name} · ${e.event}`, { awaitRelease: e.ts <= Date.now() }),
  });

  function emptyHtml() {
    if (loading) return `<div class="empty"><strong>Loading…</strong></div>`;
    if (unavailable()) {
      return `<div class="empty"><strong>Can't load these dates right now.</strong>
        <span>The data service can't be reached and there's no saved copy of these dates. Retrying automatically.</span></div>`;
    }
    const { from, to } = state.range;
    if (!events.some(e => { const d = dayOf(e); return d >= from && d <= to; })) {
      const when = from === to ? Time.dayLabel(from) : `${Time.shortDay(from)} and ${Time.shortDay(to)}`;
      return `<div class="empty"><strong>No events ${from === to ? "on" : "between"} ${esc(when)}.</strong>
        <button type="button" class="btn sm" data-act="range">Show this week</button></div>`;
    }
    const why = state.types && !state.types.size ? ["No categories are selected.", "types", "Select all categories"]
      : state.impacts && !state.impacts.size ? ["No impact levels are selected.", "impacts", "Select all impact levels"]
      : state.statuses && !state.statuses.size ? ["No statuses are selected.", "statuses", "Select all statuses"]
      : ["No events match these filters.", "all", "Clear all filters"];
    return `<div class="empty"><strong>${why[0]}</strong><span>Try widening a filter or clearing the search.</span>
      <button type="button" class="btn sm" data-act="${why[1]}">${why[2]}</button></div>`;
  }
  function renderTable() {
    const rows = unavailable() ? [] : Filters.apply(events, state, groups, dayOf);
    // Showing this week: days before today start folded (the user can unfold them).
    const t = today(), thisWeek = !day && isDefaultRange();
    table.render(rows, { zone, now: Date.now(), emptyHtml: emptyHtml(), autoFold: d => thisWeek && d < t });
    return rows.length;
  }

  function render() {
    typeDD.render(); impactDD.render(); statusDD.render();
    renderCountryPreset();
    $("searchToggle").classList.toggle("has-query", !!state.q.trim());
    renderDates();
    renderDayTabs();
    renderActive(renderTable());
  }

  // ---- Alerts: alarm window, notifications, title -------------------------------
  function alertText(id) {
    const e = byId.get(id), info = alerts.info(id) || {};
    const label = e ? `${e.name} · ${e.event}` : info.label || "Event";
    const ms = (e ? e.ts : info.eventTs) - Date.now();
    const when = e && e.actual != null ? "released" : ms > 0 ? `${Time.timeLeft(ms)} until the report` : "due now";
    return { label, when };
  }
  const alarm = new AlarmDialog($("alarmDialog"), {
    items: () => alerts.triggered().map(id => {
      const e = byId.get(id), info = alerts.info(id) || {};
      const ts = e ? e.ts : info.eventTs;
      const d = new Date(ts);
      return {
        id, ts, released: !!e && e.actual != null,
        flag: e ? Countries.flag(e.country) : "",
        title: e ? `${e.name} · ${e.event}` : info.label || "Event",
        scheduled: `${Time.dayLabel(Time.dayKey(d, zone))}, ${Time.time(d, zone)} (${Time.offset(zone, d)})`,
      };
    }),
    onAcknowledge: () => alerts.acknowledgeAll(),
  });
  function syncAlarm() {
    const n = alerts.triggered().length;
    document.title = (n ? `(${n}) ` : "") + "Economic Calendar";
    if (n) { MultiSelect.closeOthers(); if (settings.isOpen) settings.close(); }
    alarm.sync();
  }

  // Screen readers hear new alarms; the alarm window shows them to everyone.
  function announce(ids) {
    $("announce").textContent = ids.map(alertText).map(t => `Alert: ${t.label}, ${t.when}.`).join(" ");
  }

  alerts.onChange(change => {
    const now = Date.now();
    if (change.type === "settings") table.refreshAlerts(null, now);
    else table.refreshAlerts(change.ids, now);
    if (change.type === "fired") announce(change.ids);
    if (change.type !== "settings") syncAlarm();
  });

  // ---- Clock -------------------------------------------------------------------------
  // With a Status filter on, a row whose status changes (e.g. Upcoming → Awaiting)
  // may need to appear or disappear, so re-render when any status changes.
  let statusSig = "";
  function tick() {
    const now = Date.now();
    if (state.statuses) {
      const sig = events.map(e => Events.status(e, now).kind[0]).join("");
      if (statusSig && sig !== statusSig) render();
      statusSig = sig;
    } else statusSig = "";
    alerts.check();
    scheduleReleasePoll();
    if (table.tick(now)) { // calendar day rolled over: "this week" and "today" follow the clock
      if (picked.from === shownWeek.from && picked.to === shownWeek.to) picked = defaultRange();
      shownWeek = defaultRange();
      rangeChanged();
    }
  }
  setInterval(tick, TICK_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

  // ---- Data loading --------------------------------------------------------------
  // Live Finnhub data, refreshed every few minutes (and about a minute after each
  // release, see scheduleReleasePoll) so actuals replace "Awaiting" and alerts
  // waiting on a release fire. Every good response is also saved in this browser,
  // so the page opens instantly with the last data and, when the service can't be
  // reached, keeps showing it (labeled with when it was saved) while it retries.
  // mode: "live" (fetched this session), "saved" (from the local copy), "none".
  let loading = true, lastRaw = "", refreshTimer = null, mode = "none", loaded = null, rangeTimer = null;
  let offline = false, savedAt = 0;
  // Finnhub dates are UTC; pad a day each side so zone-shifted events are included.
  const fetchWindow = () => ({ from: Time.addDays(state.range.from, -1), to: Time.addDays(state.range.to, 1) });
  const clock = () => Time.time(new Date(), zone);

  function setSource(text, kind = "") {
    const el = $("source");
    el.className = "source" + (kind ? " is-" + kind : "");
    el.textContent = text;
  }
  // Local copy: the last few fetch windows, newest first. If storage is full, keep fewer.
  const CACHE_KEY = "calendarCache", CACHE_MAX = 4;
  const covers = (w, need) => !!w && w.from <= need.from && w.to >= need.to;
  function saveCache(win, text) {
    const list = (Store.get(CACHE_KEY, []) || []).filter(c => c.from !== win.from || c.to !== win.to);
    list.unshift({ from: win.from, to: win.to, savedAt: Date.now(), text });
    for (let n = Math.min(list.length, CACHE_MAX); n > 0 && !Store.set(CACHE_KEY, list.slice(0, n)); n--);
  }
  const fromCache = need => (Store.get(CACHE_KEY, []) || []).find(c => covers(c, need)) || null;
  function useCache(c) {
    mode = "saved"; loaded = { from: c.from, to: c.to }; savedAt = c.savedAt;
    if (c.text !== lastRaw) { lastRaw = c.text; load(JSON.parse(c.text)); }
  }
  // Offline and the dates shown aren't fully in what's loaded: show nothing rather than a partial week.
  const unavailable = () => offline && !covers(loaded, fetchWindow());
  const savedLabel = () => { const d = new Date(savedAt); return `${Time.shortDay(Time.dayKey(d, zone))}, ${Time.time(d, zone)}`; };

  function load(raw) {
    loading = false;
    events = Events.normalize(raw);
    byId = new Map(events.map(e => [e.id, e]));
    render();
    alerts.check(); // window opened while the page was closed, or an awaited release is in
    syncAlarm();    // alerts still unacknowledged from before a reload
  }

  async function refreshLive() {
    const win = fetchWindow();
    try {
      const text = await Finnhub.fetchCalendar(apiKey, win);
      mode = "live"; loaded = win; offline = false;
      saveCache(win, text);
      if (text !== lastRaw) { lastRaw = text; load(JSON.parse(text)); } // skip re-render when unchanged
      else if (loading) { loading = false; render(); }
      lastUpdated = clock();
      setSource(`Live · updated ${lastUpdated}`, "live");
      renderRefresh();
      scheduleReleasePoll();
    } catch (err) {
      offline = true;
      const c = fromCache(win);
      if (mode === "live" && covers(loaded, win)) {
        setSource(`Update failed at ${clock()}; showing data from ${lastUpdated}. Retrying automatically`, "warn");
      } else if (c) {
        useCache(c);
        setSource(`Can't reach the data service. Showing data saved ${savedLabel()}. Retrying automatically`, "warn");
      } else {
        setSource(`${err.message[0].toUpperCase()}${err.message.slice(1)}. Retrying automatically`, "warn");
      }
      if (loading) { loading = false; }
      render();
      renderRefresh();
    }
  }
  // Fetch again when the dates shown go beyond what's loaded. A saved copy that
  // covers the new dates shows straight away while the fetch runs.
  function ensureRangeLoaded() {
    if (loading) return;
    const need = fetchWindow();
    if (mode === "live" && covers(loaded, need)) return;
    if (!covers(loaded, need)) { const c = fromCache(need); if (c) useCache(c); }
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(() => {
      setSource(`Loading ${Time.shortDay(state.range.from)} – ${Time.shortDay(state.range.to)}…`);
      startRefresh();
    }, 400);
  }
  function startRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshLive, REFRESH_MS);
    return refreshLive();
  }

  // Refresh link (right end of the filter line). Reads "Refreshing…" while fetching, then rests
  // for 10 seconds so repeated clicks don't use up the API quota. The tooltip says
  // when the data was last updated. Automatic updates carry on regardless.
  const REFRESH_REST = 10e3;
  let refreshing = false, lastUpdated = "";
  function renderRefresh() {
    const b = $("refreshBtn");
    b.textContent = refreshing ? "Refreshing…" : "Refresh";
    b.title = refreshing ? "Refreshing…"
      : mode === "saved" ? `Showing data saved ${savedLabel()}`
      : lastUpdated ? `Last updated ${lastUpdated}` : "Refresh the calendar";
  }
  $("refreshBtn").addEventListener("click", async () => {
    const b = $("refreshBtn");
    if (refreshing || b.disabled) return;
    refreshing = true; b.disabled = true; renderRefresh();
    await startRefresh();
    refreshing = false; renderRefresh();
    setTimeout(() => { b.disabled = false; }, REFRESH_REST);
  });

  // ---- Release polling ------------------------------------------------------------
  // About a minute after each scheduled release, fetch again so the actual value and
  // "Released" show up promptly instead of at the next 5-minute refresh. Releases at
  // the same time share one fetch; speeches, holidays and released events don't count.
  // tick() re-checks the schedule, so a failed fetch or a sleeping computer recovers.
  const RELEASE_POLL_DELAY = 60e3;
  let releaseTimer = null, releaseDue = Infinity;
  function scheduleReleasePoll() {
    const now = Date.now();
    let next = Infinity;
    if (mode === "live") {
      for (const e of events) {
        const due = e.ts + RELEASE_POLL_DELAY;
        if (due > now && due < next && e.actual == null && e.expectsValue && !e.holiday) next = due;
      }
    }
    if (next === releaseDue) return; // already scheduled
    clearTimeout(releaseTimer);
    releaseDue = next;
    if (next !== Infinity) releaseTimer = setTimeout(() => { releaseDue = Infinity; refreshLive(); }, Math.min(next - now, 2 ** 31 - 1));
  }

  // Logging out also removes the saved copy, so the data isn't readable without logging in.
  $("logout").addEventListener("click", () => { Store.set(CACHE_KEY, []); onLogout(); });

  buildZones();
  renderZoneNote();
  const saved = fromCache(fetchWindow());
  if (saved) useCache(saved); // open with the last data straight away
  else render();              // empty table with the loading message
  setSource("Loading…");
  startRefresh();
}
