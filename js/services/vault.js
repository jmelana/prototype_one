// ---- Vault: password-based encryption of the API key -------------------------
// The key is published only as AES-GCM ciphertext; the AES key is derived from
// the demo password with PBKDF2. A wrong password fails GCM's integrity check.
// Shared by the browser (decrypt) and scripts/encrypt-key.js (encrypt), so the
// format is defined once. Uses Web Crypto, available in browsers on https or
// localhost and in Node.
//
// This keeps the key out of the public files. Anyone who logs in can still see
// it in DevTools, since the browser has to send it to Finnhub.
const Vault = (() => {
  const ITERATIONS = 600000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function available() { return !!(globalThis.crypto && crypto.subtle); }

  async function deriveKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function encrypt(secret, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(secret)));
    return { v: 1, kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
  }

  // Resolves to the secret, or rejects with Error("WRONG_PASSWORD").
  async function decrypt(blob, password) {
    if (!blob || blob.v !== 1) throw new Error("UNSUPPORTED_FORMAT");
    const key = await deriveKey(password, unb64(blob.salt), blob.iterations);
    try {
      return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.data)));
    } catch {
      throw new Error("WRONG_PASSWORD");
    }
  }

  return { available, encrypt, decrypt, ITERATIONS };
})();
