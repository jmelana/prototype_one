// ---- Settings modal: country groups, alerts, display ------------------------
//
//   new SettingsPanel(el, {
//     groups, alerts,                      CountryGroups / Alerts instances
//     countries: () => [code],             every country the user can pick
//     valueColors: { get() -> { mode: "bluepink" | "greenred" | "custom", pos?, neg? }, set(value), current() -> { pos, neg } },
//     timezone: { options(selectedId) -> <option> HTML, get(), set(id) },
//     theme: { get() -> "dark" | "light" | "system", set(value) },
//     onClose(),
//   })
const AlertsDemoHint = "Sets off every event with a filled bell so you can see the alarm. Your real alerts still go off at their scheduled time.";

class SettingsPanel {
  constructor(el, opts) {
    this.el = el;
    this.opts = opts;
    this.edit = null;          // { id, name, members: Set } while editing a group
    this.confirmDelete = null; // group id awaiting delete confirmation
    const tabs = [["groups", "Country groups"], ["alerts", "Alerts"], ["display", "Display"]];
    this.demoTimer = null;
    el.setAttribute("aria-labelledby", "setTitle");
    el.innerHTML = `
      <div class="modal-head">
        <h2 id="setTitle">Settings</h2>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close settings" title="Close">${Icons.x}</button>
      </div>
      <div class="tabs" role="tablist" aria-label="Settings sections">
        ${tabs.map(([k, t], i) => `<button type="button" role="tab" id="tab-${k}" data-tab="${k}" aria-controls="pane-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" aria-label="${t}">${
          k === "groups" ? `<span class="t-long">${t}</span><span class="t-short">Groups</span>` : t}</button>`).join("")}
      </div>
      <div class="set-body">
        ${tabs.map(([k], i) => `<section role="tabpanel" id="pane-${k}" aria-labelledby="tab-${k}" ${i ? "hidden" : ""}></section>`).join("")}
      </div>
      <div class="modal-foot"><span class="spacer"></span><button type="button" class="btn primary" data-act="close">Close</button></div>`;
    this.panes = Object.fromEntries(tabs.map(([k]) => [k, el.querySelector("#pane-" + k)]));

    // Escape closes the dialog natively; a click on the backdrop closes it too.
    el.addEventListener("close", () => { this.edit = null; this.confirmDelete = null; this.opts.onClose(); });
    el.addEventListener("click", e => { if (e.target === el) this.close(); });
    el.addEventListener("keydown", e => {
      const tab = e.target.closest("[role=tab]");
      if (tab && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        const all = [...el.querySelectorAll("[role=tab]")];
        const next = all[(all.indexOf(tab) + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length];
        this.showTab(next.dataset.tab); next.focus();
      }
    });
    for (const bar of el.querySelectorAll(".modal-head, .modal-foot")) bar.addEventListener("click", e => { if (e.target.closest("[data-act=close]")) this.close(); });
    el.querySelector(".tabs").addEventListener("click", e => { const t = e.target.closest("[role=tab]"); if (t) this.showTab(t.dataset.tab); });

    this.initGroups();
    this.initAlerts();
    this.initDisplay();
    opts.groups.onChange(() => { if (!this.edit) this.renderGroups(); });
    opts.alerts.onChange(() => this.renderAlertSummary());
  }

  get isOpen() { return this.el.open; }
  open(tab) {
    if (tab) this.showTab(tab);
    this.renderGroups(); this.renderAlerts(); this.renderDisplay();
    if (!this.el.open) this.el.showModal();
    this.el.querySelector("[role=tab][aria-selected=true]").focus();
  }
  close() { if (this.el.open) this.el.close(); }
  showTab(k) {
    this.el.querySelectorAll("[role=tab]").forEach(t => {
      const on = t.dataset.tab === k;
      t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1;
    });
    for (const [key, p] of Object.entries(this.panes)) p.hidden = key !== k;
  }

  // ---- Country groups --------------------------------------------------------
  initGroups() {
    const p = this.panes.groups;
    p.addEventListener("click", e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      const id = b.dataset.id, g = id && this.opts.groups.get(id);
      switch (b.dataset.act) {
        case "new": this.startEdit(null, "", []); break;
        case "edit": this.startEdit(g.id, g.name, g.members); break;
        case "dup": this.startEdit(null, this.uniqueName(g.name + " (copy)"), g.members); break;
        case "del": this.confirmDelete = id; this.renderGroups(); p.querySelector("[data-act=del-yes]").focus(); break;
        case "del-no": this.confirmDelete = null; this.renderGroups(); p.querySelector(`[data-act=del][data-id="${CSS.escape(id)}"]`).focus(); break;
        case "del-yes": this.confirmDelete = null; this.opts.groups.remove(id); p.querySelector("[data-act=new]").focus(); break;
        case "cancel": this.edit = null; this.renderGroups(); p.querySelector("[data-act=new]").focus(); break;
        case "unpick": this.edit.members.delete(b.dataset.code); this.syncEditor(); break;
      }
    });
    p.addEventListener("change", e => {
      if (!this.edit || !e.target.matches(".pick-list input")) return;
      e.target.checked ? this.edit.members.add(e.target.value) : this.edit.members.delete(e.target.value);
      this.syncEditor();
    });
    p.addEventListener("input", e => {
      if (!this.edit) return;
      if (e.target.name === "name") { this.edit.name = e.target.value; this.showError(""); }
      if (e.target.name === "find") {
        const q = e.target.value.trim().toLowerCase();
        p.querySelectorAll(".pick-list label").forEach(l => { l.hidden = q && !l.dataset.s.includes(q); });
        p.querySelectorAll(".pick-list .pick-region").forEach(r => { r.hidden = !r.querySelector("label:not([hidden])"); });
      }
    });
    p.addEventListener("submit", e => {
      e.preventDefault();
      const { id, name, members } = this.edit;
      const err = this.opts.groups.validate({ id, name, members: [...members] });
      if (err) { this.showError(err); return; }
      this.opts.groups.save({ id, name, members: [...members] });
      this.edit = null;
      this.renderGroups();
      p.querySelector("[data-act=new]").focus();
    });
  }

