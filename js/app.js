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
    $("dateFrom").value = picked.from;
    $("dateTo").value = picked.to;
    const t = $("todayBtn");
    t.setAttribute("aria-pressed", day === "today");
    t.title = day === "today" ? "Showing today only. Click to show the selected dates" : "Show today only";
    // Only Today locks the range. With another day picked, the fields stay usable and
    // changing them goes back to showing the whole range (see setPicked).
    for (const id of ["dateFrom", "dateTo", "prevWeek", "nextWeek", "rangeBtn"]) $(id).disabled = day === "today";
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
  // Counts reflect every other filter, and a red dot marks days with a high-impact release.
  function renderDayTabs() {
    const box = $("daytabs");
    const days = Time.daysBetween(picked.from, picked.to) + 1;
    box.hidden = loading || days < 2 || days > 7;
    if (box.hidden) return;
    const counts = new Map(), high = new Set();
    for (const e of Filters.apply(events, { ...state, range: { ...picked } }, groups, dayOf)) {
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
        <span class="dt-day">${label}${extra}</span><span class="dt-n">${n(count)}</span></button>`;
    let html = tab("", "Week", total, " week", "", "Whole range");
    for (let i = 0; i < days; i++) {
      const k = Time.addDays(picked.from, i);
      html += tab(k, Time.tabDay(k), counts.get(k) || 0, k < t ? " is-past" : "",
        (k === t ? ` <span class="dt-today">Today</span>` : "") + (high.has(k) ? `<span class="dt-hi" title="High-impact release"></span>` : ""),
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
  $("dateFrom").addEventListener("change", e => e.target.value ? setPicked(e.target.value, picked.to, "from") : renderDates());
  $("dateTo").addEventListener("change", e => e.target.value ? setPicked(picked.from, e.target.value, "to") : renderDates());
  // Clicking a date field opens the picker rather than selecting a part of the date.
  for (const id of ["dateFrom", "dateTo"]) {
    const input = $(id);
    input.addEventListener("click", () => { try { input.showPicker(); } catch { /* older browsers: native behavior */ } });
  }
  // The date fields, Holidays and the time zone clock never highlight when clicked.
  // Reached with Tab, they get a faint border (kbd-focus) so keyboard focus stays visible.
  let keyboardNav = false;
  document.addEventListener("keydown", e => { if (e.key === "Tab") keyboardNav = true; }, true);
  document.addEventListener("pointerdown", () => { keyboardNav = false; }, true);
  for (const [control, box] of [["dateFrom", "dateFromBox"], ["dateTo", "dateToBox"], ["holidays", "holidaysPick"]]) {
    $(control).addEventListener("focus", () => $(box).classList.toggle("kbd-focus", keyboardNav));
    $(control).addEventListener("blur", () => $(box).classList.remove("kbd-focus"));
  }

  // ---- Option sources ----------------------------------------------------------
  const visibleTypes = () => [...new Set(events.map(e => e.type))].filter(t => t !== "Holiday" || state.holidays !== "hide");
  function typeOptions() {
    const c = Filters.countBy(events, state, groups, "types", "type", dayOf);
    return visibleTypes()
      .sort((a, b) => (c.get(b) || 0) - (c.get(a) || 0) || a.localeCompare(b))
      .map(t => ({ value: t, label: t, count: c.get(t) || 0 }));
  }
  function impactOptions() {
    const c = Filters.countBy(events, state, groups, "impacts", "impact", dayOf);
    return Events.IMPACTS.map(v => ({
      value: v, label: v[0].toUpperCase() + v.slice(1), count: c.get(v) || 0,
      prefix: `<span class="imp imp-${v}" aria-hidden="true"><i></i><i></i><i></i></span>`,
    }));
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

  function setHolidays(mode) {
    state.holidays = mode;
    // Showing holidays is an explicit ask to see them, even under a category filter;
    // hiding them removes the Holiday category from it.
    if (state.types) {
      mode === "hide" ? state.types.delete("Holiday") : state.types.add("Holiday");
      if (visibleTypes().every(t => state.types.has(t))) state.types = null;
    }
    render();
  }
  $("holidays").addEventListener("change", e => setHolidays(e.target.value));

  const picker = new CountryPicker($("countryDialog"), {
    groups,
    countries: () => {
      const c = Filters.countBy(events, state, groups, "countries", "country", dayOf);
      return allCountryCodes().map(code => ({ code, count: c.get(code) || 0 }));
    },
    selection: () => ({ groups: state.groups, countries: state.countries }),
    onApply: sel => { state.groups = new Set(sel.groups); state.countries = new Set(sel.countries); render(); },
    onManageGroups: () => openSettings("groups"),
  });
  $("countryBtn").addEventListener("click", () => { MultiSelect.closeOthers(); picker.open(); });
  $("countryDialog").addEventListener("close", () => $("countryBtn").focus());

  function renderCountryBtn() {
    const btn = $("countryBtn");
    const names = [...state.groups].map(id => groups.get(id)).filter(Boolean);
    const codes = [...state.countries];
    const n = names.length + codes.length;
    // Groups show as the group's own badge (stacked when there are several); otherwise a
    // globe. The number counts individually picked countries only, never groups.
    let icon = Icons.globe;
    if (names.length) {
      const g = names[0], stack = names.length > 1 ? " is-stack" : "";
      icon = g.builtin ? `<span class="gbadge tb-gbadge${stack}">${esc(g.name)}</span>` : `<span class="tb-gicon${stack}">${Icons.layers}</span>`;
    }
    btn.innerHTML = icon + (codes.length ? `<span class="tb-badge">${codes.length}</span>` : "");
    btn.classList.toggle("has-group", names.length > 0);
    const label = n ? [...names.map(g => g.name), ...codes.map(Countries.name)].join(", ") : "All countries";
    btn.setAttribute("aria-label", `Countries: ${label}. Change`);
    btn.title = "Countries: " + label;
  }

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
    return extra + [...byGroup].map(([g, zs]) =>
      `<optgroup label="${esc(g)}">${zs.map(z => `<option value="${esc(z.id)}">${esc(Time.zoneLabel(z, at))}</option>`).join("")}</optgroup>`).join("");
  }
  function buildZones() { $("tz").innerHTML = zoneOptionsHtml(zone); $("tz").value = zone; fitZoneSelect(); }
  // A select is as wide as its longest option; size it to the chosen one so the ▾ sits by the text.
  const measure = document.createElement("canvas").getContext("2d");
  function fitZoneSelect() {
    const sel = $("tz"), cs = getComputedStyle(sel);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "";
    sel.style.width = Math.ceil(measure.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 4) + "px";
  }
  document.fonts && document.fonts.ready.then(fitZoneSelect); // re-fit once Inter has loaded
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

  // ---- Active filters ------------------------------------------------------------
  function listText(set, labels = v => v) {
    if (!set.size) return "none";
    const xs = [...set].map(labels);
    return xs.length > 2 ? `${xs.slice(0, 2).join(", ")} +${xs.length - 2}` : xs.join(", ");
  }
  function renderActive(shown) {
    const chips = [];
    const chip = (act, html, label, arg = "") =>
      chips.push(`<span class="chip">${html}<button type="button" class="chip-x" data-act="${act}" data-arg="${esc(arg)}" aria-label="Remove filter: ${esc(label)}" title="Remove">${Icons.x}</button></span>`);
    if (state.types) chip("types", `Categories: ${esc(listText(state.types))}`, "categories");
    if (state.impacts) chip("impacts", `Impact: ${esc(listText(state.impacts, v => v[0].toUpperCase() + v.slice(1)))}`, "impact");
    for (const id of state.groups) { const g = groups.get(id); if (g) chip("group", `${Icons.layers}${esc(g.name)}`, g.name, id); }
    for (const c of state.countries) chip("country", `${Countries.flag(c)}${esc(Countries.name(c))}`, Countries.name(c), c);
    if (state.q.trim()) chip("q", `Search: “${esc(state.q.trim())}”`, "search");
    if (state.holidays !== "show") chip("holidays", `${Icons.calendar}${state.holidays === "hide" ? "Holidays hidden" : "Holidays only"}`, "holidays");
    if (day) chip("day", `${Icons.calendar}${day === "today" ? "Today" : esc(Time.dayLabel(day).replace(/^(\w{3})\w*, (\w+ \d+), \d+$/, "$1, $2"))}`, "single day");
    else if (!isDefaultRange()) {
      chip("range", `${Icons.calendar}${Time.shortDay(picked.from)}${picked.from === picked.to ? "" : " – " + Time.shortDay(picked.to)}`, "date range");
    }
    $("active").innerHTML = chips.join("") + (chips.length > 1 ? `<button type="button" class="linkbtn" data-act="all">Clear all</button>` : "");
    const total = events.filter(e => !e.dup && (state.holidays !== "hide" || !e.holiday)).length;
    $("count").innerHTML = `<b>${shown.toLocaleString()}</b> of ${total.toLocaleString()} events`;
  }
  function clearFilter(act, arg) {
    switch (act) {
      case "types": state.types = null; break;
      case "impacts": state.impacts = null; break;
      case "group": state.groups.delete(arg); break;
      case "country": state.countries.delete(arg); break;
      case "q": q.value = ""; state.q = ""; qClear.hidden = true; break;
      case "holidays": $("holidays").value = "show"; return setHolidays("show");
      case "day": day = null; return rangeChanged();
      case "range": picked = defaultRange(); day = null; return rangeChanged();
      case "all":
        Object.assign(state, { q: "", types: null, impacts: null, holidays: "show", groups: new Set(DEFAULT_GROUPS), countries: new Set() });
        q.value = ""; qClear.hidden = true; $("holidays").value = "show";
        picked = defaultRange(); day = null;
        return rangeChanged();
    }
    render();
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("#active [data-act], .empty-row [data-act]");
    if (b) clearFilter(b.dataset.act, b.dataset.arg);
  });

  // ---- Table -----------------------------------------------------------------------
  const table = new EventsTable($("rows"), {
    alerts,
    onBell: e => alerts.toggle(e.id, e.ts, `${e.name} · ${e.event}`, { awaitRelease: e.ts <= Date.now() }),
  });

  function emptyHtml() {
    if (loading) return `<div class="empty"><strong>Loading…</strong></div>`;
    const { from, to } = state.range;
    if (!events.some(e => { const d = dayOf(e); return d >= from && d <= to; })) {
      const when = from === to ? Time.dayLabel(from) : `${Time.shortDay(from)} and ${Time.shortDay(to)}`;
      const note = mode === "live" || !events.length ? ""
        : `<span>The sample data covers ${Time.shortDay(dayOf(events[0]))} – ${Time.shortDay(dayOf(events[events.length - 1]))}.</span>`;
      return `<div class="empty"><strong>No events ${from === to ? "on" : "between"} ${esc(when)}.</strong>${note}
        <button type="button" class="btn sm" data-act="range">Show this week</button></div>`;
    }
    const why = state.types && !state.types.size ? ["No categories are selected.", "types", "Select all categories"]
      : state.impacts && !state.impacts.size ? ["No impact levels are selected.", "impacts", "Select all impact levels"]
      : ["No events match these filters.", "all", "Clear all filters"];
    return `<div class="empty"><strong>${why[0]}</strong><span>Try widening a filter or clearing the search.</span>
      <button type="button" class="btn sm" data-act="${why[1]}">${why[2]}</button></div>`;
  }
  function renderTable() {
    const rows = Filters.apply(events, state, groups, dayOf);
    // Showing this week: days before today start folded (the user can unfold them).
    const t = today(), thisWeek = !day && isDefaultRange();
    table.render(rows, { zone, now: Date.now(), emptyHtml: emptyHtml(), autoFold: d => thisWeek && d < t });
    return rows.length;
  }

  function render() {
    typeDD.render(); impactDD.render();
    renderCountryBtn();
    $("searchToggle").classList.toggle("has-query", !!state.q.trim());
    renderDates();
    renderDayTabs();
    $("holidays").value = state.holidays;
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
        id, ts, demo: !!info.demo, released: !!e && e.actual != null,
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
  function tick() {
    const now = Date.now();
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
  // waiting on a release fire. If Finnhub fails before anything has
  // loaded, the bundled sample is shown and labeled as not live; the timer keeps
  // retrying and switches to live data once Finnhub answers.
  let loading = true, lastRaw = "", refreshTimer = null, mode = "live", loaded = null, rangeTimer = null;
  // Finnhub dates are UTC; pad a day each side so zone-shifted events are included.
  const fetchWindow = () => ({ from: Time.addDays(state.range.from, -1), to: Time.addDays(state.range.to, 1) });
  const clock = () => Time.time(new Date(), zone);

  function setSource(text, kind = "") {
    const el = $("source");
    el.className = "source" + (kind ? " is-" + kind : "");
    el.textContent = text;
  }
  function load(raw) {
    loading = false;
    events = Events.normalize(raw);
    byId = new Map(events.map(e => [e.id, e]));
    const have = new Set(events.map(e => e.country));
    state.countries.forEach(c => { if (!have.has(c)) state.countries.delete(c); });
    render();
    alerts.check(); // window opened while the page was closed, or an awaited release is in
    syncAlarm();    // alerts still unacknowledged from before a reload
  }

  async function refreshLive() {
    try {
      const win = fetchWindow();
      const text = await Finnhub.fetchCalendar(apiKey, win);
      mode = "live";
      loaded = win;
      if (text !== lastRaw) { lastRaw = text; load(JSON.parse(text)); } // skip re-render when unchanged
      setSource(`Live · updated ${clock()}`, "live");
      scheduleReleasePoll();
    } catch (err) {
      if (mode === "live" && lastRaw) {
        setSource(`Live · update failed at ${clock()} (${err.message}); retrying automatically`, "warn");
        return;
      }
      if (mode !== "sample") {
        mode = "sample";
        try { load(await Finnhub.loadSample()); }
        catch (e) { loading = false; render(); }
      }
      setSource(`Sample data from Oct 20, 2026, not live: ${err.message}`, "warn");
    }
  }
  // Fetch again when the dates shown go beyond what's loaded (live data only).
  function ensureRangeLoaded() {
    if (mode !== "live" || loading) return;
    const need = fetchWindow();
    if (loaded && loaded.from <= need.from && loaded.to >= need.to) return;
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

  $("logout").addEventListener("click", () => onLogout());

  buildZones();
  renderZoneNote();
  render(); // empty table with the loading message
  setSource("Loading…");
  startRefresh();
}
