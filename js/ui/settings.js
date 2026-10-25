// ---- Settings modal: country groups, alerts, display ------------------------
//
//   new SettingsPanel(el, {
//     groups, alerts,                      CountryGroups / Alerts instances
//     countries: () => [code],             every country the user can pick
//     valueColors: { get() -> { mode: "bluepink" | "greenred" | "custom", pos?, neg? }, set(value), current() -> { pos, neg },
//                    style() -> "text" | "indicator", setStyle(value) },
//     timezone: { options(selectedId) -> <option> HTML, get(), set(id) },
//     theme: { get() -> "dark" | "light" | "system", set(value) },
//     onClose(),
//   })

class SettingsPanel {
  constructor(el, opts) {
    this.el = el;
    this.opts = opts;
    this.edit = null;          // { id, name, members: Set } while editing a group
    const tabs = [["groups", "Country groups"], ["alerts", "Alerts"], ["display", "Display"]];
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
    el.addEventListener("close", () => { this.edit = null; this.opts.onClose(); });
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
        case "del":
          // JavaFX-style confirmation Alert on top of Settings; focus returns to the list.
          Confirm.ask({ title: "Delete group", header: `Delete “${g.name}”?`, message: "This group will be removed. This can't be undone.", ok: "Delete" })
            .then(yes => {
              if (yes) this.opts.groups.remove(id);
              const back = p.querySelector(`[data-act=del][data-id="${CSS.escape(id)}"]`) || p.querySelector("[data-act=new]");
              if (back) back.focus();
            });
          break;
        case "cancel": this.edit = null; this.renderGroups(); p.querySelector("[data-act=new]").focus(); break;
        case "clear-members": this.edit.members.clear(); this.tree.sync(); this.syncEditor(); break;
      }
    });
    p.addEventListener("input", e => {
      if (!this.edit) return;
      if (e.target.name === "name") { this.edit.name = e.target.value; this.showError(""); }
      if (e.target.name === "find") this.tree.filter(e.target.value);
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

  // Opens the editor for a new group with these countries ticked ("Save as group…").
  newGroup(members) { this.showTab("groups"); this.startEdit(null, "", members); }

  startEdit(id, name, members) {
    this.edit = { id, name, members: new Set(members) };
    this.panes.groups.innerHTML = `
      <form class="grp-form" novalidate>
        <h3 class="set-h">${id ? "Edit group" : "New group"}</h3>
        <label class="field"><span class="field-label">Group name</span>
          <input type="text" name="name" maxlength="40" autocomplete="off" placeholder="e.g. My Trading Countries" value="${esc(name)}"></label>
        <div class="field">
          <span class="field-label">Countries <span class="field-acts"><span class="n" data-count></span><button type="button" class="linkbtn" data-act="clear-members">Clear</button></span></span>
          <input type="search" name="find" placeholder="Search countries" aria-label="Search countries" autocomplete="off">
          <div class="pick-list" role="group" aria-label="Countries in this group"></div>
        </div>
        <p class="form-err" role="alert"></p>
        <div class="form-acts">
          <button type="button" class="btn" data-act="cancel">Cancel</button>
          <button type="submit" class="btn primary">Save group</button>
        </div>
      </form>`;
    // Same region tree as "Choose countries"; it edits this.edit.members directly.
    this.tree = new CountryTree(this.panes.groups.querySelector(".pick-list"), { onChange: () => this.syncEditor() });
    this.tree.build(this.opts.countries(), members);
    this.tree.selected = this.edit.members;
    this.syncEditor();
    this.panes.groups.querySelector("input[name=name]").focus();
  }

  syncEditor() {
    const p = this.panes.groups, m = this.edit.members;
    p.querySelector("[data-count]").textContent = `${m.size} selected`;
    p.querySelector("[data-act=clear-members]").hidden = !m.size;
    if (m.size) this.showError("");
  }

  showError(msg) {
    const e = this.panes.groups.querySelector(".form-err");
    if (e) e.textContent = msg;
  }

  // ---- Alerts ----------------------------------------------------------------
  // Alerts tab: one on/off switch and one rule (countries, impact, categories; leave a
  // part empty for "any"). Rule changes apply straight away; the lead time has Save.
  initAlerts() {
    const p = this.panes.alerts;
    const cats = Events.TYPES.filter(t => t !== "Holiday");
    p.innerHTML = `
      <label class="check alert-switch"><input type="checkbox" name="enabled"> <b>Turn on alerts</b></label>
      <p class="set-desc" data-rule-summary aria-live="polite"></p>
      <fieldset class="alert-rule">
        <legend class="set-h">Alert me about</legend>
        <p class="set-desc">An event needs to match every part. Leave a part empty to include everything.</p>
        <div class="field">
          <span class="field-label">Countries <span class="field-acts"><span class="n" data-count></span><button type="button" class="linkbtn" data-act="clear-countries">Clear</button></span></span>
          <input type="search" name="ruleFind" placeholder="Search countries" aria-label="Search countries" autocomplete="off">
          <div class="pick-list rule-countries" role="group" aria-label="Countries to alert on"></div>
        </div>
        <div class="field">
          <span class="field-label">Impact</span>
          <div class="rule-checks" role="group" aria-label="Impact levels to alert on">${Alerts.IMPACT_LEVELS.map(v =>
            `<label class="check"><input type="checkbox" name="impact" value="${v}"> ${v[0].toUpperCase() + v.slice(1)}</label>`).join("")}</div>
        </div>
        <div class="field">
          <span class="field-label">Categories</span>
          <div class="rule-checks rule-cats" role="group" aria-label="Categories to alert on">${cats.map(v =>
            `<label class="check"><input type="checkbox" name="type" value="${esc(v)}"> ${esc(v)}</label>`).join("")}</div>
        </div>
      </fieldset>
      <form class="alert-form" novalidate>
        <h3 class="set-h" id="leadLbl">Alert lead time</h3>
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
      <h3 class="set-h">Your alerts</h3>
      <div class="alert-summary"></div>
      <p class="note">Alerts run in this browser tab only. This app has no server-side notification service, so nothing can go off while the page is closed. Alerts whose time came while it was closed go off when you reopen it.</p>`;

    const rule = () => this.opts.alerts.settings().rule;
    const setRule = patch => { this.opts.alerts.updateSettings({ rule: { ...rule(), ...patch } }); this.renderRuleSummary(); };
    this.ruleTree = new CountryTree(p.querySelector(".rule-countries"), { onChange: sel => setRule({ countries: [...sel] }) });
    p.querySelector("[name=enabled]").addEventListener("change", e => { this.opts.alerts.updateSettings({ enabled: e.target.checked }); this.renderRuleSummary(); });
    p.querySelector("[name=ruleFind]").addEventListener("input", e => this.ruleTree.filter(e.target.value));
    p.querySelector(".alert-rule").addEventListener("change", e => {
      if (e.target.name === "impact") setRule({ impacts: [...p.querySelectorAll("[name=impact]:checked")].map(b => b.value) });
      if (e.target.name === "type") setRule({ types: [...p.querySelectorAll("[name=type]:checked")].map(b => b.value) });
    });

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
    p.addEventListener("click", e => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      if (b.dataset.act === "ack-all") this.opts.alerts.acknowledgeAll();
      if (b.dataset.act === "clear-triggered") {
        const n = this.opts.alerts.counts().acknowledged;
        Confirm.ask({ title: "Clear triggered alerts", header: `Clear ${n} triggered alert${n === 1 ? "" : "s"}?`,
          message: "Their grey bells disappear from the table. Alerts that are still waiting aren't affected.", ok: "Clear" })
          .then(yes => { if (yes) this.opts.alerts.clearTriggered(); });
      }
      if (b.dataset.act === "clear-countries") { this.ruleTree.set([]); setRule({ countries: [] }); }
    });
  }

  renderAlerts(flash) {
    const p = this.panes.alerts, s = this.opts.alerts.settings(), form = p.querySelector("form");
    p.querySelector("[name=enabled]").checked = s.enabled;
    p.querySelector("[name=ruleFind]").value = "";
    this.ruleTree.build(this.opts.countries(), s.rule.countries);
    p.querySelectorAll("[name=impact]").forEach(b => { b.checked = s.rule.impacts.includes(b.value); });
    p.querySelectorAll("[name=type]").forEach(b => { b.checked = s.rule.types.includes(b.value); });
    form.leadValue.value = s.lead.value;
    form.leadUnit.value = s.lead.unit;
    form.leadValue.removeAttribute("aria-invalid");
    form.querySelector(".form-err").textContent = "";
    form.querySelector(".current").innerHTML = `${flash ? flash + " " : ""}Alerts go off <b>${esc(Alerts.describeLead(s.lead))}</b>.`;
    this.renderRuleSummary();
    this.renderAlertSummary();
  }

  // "On: alerts go off 10 minutes before upcoming High-impact events in United States, in any category."
  renderRuleSummary() {
    const p = this.panes.alerts, s = this.opts.alerts.settings();
    const text = Alerts.describeRule(s.rule, s.lead, Countries.name);
    p.querySelector("[data-rule-summary]").innerHTML = s.enabled
      ? `<b>On:</b> alerts go off ${esc(text)}.`
      : `Off. When on, alerts go off ${esc(text)}.`;
    p.querySelector(".alert-rule").classList.toggle("is-off", !s.enabled);
    const n = s.rule.countries.length;
    p.querySelector("[data-count]").textContent = n ? `${n} selected` : "Any country";
    p.querySelector("[data-act=clear-countries]").hidden = !n;
  }

  renderAlertSummary() {
    const el = this.panes.alerts.querySelector(".alert-summary");
    if (!el) return;
    const c = this.opts.alerts.counts();
    const any = c.armed + c.triggered + c.acknowledged;
    el.innerHTML = !any ? `<p class="set-empty">${this.opts.alerts.settings().enabled ? "No upcoming events match right now." : "Alerts are off."}</p>` : `
      <dl class="stats">
        <div><dt>Waiting</dt><dd>${c.armed}</dd></div>
        <div><dt>Needs acknowledgment</dt><dd>${c.triggered}</dd></div>
        <div><dt>Triggered</dt><dd>${c.acknowledged}</dd></div>
      </dl>
      ${c.triggered || c.acknowledged ? `<div class="form-acts">
        ${c.acknowledged ? `<button type="button" class="linkbtn" data-act="clear-triggered">Clear triggered alerts</button>` : ""}
        ${c.triggered ? `<button type="button" class="btn sm" data-act="ack-all">Acknowledge all</button>` : ""}
      </div>` : ""}`;
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
    const style = this.opts.valueColors.style();
    p.querySelector(`[name=vstyle][value="${style}"]`).checked = true;
    this.renderValueStyle(style);
    this.showHex();
    this.showContrastWarning();
  }

  // Explainer, color labels and preview for "Text color" or "Indicator".
  renderValueStyle(style) {
    const p = this.panes.display, ind = style === "indicator";
    p.querySelector("[data-vstyle-desc]").textContent = ind
      ? "Fills the Actual cell when it beats or misses the forecast, from the currency's point of view. For example, a higher Unemployment Rate is worse, and higher inflation is better (it makes higher interest rates likely). Releases without a forecast aren't filled."
      : "Positive numbers in the Actual and Previous columns use the positive color, and negative numbers the negative color.";
    const [pos, neg] = ind ? ["Better than forecast", "Worse than forecast"] : ["Positive", "Negative"];
    p.querySelector("[data-pos-label]").textContent = pos;
    p.querySelector("[data-neg-label]").textContent = neg;
    p.querySelector("[name=posColor]").setAttribute("aria-label", `${pos} color`);
    p.querySelector("[name=negColor]").setAttribute("aria-label", `${neg} color`);
    p.querySelector(".vc-preview").innerHTML = ind
      ? `<span>Preview</span><span class="vc-pos">3.7%</span><span>better than forecast</span><span class="vc-neg">1.4%</span><span>worse than forecast</span>`
      : `<span>Preview</span><span class="vc-pos">3.7%</span><span class="vc-neg">-1.4%</span><span class="vc-pos">250</span><span class="vc-neg">-0.448</span>`;
  }

  // Text color style only (Indicator picks readable text itself): warn when a color is
  // hard to read on the table's row backgrounds in the current theme. The color is kept.
  showContrastWarning() {
    const p = this.panes.display, warn = p.querySelector(".vc-warn");
    const cs = getComputedStyle(document.documentElement), rows = ["--row", "--row-alt"].map(v => cs.getPropertyValue(v).trim());
    const { pos, neg } = this.opts.valueColors.current();
    const bad = this.opts.valueColors.style() === "text"
      ? [["Positive", pos], ["Negative", neg]].filter(([, c]) => !Colors.readable(c, rows)).map(([name]) => name) : [];
    warn.hidden = !bad.length;
    if (!bad.length) return;
    const which = bad.length === 2 ? "Positive and negative values are" : `${bad[0]} values are`;
    warn.textContent = `${which} hard to read on the current background. Try a ${Colors.isDark(rows[0]) ? "lighter" : "darker"} color.`;
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
      <h3 class="set-h">Actual and previous values</h3>
      <span class="field-label" id="vsLbl">Show as</span>
      <div class="vc-options" role="radiogroup" aria-labelledby="vsLbl">
        <label class="check"><input type="radio" name="vstyle" value="text"> Text color</label>
        <label class="check"><input type="radio" name="vstyle" value="indicator"> Indicator</label>
      </div>
      <p class="set-desc" data-vstyle-desc></p>
      <span class="field-label" id="vcLbl">Colors</span>
      <div class="vc-options" role="radiogroup" aria-labelledby="vcLbl">
        <label class="check"><input type="radio" name="vc" value="bluepink"> Blue / pink</label>
        <label class="check"><input type="radio" name="vc" value="greenred"> Green / red</label>
        <label class="check"><input type="radio" name="vc" value="custom"> Custom</label>
      </div>
      <div class="vc-custom">
        <label class="vc-color"><span class="vc-picker"><input type="color" name="posColor"><span class="vc-hex" data-hex="posColor"></span></span> <span data-pos-label></span></label>
        <label class="vc-color"><span class="vc-picker"><input type="color" name="negColor"><span class="vc-hex" data-hex="negColor"></span></span> <span data-neg-label></span></label>
      </div>
      <p class="vc-warn" role="status" hidden></p>
      <div class="vc-preview" aria-hidden="true"></div>`;
    p.querySelector("[name=defaultZone]").addEventListener("change", e => this.opts.timezone.set(e.target.value));
    for (const r of p.querySelectorAll("[name=theme]")) r.addEventListener("change", e => {
      this.opts.theme.set(e.target.value);
      this.renderDisplay(); // value-color presets differ by theme, so refresh the swatches
    });
    const vc = this.opts.valueColors;
    for (const r of p.querySelectorAll("[name=vstyle]")) r.addEventListener("change", e => { vc.setStyle(e.target.value); this.renderDisplay(); });
    p.querySelector('[aria-labelledby="vcLbl"]').addEventListener("change", e => {
      // Choosing Custom starts from the colors currently shown.
      vc.set(e.target.value === "custom" ? { mode: "custom", ...vc.current() } : { mode: e.target.value });
      this.renderDisplay();
    });
    // Picking a color switches to Custom.
    p.querySelector(".vc-custom").addEventListener("input", () => {
      vc.set({ mode: "custom", pos: p.querySelector("[name=posColor]").value, neg: p.querySelector("[name=negColor]").value });
      this.showHex();
      this.showContrastWarning();
      p.querySelector('[name=vc][value="custom"]').checked = true;
    });
  }
}
