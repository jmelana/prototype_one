// ---- Alarm window ----------------------------------------------------------------
// Opens whenever alerts have gone off and stays until the user acknowledges them:
// Escape and backdrop clicks are ignored. Shows a live countdown to each release.
//
//   new AlarmDialog(dialogEl, {
//     items: () => [{ id, flag, title, scheduled, ts, released, demo }],
//     onAcknowledge(),
//   })
class AlarmDialog {
  constructor(dialog, opts) {
    this.d = dialog;
    this.opts = opts;
    this.timer = null;
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-labelledby", "alarmTitle");
    dialog.setAttribute("aria-describedby", "alarmList");
    dialog.addEventListener("cancel", e => e.preventDefault()); // Escape can't dismiss it
    dialog.addEventListener("click", e => {
      if (e.target.closest("[data-act=ack]")) return opts.onAcknowledge();
      if (e.target === dialog) dialog.querySelector("[data-act=ack]").focus(); // backdrop: stay put
    });
  }

  // Show, update or close to match the current alerts.
  sync() {
    const items = this.opts.items();
    if (!items.length) return this.close();
    const demo = items.every(i => i.demo);
    this.d.innerHTML = `
      <div class="modal-head"><div class="win-title">Alert</div></div>
      <div class="alarm-head">
        <div>
          <h2 id="alarmTitle">${items.length === 1 ? "Report alert" : `${items.length} report alerts`}</h2>
          ${demo ? `<p class="alarm-sub">Demo alarm. Your real alerts will still go off at their scheduled time.</p>` : ""}
        </div>
        <span class="alarm-ico">${Icons.bellRing}</span>
      </div>
      <ul class="alarm-list" id="alarmList">${items.map(i => `
        <li>
          <div class="alarm-ev">${i.flag}<span>${esc(i.title)}</span></div>
          <div class="alarm-meta">Scheduled ${esc(i.scheduled)}</div>
          <div class="alarm-left" data-ts="${i.ts}" data-released="${i.released}"></div>
        </li>`).join("")}
      </ul>
      <div class="modal-foot"><span class="spacer"></span><button type="button" class="btn primary" data-act="ack">Acknowledge</button></div>`;
    this.tick();
    if (!this.d.open) {
      if (typeof this.d.showModal === "function") this.d.showModal(); else this.d.setAttribute("open", "");
      this.timer = setInterval(() => this.tick(), 1000);
    }
    this.d.querySelector("[data-act=ack]").focus();
  }

  tick() {
    const now = Date.now();
    for (const el of this.d.querySelectorAll(".alarm-left")) {
      const ms = Number(el.dataset.ts) - now;
      el.classList.toggle("is-due", ms <= 0);
      el.textContent = el.dataset.released === "true" ? "Released"
        : ms > 0 ? `${Time.timeLeft(ms)} until the report`
        : "Due now, waiting for the release";
    }
  }

  close() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.d.open) this.d.close();
  }
}
