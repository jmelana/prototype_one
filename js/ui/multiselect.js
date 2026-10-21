// ---- Multi-select dropdown ----------------------------------------------------
// A toolbar button that opens a checkbox list. The panel stays open while
// options are toggled; it closes on Escape, outside click or tabbing away.
//
//   new MultiSelect(mountEl, {
//     label, icon,
//     options:  () => [{ value, label, count, prefix? }],
//     selected: () => Set | null      (null = all)
//     onToggle(value), onAll(), onClear(),
//   })
class MultiSelect {
  constructor(mount, opts) {
    this.opts = opts;
    this.key = "";
    MultiSelect.all.add(this);
    const id = mount.id + "-panel";
    mount.classList.add("dd");
    mount.innerHTML = `
      <button type="button" class="tb-btn" aria-haspopup="true" aria-expanded="false" aria-controls="${id}">
        ${opts.icon || ""}<span class="tb-label">${esc(opts.label)}</span><span class="tb-value"></span>${Icons.arrow}
      </button>
      <div class="dd-panel" id="${id}" role="group" aria-label="${esc(opts.label)}" hidden>
        <button type="button" class="menu-item" data-act="all">Select all</button>
        <button type="button" class="menu-item" data-act="clear">Clear</button>
        <div class="menu-sep" role="separator"></div>
        <div class="dd-list"></div>
      </div>`;
    this.root = mount;
    this.btn = mount.querySelector(".tb-btn");
    this.panel = mount.querySelector(".dd-panel");
    this.list = mount.querySelector(".dd-list");
    this.valueEl = mount.querySelector(".tb-value");

    this.btn.addEventListener("click", () => this.panel.hidden ? this.open() : this.close());
    this.panel.addEventListener("click", e => {
      const a = e.target.closest("[data-act]");
      if (a) a.dataset.act === "all" ? opts.onAll() : opts.onClear();
    });
    this.list.addEventListener("change", e => {
      if (e.target.matches("input[type=checkbox]")) opts.onToggle(e.target.value);
    });
    this.panel.addEventListener("keydown", e => this.onKey(e));
    this.btn.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" && this.panel.hidden) { e.preventDefault(); this.open(); }
      if (e.key === "Escape" && !this.panel.hidden) { e.preventDefault(); this.close(); }
    });
    this.onDocDown = e => { if (!this.root.contains(e.target)) this.close(false); };
    this.root.addEventListener("focusout", e => {
      if (!this.panel.hidden && e.relatedTarget && !this.root.contains(e.relatedTarget)) this.close(false);
    });
  }

  open() {
    MultiSelect.closeOthers(this);
    this.panel.hidden = false;
    this.btn.setAttribute("aria-expanded", "true");
    this.render();
    this.place();
    document.addEventListener("pointerdown", this.onDocDown);
    const first = this.list.querySelector("input");
    if (first) first.focus();
  }

  close(returnFocus = true) {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", this.onDocDown);
    if (returnFocus) this.btn.focus();
  }

  // Keep the panel inside the viewport on narrow screens.
  place() {
    this.panel.style.left = "0px";
    const r = this.panel.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) this.panel.style.left = -Math.min(over, r.left - 8) + "px";
  }

  onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const boxes = [...this.list.querySelectorAll("input")];
    if (!boxes.length) return;
    e.preventDefault();
    const i = boxes.indexOf(document.activeElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? boxes.length - 1
      : e.key === "ArrowDown" ? Math.min(boxes.length - 1, i + 1) : Math.max(0, i - 1);
    boxes[n].focus();
  }

  // Updates the button summary always, and the list when the panel is open.
  // The list is rebuilt only when its options change, so focus survives toggles.
  render() {
    const options = this.opts.options();
    const sel = this.opts.selected();
    const n = sel ? options.filter(o => sel.has(o.value)).length : options.length;
    const all = !sel || n === options.length;
    this.valueEl.textContent = all ? "All" : n === 0 ? "None" : n === 1 ? options.find(o => sel.has(o.value)).label : `${n} selected`;
    this.btn.setAttribute("aria-label", `${this.opts.label}: ${this.valueEl.textContent}`);
    if (this.panel.hidden) return;

    const key = options.map(o => o.value).join("\u0001");
    if (key !== this.key) {
      this.key = key;
      this.list.innerHTML = options.length ? options.map(o => `
        <label class="opt">
          <input type="checkbox" value="${esc(o.value)}">
          ${o.prefix || ""}<span class="opt-label">${esc(o.label)}</span>
          <span class="n"></span>
        </label>`).join("") : `<div class="dd-empty">No options</div>`;
    }
    const boxes = this.list.querySelectorAll("input");
    options.forEach((o, i) => {
      boxes[i].checked = !sel || sel.has(o.value);
      boxes[i].parentElement.querySelector(".n").textContent = o.count.toLocaleString();
      boxes[i].parentElement.classList.toggle("is-zero", !o.count);
    });
  }

  static closeOthers(except) {
    MultiSelect.all.forEach(m => { if (m !== except) m.close(false); });
  }
}
// Every instance, so opening one dropdown closes the others.
MultiSelect.all = new Set();
