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
// Bell clicks:   none -> armed -> none,   triggered -> acknowledged -> none
// Demo:          armed -> triggered (demo) -> acknowledging re-arms it, so the
//                real alert still goes off at its scheduled time
// Alerts run in this page only. Nothing fires while the page is closed; an armed
// alert whose window opened meanwhile fires on the next check after reopening.
const Alerts = (() => {
  const UNITS = { minutes: 60e3, hours: 3600e3, days: 86400e3 };
  const MAX_LEAD = { minutes: 60 * 24 * 30, hours: 24 * 30, days: 30 };
  // Settings are an object so more options can be added without migrations;
  // unknown or missing keys fall back to these defaults.
  const DEFAULT_SETTINGS = { lead: { value: 10, unit: "minutes" } };

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

    // id -> { state, eventTs, firedAt? }
    const states = new Map();
    const raw = store.get("alertStates", {});
    if (raw && typeof raw === "object") {
      for (const [id, s] of Object.entries(raw)) {
        if (s && ["armed", "triggered", "acknowledged"].includes(s.state) && Number.isFinite(s.eventTs)) states.set(id, s);
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

    // A demo alarm goes back to armed; a real one becomes acknowledged.
    function acked(s) {
      if (!s.demo) return { ...s, state: "acknowledged", acknowledgedAt: now() };
      const { demo, firedAt, ...rest } = s;
      return { ...rest, state: "armed" };
    }

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

    // Demo: set off every armed alert now. Returns the fired ids.
    function demoFire() {
      const t = now(), fired = [];
      for (const [id, s] of states) {
        if (s.state === "armed") { states.set(id, { ...s, state: "triggered", firedAt: t, demo: true }); fired.push(id); }
      }
      if (fired.length) { persist(); emit({ type: "fired", ids: fired, demo: true }); }
      return fired;
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

    function updateSettings(patch) {
      const next = { ...settings, ...patch };
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

    function clearAll() {
      const ids = [...states.keys()];
      states.clear(); persist();
      emit({ type: "state", ids });
    }

    return {
      stateOf, canArm, toggle, acknowledge, acknowledgeAll, check, demoFire, triggered, counts, fireTime, info, clearAll,
      settings: () => settings, updateSettings,
      onChange: fn => listeners.add(fn),
    };
  }

  return { UNITS, DEFAULT_SETTINGS, validateLead, describeLead, create };
})();
