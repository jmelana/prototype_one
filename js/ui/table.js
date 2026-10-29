// ---- Economic events table ---------------------------------------------------
// render() rebuilds rows when filters or the time zone change. tick() and
// refreshAlerts() patch rows and bell cells in place, so periodic updates
// don't reset hover, focus or scroll.
//
// Day headers fold like parent rows in a JavaFX TreeTableView: a disclosure
// triangle on the left (▼ open, ▶ folded); click the header, or press ← / →
// when it has focus. A day's starting state comes from render's `autoFold`
// (past days of the current week); once the user folds or unfolds a day, that
// choice wins for the rest of the session.
//
//   new EventsTable(tbodyEl, { alerts, onBell(event), usePrevious() -> bool })
class EventsTable {
  constructor(tbody, opts) {
    this.tbody = tbody;
    this.opts = opts;
    this.rows = new Map(); // event id -> { tr, e, state }
    this.todayKey = "";
    this.zone = "local";
    this.folds = new Map();     // "YYYY-MM-DD" -> folded? (user's choice)
    this.autoFold = () => false; // default when the user hasn't chosen
    tbody.addEventListener("click", e => {
      const t = e.target.closest(".day-toggle");
      if (t) return this.setDay(t, t.getAttribute("aria-expanded") === "true");
      const b = e.target.closest(".bell");
      if (b) {
        const r = this.rows.get(b.closest("tr").dataset.id);
        if (r) opts.onBell(r.e);
      }
    });
    tbody.addEventListener("keydown", e => {
      const t = e.target.closest(".day-toggle");
      if (t && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); this.setDay(t, e.key === "ArrowLeft"); }
    });
  }

  // Fold (collapse = true) or unfold one day.
  setDay(toggle, collapse) {
    const day = toggle.closest("tr").dataset.day;
    this.folds.set(day, collapse);
    toggle.setAttribute("aria-expanded", !collapse);
    for (const tr of this.tbody.querySelectorAll(`tr[data-id][data-day="${day}"]`)) tr.hidden = collapse;
  }

  static COLS = 8;
  static IMPACT_SHORT = { high: "HIGH", medium: "MED", low: "LOW" };

  // events: already filtered; emptyHtml shown when there are none.
  isFolded(day) { return this.folds.has(day) ? this.folds.get(day) : this.autoFold(day); }

  render(events, { zone, now, emptyHtml, autoFold = () => false }) {
    this.autoFold = autoFold;
    this.zone = zone;
    this.rows.clear();
    this.todayKey = Time.dayKey(new Date(now), zone);
    if (!events.length) {
      this.tbody.innerHTML = `<tr class="empty-row"><td colspan="${EventsTable.COLS}">${emptyHtml}</td></tr>`;
      return;
    }
    // Holidays are date-only (Finnhub marks them 00:00 UTC), so they stay on their
    // own calendar date and lead their day. Everything else is grouped by its date
    // in the selected zone, which can move it to the previous or next day.
    const keyed = events.map(e => ({ e, day: e.holiday ? e.time.slice(0, 10) : Time.dayKey(e.d, zone) }));
    keyed.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) || (b.e.holiday - a.e.holiday) || (a.e.ts - b.e.ts));

    const perDay = new Map();
    for (const { day } of keyed) perDay.set(day, (perDay.get(day) || 0) + 1);
    let out = "", lastDay = "", n = 0; // n: row number within the day, for striping
    for (const { e, day } of keyed) {
      const folded = this.isFolded(day);
      if (day !== lastDay) {
        const rel = day === this.todayKey ? ` <span class="day-tag">Today</span>` : "";
        const c = perDay.get(day);
        out += `<tr class="day" data-day="${day}"><th colspan="${EventsTable.COLS}" scope="colgroup"><button type="button" class="day-toggle" aria-expanded="${!folded}" title="Fold or unfold this day">${Icons.arrow}<span>${Time.dayLabel(day)}</span>${rel}<span class="day-n">${c} event${c === 1 ? "" : "s"}</span></button></th></tr>`;
        lastDay = day;
        n = 0;
      }
      out += this.rowHtml(e, now, n++ % 2 === 1, day, folded);
    }
    this.tbody.innerHTML = out;
    const byId = new Map(events.map(e => [e.id, e]));
    for (const tr of this.tbody.querySelectorAll("tr[data-id]")) {
      const e = byId.get(tr.dataset.id);
      this.rows.set(e.id, { tr, e, state: tr.dataset.status });
    }
  }

  rowHtml(e, now, alt = false, day = "", folded = false) {
    const impactName = e.impact[0].toUpperCase() + e.impact.slice(1);
    const usePrev = this.opts.usePrevious();
    const verdict = Directions.verdict(e, usePrev); // "better" | "worse" | null, shown by the Indicator style
    return `<tr${alt ? ` class="alt"` : ""} data-id="${esc(e.id)}" data-day="${day}"${folded ? " hidden" : ""} data-status="${Events.releaseState(e, now)}" data-alert="${this.opts.alerts.stateOf(e.id)}">
      <td class="c-time">${e.holiday ? `<span class="allday">All day</span>` : Time.time(e.d, this.zone)}</td>
      <td class="c-imp"><span class="imp-chip imp-${e.impact}" title="${impactName} impact" aria-label="${impactName} impact">${EventsTable.IMPACT_SHORT[e.impact]}</span></td>
      <td class="c-ctry" title="${esc(e.name)}">${Countries.flag(e.country)}<span class="cname">${esc(e.name)}</span></td>
      <td class="c-ev"><span class="ev-name${e.holiday ? " hol" : ""}" title="${esc(e.event)} · ${esc(e.type)}">${esc(e.event)}</span></td>
      <td class="num c-act${signClass(e.actual)}${verdict ? " " + verdict : ""}"${verdict ? ` title="${verdictTitle(e, verdict, Directions.basis(e, usePrev))}"` : ""}><span class="val">${fmtVal(e.actual, e.unit)}</span></td>
      <td class="num c-fc">${fmtVal(e.estimate, e.unit)}</td>
      <td class="num c-prev${signClass(e.prev)}"><span class="val">${fmtVal(e.prev, e.unit)}</span></td>
      <td class="c-alert">${this.bellHtml(e, now)}</td>
    </tr>`;
  }

  // Bells only show the state (alerts come from the rule in Settings → Alerts) and
  // appear only while alerts are on: filled yellow = alert set, filled grey = it
  // triggered. Events without an alert have no bell. Clicking a bell opens Settings → Alerts.
  bellHtml(e, now) {
    const a = this.opts.alerts, state = a.stateOf(e.id), ev = `${e.name} ${e.event}`;
    if (!a.settings().enabled || state === "none") return "";
    let label;
    if (state === "armed") {
      const at = a.fireTime(e.id);
      label = `Alert set for ${ev}${at > now ? `, goes off ${Time.countdown(at - now).toLowerCase()}` : ""}`;
    } else label = `Alert for ${ev} triggered`;
    return `<button type="button" class="bell bell-${state}" aria-label="${esc(label)}. Open alert settings" title="${esc(label)}. Click for alert settings">${Icons.bellFilled}</button>`;
  }

  // Keep each row's release state current (it greys the time of released events). Returns true when the day changed (caller re-renders).
  tick(now) {
    if (this.rows.size && Time.dayKey(new Date(now), this.zone) !== this.todayKey) return true;
    for (const r of this.rows.values()) {
      const state = Events.releaseState(r.e, now);
      if (state === r.state) continue;
      r.state = r.tr.dataset.status = state;
    }
    return false;
  }

  // Re-draw bell cells (all, or just the given ids). Keeps focus on a redrawn bell.
  refreshAlerts(ids, now) {
    const list = ids ? ids.map(id => this.rows.get(id)).filter(Boolean) : [...this.rows.values()];
    for (const r of list) {
      const hadFocus = r.tr.contains(document.activeElement) && document.activeElement.classList.contains("bell");
      r.tr.dataset.alert = this.opts.alerts.stateOf(r.e.id);
      r.tr.querySelector(".c-alert").innerHTML = this.bellHtml(r.e, now);
      if (hadFocus) r.tr.querySelector(".bell").focus();
    }
  }
}

// Positive / negative classes for Actual and Previous; the colors and style come from Settings → Display.
const signClass = v => (v == null || !Number(v) ? "" : Number(v) > 0 ? " pos" : " neg");

// Tooltip on a filled Actual cell, saying which way counts as better for the report.
const verdictTitle = (e, v, against) =>
  `${v === "better" ? "Better" : "Worse"} than ${against} (${e.direction === "higher" ? "higher" : "lower"} is better for this report)`;

function fmtVal(v, unit) {
  if (v == null) return '<span class="dash" aria-label="Not available">—</span>';
  const n = Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (!unit) return n;
  if (unit === "%") return n + "%";
  if (unit.length === 1 && /[$€£¥]/.test(unit)) return unit + n;
  return n + " " + unit;
}
