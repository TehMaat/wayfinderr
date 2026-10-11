// Accent colors of the dashboard, chosen in the sidebar and kept in this browser.
// Each one has [data-accent] rules in app/globals.css and a tab icon in public/icons
// (written by scripts/logos.mjs)
export const ACCENTS = [
  { id: 'violet', label: 'Violet', swatch: '#8b5cf6' },
  { id: 'red', label: 'Red', swatch: '#ef4444' },
  { id: 'blue', label: 'Blue', swatch: '#3b82f6' },
  { id: 'green', label: 'Green', swatch: '#22c55e' },
  { id: 'amber', label: 'Amber', swatch: '#f59e0b' },
] as const;

export type Accent = (typeof ACCENTS)[number]['id'];

export const DEFAULT_ACCENT: Accent = 'violet';

export function currentAccent(): Accent {
  const accent = document.documentElement.dataset.accent;
  return ACCENTS.some((a) => a.id === accent) ? (accent as Accent) : DEFAULT_ACCENT;
}

export function setAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent;
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]').forEach((link) => {
    link.href = `/icons/${accent}.svg`;
  });
  try {
    localStorage.setItem('accent', accent);
  } catch {
    // Storage unavailable: the accent lasts for this page only
  }
}