  uniqueName(base) {
    let n = base, i = 2;
    while (this.opts.groups.all().some(g => g.name.toLowerCase() === n.toLowerCase())) n = `${base} ${i++}`;
    return n;
  }

  flags(members, max = 8) {
    return members.slice(0, max).map(c => `<span title="${esc(Countries.name(c))}">${Countries.flag(c)}</span>`).join("") +
      (members.length > max ? `<span class="more">+${members.length - max}</span>` : "");
  }

  renderGroups() {
    if (this.edit) return;
    const { groups } = this.opts;
    const custom = groups.custom();
    const row = g => {
      if (this.confirmDelete === g.id) return `
        <div class="grp is-confirm" role="group" aria-label="Confirm delete">
          <span class="grp-confirm">Delete “${esc(g.name)}”? This can't be undone.</span>
          <span class="grp-acts">
            <button type="button" class="btn danger sm" data-act="del-yes" data-id="${esc(g.id)}">Delete</button>
            <button type="button" class="btn sm" data-act="del-no" data-id="${esc(g.id)}">Keep</button>
          </span>
        </div>`;
      return `
        <div class="grp">
          <div class="grp-main">
            <div class="grp-name">${esc(g.name)}${g.builtin ? ` <span class="tag">Built-in</span>` : ""}
              <span class="n">${g.members.length} ${g.members.length === 1 ? "country" : "countries"}</span></div>
            ${g.description ? `<div class="grp-desc">${esc(g.description)}</div>` : ""}
            <div class="grp-flags">${this.flags(g.members)}</div>
          </div>
          <span class="grp-acts">${g.builtin
            ? `<button type="button" class="icon-btn" data-act="dup" data-id="${esc(g.id)}" aria-label="Duplicate ${esc(g.name)} as a custom group" title="Duplicate as custom group">${Icons.copy}</button>`
            : `<button type="button" class="icon-btn" data-act="edit" data-id="${esc(g.id)}" aria-label="Edit ${esc(g.name)}" title="Edit">${Icons.pencil}</button>
               <button type="button" class="icon-btn" data-act="del" data-id="${esc(g.id)}" aria-label="Delete ${esc(g.name)}" title="Delete">${Icons.trash}</button>`}
          </span>
        </div>`;
    };
    this.panes.groups.innerHTML = `
      <div class="set-intro">
        <p>Custom groups show up in the country filter and work like G7 or G20.</p>
        <button type="button" class="btn primary sm" data-act="new">${Icons.plus}New group</button>
      </div>
      <h3 class="set-h">Your groups</h3>
      ${custom.length ? custom.map(row).join("") : `<p class="set-empty">No custom groups yet. Create one, such as “My Trading Countries”.</p>`}
      <h3 class="set-h">Built-in groups</h3>
      ${groups.builtins().map(row).join("")}`;
  }

