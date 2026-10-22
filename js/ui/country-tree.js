// ---- Country tree: regions with tri-state checkboxes ---------------------------
// The web stand-in for a JavaFX TreeView of CheckBoxTreeItems: ticking a region
// ticks all its countries, a partly ticked region shows the indeterminate dash, and
// ▶/▼ folds a region. Used by the "Choose countries" dialog and the group editor.
//
//   const tree = new CountryTree(containerEl, { onChange(selectedSet) })
//   tree.build(codes, selected)   lays out the tree; regions with ticks start open
//   tree.filter(text)             shows matching countries (and opens their regions)
//   tree.set(selected)            replaces the selection
//   tree.selected                 the current Set of country codes
class CountryTree {
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.selected = new Set();
    el.classList.add("ctree");

    el.addEventListener("click", e => {
      const disc = e.target.closest(".ct-disc");
      if (disc) this.toggleRegion(disc.closest(".ct-region"));
    });
    el.addEventListener("change", e => {
      const box = e.target;
      if (box.classList.contains("ct-rbox")) {
        // Region box: tick (or untick) every country in it that the search shows.
        for (const b of box.closest(".ct-region").querySelectorAll(".ct-leaf:not([hidden]) input")) {
          box.checked ? this.selected.add(b.value) : this.selected.delete(b.value);
        }
      } else if (box.matches(".ct-leaf input")) {
        box.checked ? this.selected.add(box.value) : this.selected.delete(box.value);
      } else return;
      this.sync();
      if (this.opts.onChange) this.opts.onChange(this.selected);
    });
  }

  build(codes, selected = []) {
    this.selected = new Set(selected);
    const byRegion = new Map(Countries.REGION_ORDER.map(r => [r, []]));
    for (const c of codes) byRegion.get(Countries.region(c)).push(c);
    this.el.innerHTML = [...byRegion].filter(([, cs]) => cs.length).map(([region, cs], i) => {
      cs.sort((a, b) => Countries.name(a).localeCompare(Countries.name(b)));
      const open = cs.some(c => this.selected.has(c));
      return `<div class="ct-region" data-open="${open}">
        <div class="ct-row ct-head">
          <button type="button" class="ct-disc" aria-expanded="${open}" aria-controls="ctk-${i}" aria-label="${esc(region)}">${Icons.arrow}</button>
          <label class="ct-label"><input type="checkbox" class="ct-rbox"><span>${esc(region)}</span></label>
          <span class="ct-n"></span>
        </div>
        <div class="ct-kids" id="ctk-${i}" role="group" aria-label="${esc(region)}" ${open ? "" : "hidden"}>${cs.map(c => `
          <label class="ct-row ct-leaf" data-s="${esc((Countries.name(c) + " " + c).toLowerCase())}">
            <input type="checkbox" value="${c}">${Countries.flag(c)}<span class="ct-name">${esc(Countries.name(c))}</span>
          </label>`).join("")}
        </div>
      </div>`;
    }).join("");
    this.sync();
  }

  toggleRegion(r, open = r.dataset.open !== "true") {
    r.dataset.open = open;
    r.querySelector(".ct-disc").setAttribute("aria-expanded", open);
    r.querySelector(".ct-kids").hidden = !open;
  }

  filter(text) {
    const q = text.trim().toLowerCase();
    for (const r of this.el.querySelectorAll(".ct-region")) {
      let any = false;
      for (const l of r.querySelectorAll(".ct-leaf")) { l.hidden = !!q && !l.dataset.s.includes(q); any = any || !l.hidden; }
      r.hidden = !any;
      if (q && any) this.toggleRegion(r, true);
    }
    this.sync();
  }

  set(selected) { this.selected = new Set(selected); this.sync(); }

  // Reflect the selection: leaf ticks, region tri-state and "n of m" counts.
  sync() {
    for (const r of this.el.querySelectorAll(".ct-region")) {
      const boxes = [...r.querySelectorAll(".ct-leaf input")];
      let n = 0;
      for (const b of boxes) { b.checked = this.selected.has(b.value); if (b.checked) n++; }
      const shown = [...r.querySelectorAll(".ct-leaf:not([hidden]) input")];
      const on = shown.filter(b => b.checked).length;
      const rbox = r.querySelector(".ct-rbox");
      rbox.checked = shown.length > 0 && on === shown.length;
      rbox.indeterminate = on > 0 && on < shown.length;
      r.querySelector(".ct-n").textContent = `${n} of ${boxes.length}`;
    }
  }
}
