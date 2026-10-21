// ---- Country & group picker (modal) ----------------------------------------
// Edits a staged copy of the selection; nothing changes until Apply.
//
//   new CountryPicker(dialogEl, {
//     groups,                       CountryGroups instance
//     countries: () => [{ code, count }],
//     selection: () => ({ groups: Set, countries: Set }),
//     onApply({ groups, countries }), onManageGroups(),
//   })
class CountryPicker {
  constructor(dialog, opts) {
    this.d = dialog;
    this.opts = opts;
    this.stage = { groups: new Set(), countries: new Set() };
    dialog.innerHTML = `
      <div class="modal-head">
        <h2 id="cpTitle">Select countries</h2>
        <button type="button" class="icon-btn" data-act="cancel" aria-label="Close" title="Close">${Icons.x}</button>
      </div>
      <div class="modal-search">${Icons.search}<input type="search" placeholder="Search countries or groups" aria-label="Search countries or groups" autocomplete="off"></div>
      <div class="modal-body" tabindex="-1"></div>
      <div class="modal-foot">
        <span class="cp-summary" aria-live="polite"></span>
        <button type="button" class="linkbtn" data-act="manage">Manage groups</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="button" class="btn primary" data-act="apply">Apply</button>
      </div>`;
    dialog.setAttribute("aria-labelledby", "cpTitle");
    this.body = dialog.querySelector(".modal-body");
    this.search = dialog.querySelector(".modal-search input");
    this.summary = dialog.querySelector(".cp-summary");

    this.search.addEventListener("input", () => this.build());
    dialog.addEventListener("click", e => {
      if (e.target === dialog) return this.close(); // backdrop
      const a = e.target.closest("[data-act]");
      if (a) {
        if (a.dataset.act === "cancel") this.close();
        if (a.dataset.act === "apply") { this.opts.onApply(this.stage); this.close(); }
        if (a.dataset.act === "manage") { this.close(); this.opts.onManageGroups(); }
        return;
      }
      const pick = e.target.closest(".cp-pick");
      if (pick) {
        if (pick.dataset.group) {
          const g = pick.dataset.group;
          this.stage.groups.has(g) ? this.stage.groups.delete(g) : this.stage.groups.add(g);
        } else {
          this.stage.groups.clear(); this.stage.countries.clear();
        }
        return this.sync();
      }
      const reg = e.target.closest("[data-region-all]");
      if (reg) {
        const boxes = [...reg.closest(".cp-region").querySelectorAll(".cp-country:not([hidden]) input")];
        const allOn = boxes.every(b => b.checked);
        boxes.forEach(b => allOn ? this.stage.countries.delete(b.value) : this.stage.countries.add(b.value));
        this.sync();
      }
    });
    this.body.addEventListener("change", e => {
      const v = e.target.value;
      e.target.checked ? this.stage.countries.add(v) : this.stage.countries.delete(v);
      this.sync();
    });
  }

  open() {
    const s = this.opts.selection();
    this.stage = { groups: new Set(s.groups), countries: new Set(s.countries) };
    this.search.value = "";
    this.build();
    if (typeof this.d.showModal === "function") this.d.showModal(); else this.d.setAttribute("open", "");
    this.search.focus();
  }
  close() { if (this.d.open) this.d.close(); }

  build() {
    const q = this.search.value.trim().toLowerCase();
    const hit = (...xs) => !q || xs.some(x => x.toLowerCase().includes(q));
    const groups = this.opts.groups;
    const counts = new Map(this.opts.countries().map(c => [c.code, c.count]));

    const pick = g => !hit(g.name, g.description || "") ? "" : `
      <button type="button" class="cp-pick" data-group="${esc(g.id)}" aria-pressed="false">
        ${g.builtin ? `<span class="gbadge">${esc(g.name)}</span>` : `<span class="gbadge custom">${Icons.layers}</span>`}
        <span class="cp-pick-name">${esc(g.builtin ? g.description : g.name)}</span>
        <span class="n">${g.members.length}</span>
      </button>`;
    const builtins = groups.builtins().map(pick).join("");
    const custom = groups.custom().map(pick).join("");
    let html = "";
    if (!q || hit("entire world", "all countries") || builtins) {
      html += `<div class="cp-picks">
        ${!q || hit("entire world", "all countries") ? `<button type="button" class="cp-pick" data-world aria-pressed="false">${Icons.globe}<span class="cp-pick-name">Entire world</span></button>` : ""}
        ${builtins}
      </div>`;
    }
    if (custom) html += `<h3 class="cp-h">Your groups</h3><div class="cp-picks">${custom}</div>`;

    const byRegion = new Map(Countries.REGION_ORDER.map(r => [r, []]));
    for (const code of counts.keys()) {
      const name = Countries.name(code);
      if (hit(name, code)) byRegion.get(Countries.region(code)).push({ code, name });
    }
    for (const [region, list] of byRegion) {
      if (!list.length) continue;
      list.sort((a, b) => a.name.localeCompare(b.name));
      html += `<section class="cp-region">
        <div class="cp-region-head"><h3 class="cp-h">${esc(region)}</h3><button type="button" class="linkbtn" data-region-all>Select all</button></div>
        <div class="cp-grid">${list.map(c => `
          <label class="cp-country${counts.get(c.code) ? "" : " is-zero"}">
            <input type="checkbox" value="${c.code}">${Countries.flag(c.code)}
            <span class="cp-name">${esc(c.name)}</span>
            <span class="cp-meta" data-n="${counts.get(c.code) || 0}"></span>
          </label>`).join("")}</div>
      </section>`;
    }
    this.body.innerHTML = html || `<div class="empty">Nothing matches “${esc(this.search.value)}”.</div>`;
    this.body.scrollTop = 0;
    this.sync();
  }

  // Reflect the staged selection without rebuilding, so focus and scroll stay put.
  sync() {
    const st = this.stage, groups = this.opts.groups;
    const via = new Map();
    for (const id of st.groups) {
      const g = groups.get(id);
      if (g) g.members.forEach(c => { if (!via.has(c)) via.set(c, g.name); });
    }
    this.body.querySelectorAll(".cp-pick").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.group ? st.groups.has(b.dataset.group) : !st.groups.size && !st.countries.size);
    });
    this.body.querySelectorAll(".cp-country").forEach(l => {
      const box = l.querySelector("input"), meta = l.querySelector(".cp-meta");
      box.checked = st.countries.has(box.value);
      const g = !box.checked && via.get(box.value);
      l.classList.toggle("is-via", !!g);
      meta.textContent = g ? "in " + g : meta.dataset.n;
      meta.title = g ? `Included through ${g}` : `${meta.dataset.n} matching events`;
    });
    this.body.querySelectorAll(".cp-region").forEach(r => {
      const boxes = [...r.querySelectorAll("input")];
      r.querySelector("[data-region-all]").textContent = boxes.length && boxes.every(b => b.checked) ? "Clear" : "Select all";
    });
    const total = Filters.countrySet(st, groups);
    const names = [...st.groups].map(id => (groups.get(id) || {}).name).filter(Boolean);
    if (st.countries.size) names.push(`${st.countries.size} ${st.countries.size === 1 ? "country" : "countries"}`);
    this.summary.textContent = total ? `${names.join(" + ")} · ${total.size} total` : "Entire world";
  }
}