  startEdit(id, name, members) {
    this.edit = { id, name, members: new Set(members) };
    const byRegion = new Map(Countries.REGION_ORDER.map(r => [r, []]));
    for (const c of this.opts.countries()) byRegion.get(Countries.region(c)).push(c);
    const list = [...byRegion].filter(([, cs]) => cs.length).map(([r, cs]) => `
      <div class="pick-region"><div class="pick-h">${esc(r)}</div>${cs
        .sort((a, b) => Countries.name(a).localeCompare(Countries.name(b)))
        .map(c => `<label data-s="${esc((Countries.name(c) + " " + c).toLowerCase())}"><input type="checkbox" value="${c}">${Countries.flag(c)}<span>${esc(Countries.name(c))}</span></label>`).join("")}
      </div>`).join("");
    this.panes.groups.innerHTML = `
      <form class="grp-form" novalidate>
        <h3 class="set-h">${id ? "Edit group" : "New group"}</h3>
        <label class="field"><span class="field-label">Group name</span>
          <input type="text" name="name" maxlength="40" autocomplete="off" placeholder="e.g. My Trading Countries" value="${esc(name)}"></label>
        <div class="field">
          <span class="field-label">Countries <span class="n" data-count></span></span>
          <div class="sel-chips" aria-live="polite"></div>
          <input type="search" name="find" placeholder="Find a country" aria-label="Find a country" autocomplete="off">
          <div class="pick-list" role="group" aria-label="Countries in this group">${list}</div>
        </div>
        <p class="form-err" role="alert"></p>
        <div class="form-acts">
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="submit" class="btn primary">Save group</button>
        </div>
      </form>`;
    this.syncEditor();
    this.panes.groups.querySelector("input[name=name]").focus();
  }

  syncEditor() {
    const p = this.panes.groups, m = this.edit.members;
    p.querySelectorAll(".pick-list input").forEach(b => { b.checked = m.has(b.value); });
    p.querySelector("[data-count]").textContent = `${m.size} selected`;
    p.querySelector(".sel-chips").innerHTML = m.size
      ? [...m].map(c => `<span class="chip">${Countries.flag(c)}${esc(Countries.name(c))}<button type="button" class="chip-x" data-act="unpick" data-code="${c}" aria-label="Remove ${esc(Countries.name(c))}">${Icons.x}</button></span>`).join("")
      : `<span class="set-empty">No countries yet. Tick them below.</span>`;
    if (m.size) this.showError("");
  }

  showError(msg) {
    const e = this.panes.groups.querySelector(".form-err");
    if (e) e.textContent = msg;
  }

