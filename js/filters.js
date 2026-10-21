// ---- Filtering ------------------------------------------------------------
// The one place that decides whether an event is shown. Every filter combines
// with every other. The time zone only matters to the date range, because
// "Oct 21" covers different hours in Tokyo and New York; `dayOf` gives an
// event's calendar date in the zone being displayed.
//
// Multi-select sets use null for "everything" (no filter) and an explicit Set
// otherwise, so "Clear" (empty Set) and "All" (null) are distinct states.
const Filters = (() => {
  function initial() {
    return {
      q: "",
      types: null,
      impacts: null,
      holidays: "show",       // "hide" | "show" | "only"
      groups: new Set(),      // selected group ids (built-in or custom)
      countries: new Set(),   // individually selected country codes
      dedupe: true,           // hide repeats of the same release (always on)
      range: null,            // { from, to } inclusive "YYYY-MM-DD" dates, or null for all
    };
  }

  // Union of every selected group's members and individual countries; a Set
  // naturally collapses overlaps (FR in both G7 and Eurozone counts once).
  // null means no country filter.
  function countrySet(state, groups) {
    if (!state.groups.size && !state.countries.size) return null;
    const out = new Set(state.countries);
    for (const id of state.groups) {
      const g = groups.get(id);
      if (g) g.members.forEach(c => out.add(c));
    }
    return out;
  }

  // `skip` leaves one facet out so dropdown counts show what toggling it would give.
  function matches(e, state, ctx, skip) {
    if (state.dedupe && e.dup) return false;
    if (state.holidays === "hide" ? e.holiday : state.holidays === "only" && !e.holiday) return false;
    if (skip !== "impacts" && state.impacts && !state.impacts.has(e.impact)) return false;
    if (skip !== "types" && state.types && !state.types.has(e.type)) return false;
    if (skip !== "countries" && ctx.countries && !ctx.countries.has(e.country)) return false;
    if (ctx.q && !e.event.toLowerCase().includes(ctx.q)) return false;
    if (state.range) {
      const day = ctx.dayOf(e);
      if (day < state.range.from || day > state.range.to) return false;
    }
    return true;
  }

  // Without a zone, dates are the UTC dates Finnhub uses.
  const utcDay = e => e.time.slice(0, 10);

  function context(state, groups, dayOf = utcDay) {
    return { countries: countrySet(state, groups), q: state.q.trim().toLowerCase(), dayOf };
  }

  function apply(events, state, groups, dayOf) {
    const ctx = context(state, groups, dayOf);
    return events.filter(e => matches(e, state, ctx));
  }

  function countBy(events, state, groups, skip, key, dayOf) {
    const ctx = context(state, groups, dayOf);
    const m = new Map();
    for (const e of events) if (matches(e, state, ctx, skip)) m.set(e[key], (m.get(e[key]) || 0) + 1);
    return m;
  }

  // Toggle one value in a null-means-all set, collapsing back to null when full.
  function toggle(set, value, universe) {
    const next = new Set(set || universe);
    next.has(value) ? next.delete(value) : next.add(value);
    return universe.every(v => next.has(v)) ? null : next;
  }

  return { initial, countrySet, matches, apply, countBy, toggle };
})();
