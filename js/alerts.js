// ---- Alerts: settings + per-event state machine -----------------------------
// No DOM here. The UI calls toggle()/acknowledge() and a timer calls check();
// listeners hear about every change.
//
// Per-event states (keyed by stable event id, never row position):
//   (none)        alerts off for the event
//   armed         waiting; fires once now >= eventTime - leadTime, or, when armed
//                 after the scheduled time (awaitRelease), once the actual is published
//   triggered     fired, needs acknowledgment (row highlighted)
//   acknowledged  fired and seen; never fires again for this event
//
// Alerts come from one rule in Settings (on/off, countries, impact levels, categories;
// an empty list means any). sync(events) arms every upcoming event that matches and
// removes armed alerts the rule no longer covers; it's all or nothing, so bells in the
// table only show the state. Alerts that already went off stay until acknowledged.
// Alerts run in this page only. Nothing fires while the page is closed; an armed
// alert whose window opened meanwhile fires on the next check after reopening.
const Alerts = (() => {
  const UNITS = { minutes: 60e3, hours: 3600e3, days: 86400e3 };
  const MAX_LEAD = { minutes: 60 * 24 * 30, hours: 24 * 30, days: 30 };
  // Settings are an object so more options can be added without migrations;
  // unknown or missing keys fall back to these defaults.
  const DEFAULT_SETTINGS = {
    lead: { value: 10, unit: "minutes" },
    enabled: true, // on by default: United States, High impact, any category
    rule: { countries: ["US"], impacts: ["high"], types: [] },
  };
  const IMPACT_LEVELS = ["high", "medium", "low"];

  // Keeps a saved or edited rule well-formed: three lists of strings, no unknown impacts.
  function normalizeRule(r) {
    const list = (v, ok = () => true) => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && ok(x)))] : [];
    if (!r || typeof r !== "object") return { ...DEFAULT_SETTINGS.rule };
    return { countries: list(r.countries), impacts: list(r.impacts, x => IMPACT_LEVELS.includes(x)), types: list(r.types) };
  }
  // Does an event (or a saved alert, which keeps the same fields) match the rule?
  // Every part must match; an empty part matches anything.
  function matchesRule(x, rule) {
    const ok = (list, v) => !list.length || list.includes(v);
    return ok(rule.countries, x.country) && ok(rule.impacts, x.impact) && ok(rule.types, x.type);
  }

  function validateLead(value, unit) {
    if (!(unit in UNITS)) return { error: "Choose minutes, hours or days." };
    const s = String(value).trim();
    if (!/^\d+$/.test(s)) return { error: "Enter a whole number of 0 or more." };
    const n = Number(s);
    if (n > MAX_LEAD[unit]) return { error: `That's more than 30 days. Use at most ${MAX_LEAD[unit]} ${unit}.` };
    return { value: n, unit };
  }

  function describeLead({ value, unit }) {
    if (value === 0) return "at the scheduled time";
    const u = value === 1 ? unit.slice(0, -1) : unit;
    return `${value} ${u} before`;
  }

  // `isReleased(id)` reports whether an event's actual value is out; it drives
  // alerts set on events that are past their time but not yet released.
  function create({ store = Store, now = () => Date.now(), isReleased = () => false } = {}) {
    const saved = store.get("alertSettings", {});
    let settings = {
      ...DEFAULT_SETTINGS, ...(saved && typeof saved === "object" ? saved : {}),
    };
    const lead = validateLead(settings.lead && settings.lead.value, settings.lead && settings.lead.unit);
    settings.lead = lead.error ? { ...DEFAULT_SETTINGS.lead } : lead;
    settings.enabled = settings.enabled === true;
    settings.rule = normalizeRule(settings.rule);

    // id -> { state, eventTs, firedAt? }
    const states = new Map();
    const raw = store.get("alertStates", {});
    if (raw && typeof raw === "object") {
      for (const [id, s] of Object.entries(raw)) {
        if (!s || !["armed", "triggered", "acknowledged"].includes(s.state) || !Number.isFinite(s.eventTs)) continue;
        // A demo alarm saved by an earlier version goes back to armed (the demo feature is gone).
        if (s.demo) { const { demo, firedAt, ...rest } = s; states.set(id, { ...rest, state: "armed" }); }
        else states.set(id, s);
      }
    }
    const listeners = new Set();

    const leadMs = () => settings.lead.value * UNITS[settings.lead.unit];
    function persist() {
      // Drop acknowledged alerts for events more than 30 days old to keep storage small.
      const cutoff = now() - 30 * 86400e3;
      for (const [id, s] of states) if (s.state === "acknowledged" && s.eventTs < cutoff) states.delete(id);
      store.set("alertStates", Object.fromEntries(states));
    }
    function emit(change) { listeners.forEach(fn => fn(change)); }

    const stateOf = id => (states.get(id) || {}).state || "none";
    // A normal alert only makes sense before the event; past events need awaitRelease.
    const canArm = (eventTs, awaitRelease = false) => awaitRelease || eventTs > now();

    // Bell click. `label` describes the event for messages. Set `awaitRelease` for an
    // event past its scheduled time with no actual yet: it fires on release instead.
    // Returns the new state.
    function toggle(id, eventTs, label = "", { awaitRelease = false } = {}) {
      const cur = stateOf(id);
      if (cur === "triggered") return acknowledge(id);
      if (cur === "armed" || cur === "acknowledged") {
        states.delete(id);
      } else {
        if (!canArm(eventTs, awaitRelease)) return "none";
        states.set(id, awaitRelease ? { state: "armed", eventTs, label, awaitRelease } : { state: "armed", eventTs, label });
      }
      persist();
      emit({ type: "state", ids: [id] });
      if (stateOf(id) === "armed") check(); // may already be inside the alert window
      return stateOf(id);
    }

    const acked = s => ({ ...s, state: "acknowledged", acknowledgedAt: now() });

    function acknowledge(id) {
      const s = states.get(id);
      if (!s || s.state !== "triggered") return stateOf(id);
      states.set(id, acked(s));
      persist();
      emit({ type: "state", ids: [id] });
      return stateOf(id);
    }

    function acknowledgeAll() {
      const ids = [];
      for (const [id, s] of states) if (s.state === "triggered") { states.set(id, acked(s)); ids.push(id); }
      if (ids.length) { persist(); emit({ type: "state", ids }); }
      return ids;
    }

    // Fires every armed alert whose window has opened (or whose awaited release is
    // out). Only "armed" can move to "triggered", so an alert can't fire twice.
    // Returns the newly fired ids.
    function check() {
      const t = now(), lead = leadMs(), fired = [];
      for (const [id, s] of states) {
        if (s.state === "armed" && (s.awaitRelease ? isReleased(id) : t >= s.eventTs - lead)) {
          states.set(id, { ...s, state: "triggered", firedAt: t });
          fired.push(id);
        }
      }
      if (fired.length) { persist(); emit({ type: "fired", ids: fired }); }
      return fired;
    }

    // Arms every upcoming event that matches the rule (when alerts are on) and removes
    // armed alerts the rule no longer covers. Alerts that went off are left alone.
    // Repeats of the same release (e.dup) and holidays never alert.
    function sync(events = []) {
      const t = now(), { enabled, rule } = settings, changed = [];
      if (enabled) {
        for (const e of events) {
          if (e.dup || e.holiday || e.ts <= t || states.has(e.id) || !matchesRule(e, rule)) continue;
          states.set(e.id, { state: "armed", eventTs: e.ts, label: `${e.name} · ${e.event}`, country: e.country, impact: e.impact, type: e.type });
          changed.push(e.id);
        }
      }
      for (const [id, s] of states) {
        if (s.state === "armed" && (!enabled || !matchesRule(s, rule))) { states.delete(id); changed.push(id); }
      }
      if (changed.length) { persist(); emit({ type: "state", ids: changed }); check(); }
      return changed;
    }

    function updateSettings(patch) {
      const next = { ...settings, ...patch };
      if ("rule" in patch) next.rule = normalizeRule(patch.rule);
      if ("enabled" in patch) next.enabled = patch.enabled === true;
      if (patch.lead) {
        const v = validateLead(patch.lead.value, patch.lead.unit);
        if (v.error) throw new Error(v.error);
        next.lead = v;
      }
      settings = next;
      store.set("alertSettings", settings);
      emit({ type: "settings" });
      check(); // a longer lead time can open windows immediately
      return settings;
    }

    const triggered = () => [...states].filter(([, s]) => s.state === "triggered").map(([id]) => id);
    const counts = () => {
      const c = { armed: 0, triggered: 0, acknowledged: 0 };
      for (const s of states.values()) c[s.state]++;
      return c;
    };
    // When an armed alert will fire (ms epoch), for tooltips.
    const fireTime = id => { const s = states.get(id); return s ? s.eventTs - leadMs() : null; };
    const info = id => states.get(id) || null;

    // "Clear triggered alerts": forget alerts that went off and were acknowledged (the
    // grey bells). Waiting alerts and ones still needing acknowledgment stay.
    function clearTriggered() {
      const ids = [...states].filter(([, s]) => s.state === "acknowledged").map(([id]) => id);
      ids.forEach(id => states.delete(id));
      if (ids.length) { persist(); emit({ type: "state", ids }); }
      return ids;
    }

    function clearAll() {
      const ids = [...states.keys()];
      states.clear(); persist();
      emit({ type: "state", ids });
    }

    return {
      stateOf, canArm, toggle, acknowledge, acknowledgeAll, check, sync, triggered, counts, fireTime, info, clearTriggered, clearAll,
      settings: () => settings, updateSettings,
      onChange: fn => listeners.add(fn),
    };
  }

  // "10 minutes before upcoming High-impact events in United States, in any category"
  // (lower-case start, so it can follow "Alerts go off ").
  function describeRule(rule, lead, countryName = c => c) {
    const list = xs => xs.length <= 2 ? xs.join(" or ") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
    const imp = rule.impacts.length ? `${list(rule.impacts.map(i => i[0].toUpperCase() + i.slice(1)))}-impact ` : "";
    const where = rule.countries.length ? ` in ${list(rule.countries.map(countryName))}` : " in any country";
    const cats = rule.types.length ? `, in ${list(rule.types)}` : ", in any category";
    const when = lead.value === 0 ? "at the time of" : describeLead(lead);
    return `${when} upcoming ${imp}events${where}${cats}`;
  }

  return { UNITS, DEFAULT_SETTINGS, IMPACT_LEVELS, validateLead, describeLead, describeRule, matchesRule, normalizeRule, create };
})();
