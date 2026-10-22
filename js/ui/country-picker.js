// ---- "Choose countries" dialog --------------------------------------------------
// Pick individual countries without making a group. Mirrors a JavaFX Dialog: a
// search TextField, a TreeView of regions with CheckBoxTreeItems (CountryTree), and
// a ButtonBar. Works on a staged copy; nothing changes until Apply.
//
//   new CountryPicker(dialogEl, {
//     countries: () => [code],          every country that can be picked
//     selection: () => [code],          what to start with (the countries now shown)
//     onApply([code]), onSaveAsGroup([code]),
//   })
class CountryPicker {
  constructor(dialog, opts) {
    this.d = dialog;
    this.opts = opts;
    dialog.innerHTML = `
      <div class="modal-head">
        <h2 id="cpTitle">Choose countries</h2>
        <button type="button" class="icon-btn" data-act="cancel" aria-label="Close" title="Close">${Icons.x}</button>
      </div>
      <div class="cp-bar field-label"><span>Countries</span>
        <span class="field-acts"><span class="n" data-count aria-live="polite"></span><button type="button" class="linkbtn" data-act="clear">Clear</button><button type="button" class="linkbtn" data-act="save">Save as group…</button></span>
      </div>
      <div class="modal-search">${Icons.search}<input type="search" placeholder="Search countries" aria-label="Search countries" autocomplete="off"></div>
      <div class="modal-body"><div class="cp-tree"></div><div class="empty" hidden></div></div>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button type="button" class="btn primary" data-act="apply">Apply</button>
      </div>`;
    dialog.setAttribute("aria-labelledby", "cpTitle");
    this.search = dialog.querySelector(".modal-search input");
    this.count = dialog.querySelector("[data-count]");
    this.empty = dialog.querySelector(".empty");
    this.tree = new CountryTree(dialog.querySelector(".cp-tree"), { onChange: () => this.syncFoot() });

    this.search.addEventListener("input", () => {
      this.tree.filter(this.search.value);
      const none = !this.tree.el.querySelector(".ct-region:not([hidden])");
      this.empty.hidden = !none;
      this.empty.textContent = none ? `No country matches “${this.search.value.trim()}”.` : "";
    });
    dialog.addEventListener("click", e => {
      if (e.target === dialog) return this.close(); // backdrop
      const a = e.target.closest("[data-act]");
      if (!a) return;
      const picked = [...this.tree.selected];
      switch (a.dataset.act) {
        case "cancel": this.close(); break;
        case "clear": this.tree.set([]); this.syncFoot(); break;
        case "apply": this.close(); this.opts.onApply(picked); break;
        case "save": this.close(); this.opts.onSaveAsGroup(picked); break;
      }
    });
  }

  open() {
    this.search.value = "";
    this.empty.hidden = true;
    this.tree.build(this.opts.countries(), this.opts.selection());
    this.syncFoot();
    if (typeof this.d.showModal === "function") this.d.showModal(); else this.d.setAttribute("open", "");
    this.search.focus();
  }
  close() { if (this.d.open) this.d.close(); }

  syncFoot() {
    const sel = [...this.tree.selected].map(Countries.name).sort((a, b) => a.localeCompare(b));
    // Like the group editor's header: "40 selected  Clear  Save as group…" (names on hover).
    this.count.textContent = `${sel.length} selected`;
    this.count.title = sel.join(", ");
    this.d.querySelector("[data-act=clear]").hidden = !sel.length;
    this.d.querySelector("[data-act=save]").hidden = !sel.length;
    this.d.querySelector("[data-act=apply]").disabled = !sel.length;
  }
}
