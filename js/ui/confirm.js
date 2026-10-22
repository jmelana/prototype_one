// ---- Confirmation dialog --------------------------------------------------------
// The web stand-in for a JavaFX Alert(AlertType.CONFIRMATION): title bar, header,
// message, and a ButtonBar with Cancel and the action. It opens on top of any
// dialog already showing. Escape, the ✕ and Cancel all answer false; Cancel has
// focus first, so a stray Enter never confirms a destructive action.
//
//   Confirm.ask({ title, header, message, ok: "Delete" }).then(yes => ...)
const Confirm = (() => {
  let dlg = null;
  function ask({ title, header, message, ok = "OK" }) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "modal confirm-modal";
      dlg.setAttribute("aria-labelledby", "cfHeader");
      dlg.setAttribute("aria-describedby", "cfMsg");
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `
      <div class="modal-head">
        <span class="win-title">${esc(title)}</span>
        <button type="button" class="icon-btn" data-ans="no" aria-label="Close" title="Close">${Icons.x}</button>
      </div>
      <div class="confirm-body">
        <h2 id="cfHeader">${esc(header)}</h2>
        <p id="cfMsg">${esc(message)}</p>
      </div>
      <div class="modal-foot"><span class="spacer"></span>
        <button type="button" class="btn" data-ans="no">Cancel</button>
        <button type="button" class="btn primary" data-ans="yes">${esc(ok)}</button>
      </div>`;
    return new Promise(resolve => {
      let answer = false;
      const onClick = e => {
        const b = e.target.closest("[data-ans]");
        if (b) { answer = b.dataset.ans === "yes"; dlg.close(); }
      };
      dlg.addEventListener("click", onClick);
      dlg.addEventListener("close", () => { dlg.removeEventListener("click", onClick); resolve(answer); }, { once: true });
      dlg.showModal();
      dlg.querySelector('.modal-foot [data-ans="no"]').focus();
    });
  }
  return { ask };
})();
