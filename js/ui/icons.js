// ---- Inline SVG icons (paths adapted from Lucide, ISC license) --------------
const Icons = (() => {
  const svg = (body, cls = "") =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  const BELL = `<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`;
  return {
    bellFilled: svg(BELL.replace("<path ", '<path fill="currentColor" '), "filled"),
    bellRing: svg(BELL.replace("<path ", '<path fill="currentColor" ') + `<path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>`, "filled"),
    search: svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`),
    x: svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
    // Small filled triangle, as on JavaFX ComboBox / MenuButton / ChoiceBox arrows
    arrow: `<svg class="ico arrow" viewBox="0 0 8 5" width="8" height="5" aria-hidden="true" focusable="false"><path d="M0 0h8L4 5z" fill="currentColor"/></svg>`,
    globe: svg(`<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>`),
    plus: svg(`<path d="M5 12h14M12 5v14"/>`),
    pencil: svg(`<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>`),
    trash: svg(`<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`),
    copy: svg(`<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
  };
})();