  // ---- Alerts ----------------------------------------------------------------
  initAlerts() {
    const p = this.panes.alerts;
    p.innerHTML = `
      <form class="alert-form" novalidate>
        <h3 class="set-h" id="leadLbl">Alert lead time</h3>
        <p class="set-desc">When you turn on an event's bell, its alert goes off this long before the scheduled release.</p>
        <div class="lead-row" role="group" aria-labelledby="leadLbl">
          <input type="number" name="leadValue" min="0" step="1" inputmode="numeric" aria-label="Lead time amount" required>
          <select name="leadUnit" aria-label="Lead time unit">
            <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
          </select>
          <span class="lead-suffix">before each event</span>
        </div>
        <p class="form-err" role="alert"></p>
        <div class="form-acts">
          <span class="current" aria-live="polite"></span>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>
      <h3 class="set-h">Demo</h3>
      <label class="check"><input type="checkbox" name="demo"> Set off my alerts in 5 seconds</label>
      <p class="set-desc" data-demo-status aria-live="polite"></p>
      <h3 class="set-h">Your alerts</h3>
      <div class="alert-summary"></div>
      <p class="note">Alerts run in this browser tab only. This app has no server-side notification service, so nothing can go off while the page is closed. Alerts whose time came while it was closed go off when you reopen it.</p>`;
    const form = p.querySelector("form");
    form.addEventListener("input", () => { form.querySelector(".form-err").textContent = ""; form.leadValue.removeAttribute("aria-invalid"); });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const v = Alerts.validateLead(form.leadValue.value, form.leadUnit.value);
      if (v.error) {
        form.querySelector(".form-err").textContent = v.error;
        form.leadValue.setAttribute("aria-invalid", "true");
        form.leadValue.focus();
        return;
      }
      this.opts.alerts.updateSettings({ lead: v });
      this.renderAlerts("Saved.");
    });
    p.querySelector("[name=demo]").addEventListener("change", e => e.target.checked ? this.startDemo() : this.stopDemo("Demo cancelled."));
    p.addEventListener("click", e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "ack-all") this.opts.alerts.acknowledgeAll();
      if (b.dataset.act === "off-all") this.opts.alerts.clearAll();
    });
  }

  // Demo: count down 5 seconds, then set off every armed alert (filled bell).
  // Settings closes so the alarm window shows over the table.
  startDemo() {
    const status = this.panes.alerts.querySelector("[data-demo-status]");
    if (!this.opts.alerts.counts().armed) {
      this.panes.alerts.querySelector("[name=demo]").checked = false;
      status.textContent = "Turn on at least one bell (filled yellow) in the table first.";
      return;
    }
    let left = 5;
    const show = () => { status.textContent = `Alarm in ${left} second${left === 1 ? "" : "s"}…`; };
    show();
    clearInterval(this.demoTimer);
    this.demoTimer = setInterval(() => {
      if (--left > 0) return show();
      this.stopDemo();
      this.close();
      this.opts.alerts.demoFire();
    }, 1000);
  }
  stopDemo(message = "") {
    clearInterval(this.demoTimer);
    this.demoTimer = null;
    this.panes.alerts.querySelector("[name=demo]").checked = false;
    this.panes.alerts.querySelector("[data-demo-status]").textContent = message || AlertsDemoHint;
  }

  renderAlerts(flash) {
    const p = this.panes.alerts, s = this.opts.alerts.settings(), form = p.querySelector("form");
    form.leadValue.value = s.lead.value;
    form.leadUnit.value = s.lead.unit;
    form.leadValue.removeAttribute("aria-invalid");
    form.querySelector(".form-err").textContent = "";
    form.querySelector(".current").innerHTML = `${flash ? flash + " " : ""}Alerts go off <b>${esc(Alerts.describeLead(s.lead))}</b>.`;

    if (!this.demoTimer) this.panes.alerts.querySelector("[data-demo-status]").textContent = AlertsDemoHint;
    this.renderAlertSummary();
  }

  renderAlertSummary() {
    const el = this.panes.alerts.querySelector(".alert-summary");
    if (!el) return;
    const c = this.opts.alerts.counts();
    const any = c.armed + c.triggered + c.acknowledged;
    el.innerHTML = !any ? `<p class="set-empty">No alerts set. Click a bell in the table to add one.</p>` : `
      <dl class="stats">
        <div><dt>Waiting</dt><dd>${c.armed}</dd></div>
        <div><dt>Need acknowledgment</dt><dd>${c.triggered}</dd></div>
        <div><dt>Acknowledged</dt><dd>${c.acknowledged}</dd></div>
      </dl>
      <div class="form-acts">
        ${c.triggered ? `<button type="button" class="btn sm" data-act="ack-all">Acknowledge all</button>` : ""}
        <button type="button" class="btn sm" data-act="off-all">Turn off all alerts</button>
      </div>`;
  }

  renderDisplay() {
    const p = this.panes.display;
    const sel = p.querySelector("[name=defaultZone]"), cur = this.opts.timezone.get();
    sel.innerHTML = this.opts.timezone.options(cur);
    sel.value = cur;
    p.querySelector(`[name=theme][value="${this.opts.theme.get()}"]`).checked = true;
    const vc = this.opts.valueColors.get(), now = this.opts.valueColors.current();
    p.querySelector(`[name=vc][value="${vc.mode}"]`).checked = true;
    p.querySelector("[name=posColor]").value = now.pos;
    p.querySelector("[name=negColor]").value = now.neg;
    this.showHex();
  }

  // Hex code beside each swatch, as on a JavaFX ColorPicker.
  showHex() {
    for (const el of this.panes.display.querySelectorAll("[data-hex]")) {
      el.textContent = this.panes.display.querySelector(`[name=${el.dataset.hex}]`).value.toUpperCase();
    }
  }

  // ---- Display ---------------------------------------------------------------
  initDisplay() {
    const p = this.panes.display;
    p.innerHTML = `
      <h3 class="set-h" id="themeLbl">Appearance</h3>
      <div class="theme-options" role="radiogroup" aria-labelledby="themeLbl">
        <label class="check"><input type="radio" name="theme" value="dark"> Dark</label>
        <label class="check"><input type="radio" name="theme" value="light"> Light</label>
        <label class="check"><input type="radio" name="theme" value="system"> Match my computer</label>
      </div>
      <p class="set-desc">Dark is the default. “Match my computer” follows your system’s light or dark setting.</p>
      <h3 class="set-h">Time zone</h3>
      <label class="field"><span class="field-label">Default time zone</span>
        <select name="defaultZone" class="set-select"></select></label>
      <p class="set-desc">Used whenever the calendar opens. The time zone above the table changes it for the current session only.</p>
      <h3 class="set-h" id="vcLbl">Actual and previous values</h3>
      <p class="set-desc">Colors for positive and negative numbers in the Actual and Previous columns.</p>
      <div class="vc-options" role="radiogroup" aria-labelledby="vcLbl">
        <label class="check"><input type="radio" name="vc" value="bluepink"> Blue / pink</label>
        <label class="check"><input type="radio" name="vc" value="greenred"> Green / red</label>
        <label class="check"><input type="radio" name="vc" value="custom"> Custom</label>
      </div>
      <div class="vc-custom">
        <label class="vc-color"><span class="vc-picker"><input type="color" name="posColor" aria-label="Positive value color"><span class="vc-hex" data-hex="posColor"></span></span> Positive</label>
        <label class="vc-color"><span class="vc-picker"><input type="color" name="negColor" aria-label="Negative value color"><span class="vc-hex" data-hex="negColor"></span></span> Negative</label>
      </div>
      <div class="vc-preview" aria-hidden="true">
        <span>Preview</span><span class="vc-pos">3.7%</span><span class="vc-neg">-1.4%</span><span class="vc-pos">250</span><span class="vc-neg">-0.448</span>
      </div>`;
    p.querySelector("[name=defaultZone]").addEventListener("change", e => this.opts.timezone.set(e.target.value));
    for (const r of p.querySelectorAll("[name=theme]")) r.addEventListener("change", e => {
      this.opts.theme.set(e.target.value);
      this.renderDisplay(); // value-color presets differ by theme, so refresh the swatches
    });
    const vc = this.opts.valueColors;
    p.querySelector(".vc-options").addEventListener("change", e => {
      // Choosing Custom starts from the colors currently shown.
      vc.set(e.target.value === "custom" ? { mode: "custom", ...vc.current() } : { mode: e.target.value });
      this.renderDisplay();
    });
    // Picking a color switches to Custom.
    p.querySelector(".vc-custom").addEventListener("input", () => {
      vc.set({ mode: "custom", pos: p.querySelector("[name=posColor]").value, neg: p.querySelector("[name=negColor]").value });
      this.showHex();
      p.querySelector('[name=vc][value="custom"]').checked = true;
    });
  }
}
