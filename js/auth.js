// ---- Login gate ----------------------------------------------------------------
// GitHub Pages has no server, so the "login" is the demo password unlocking the
// encrypted API key in this browser. The decrypted key is kept in sessionStorage,
// so it survives reloads but is gone when the tab closes or the user logs out.
(() => {
  const SESSION = "econocal:session";
  const $ = id => document.getElementById(id);
  const form = $("loginForm"), err = $("loginError"), btn = form.querySelector("[type=submit]");

  const session = {
    get() { try { return sessionStorage.getItem(SESSION); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(SESSION, v); } catch { /* unlocks for this page view only */ } },
    clear() { try { sessionStorage.removeItem(SESSION); } catch { /* nothing stored */ } },
  };

  function start(apiKey) {
    $("login").hidden = true;
    $("app").hidden = false;
    startApp({ apiKey, onLogout: () => { session.clear(); location.reload(); } });
  }

  const saved = session.get();
  if (saved) return start(saved);

  $("login").hidden = false;
  const configured = typeof ENCRYPTED_KEY !== "undefined" && ENCRYPTED_KEY;
  if (!configured) {
    err.textContent = "This demo isn't set up yet. The owner needs to run “npm run encrypt-key” and publish js/data/credentials.js.";
  } else if (!Vault.available()) {
    err.textContent = "This page needs a secure connection (https or localhost) to log in.";
  }
  if (err.textContent) { form.querySelectorAll("input, button").forEach(el => { el.disabled = true; }); return; }

  $("password").focus();
  $("showPassword").addEventListener("change", e => { $("password").type = e.target.checked ? "text" : "password"; });
  form.addEventListener("input", () => { err.textContent = ""; $("password").removeAttribute("aria-invalid"); });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const pw = $("password").value;
    if (!pw) { err.textContent = "Enter the demo password."; return; }
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const key = await Vault.decrypt(ENCRYPTED_KEY, pw);
      session.set(key);
      start(key);
    } catch (ex) {
      err.textContent = ex.message === "WRONG_PASSWORD" ? "That password isn't right." : "Couldn't unlock the demo.";
      $("password").setAttribute("aria-invalid", "true");
      $("password").select();
      btn.disabled = false; btn.textContent = "Log in";
    }
  });
})();
