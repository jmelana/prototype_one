// ---- Color contrast ------------------------------------------------------------
// WCAG 2 relative luminance and contrast ratio, used to pick readable text on the
// Indicator fills and to warn when a text color is hard to read on the table.
const Colors = (() => {
  const WHITE = "#ffffff", DARK = "#111111";
  const MIN_TEXT_CONTRAST = 4.5; // WCAG AA for normal-size text

  // "#rrggbb" (or "#rgb") -> [r, g, b] 0-255, or null.
  function parse(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join("") : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }

  function luminance(hex) {
    const rgb = parse(hex);
    if (!rgb) return null;
    const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // 1 (no contrast) to 21 (black on white); null if either color can't be read.
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    if (la == null || lb == null) return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Text color for a fill: white on dark fills, near-black on light ones.
  const ink = fill => (contrast(fill, WHITE) ?? 0) >= (contrast(fill, DARK) ?? 0) ? WHITE : DARK;

  // Is `fg` readable as text on every one of `backgrounds`?
  const readable = (fg, backgrounds) => backgrounds.every(bg => (contrast(fg, bg) ?? 21) >= MIN_TEXT_CONTRAST);

  return { contrast, ink, readable, isDark: hex => (luminance(hex) ?? 0) < 0.18 };
})();
