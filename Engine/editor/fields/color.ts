/**
 * Colours, as the map files hold them: one integer, 0xRRGGBB.
 *
 * The picker works in hue/saturation/value because that is how a person reaches
 * for a colour — "the same orange but darker" is one axis in HSV and three in
 * RGB — but nothing outside this file sees that. What goes in and comes out is
 * the number the map already stores.
 */

export const toHex = (value: number | undefined) =>
  `#${Math.max(0, Math.round(value ?? 0)).toString(16).padStart(6, '0')}`;

export const fromHex = (text: string) => {
  const parsed = Number.parseInt(text.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Whether a typed string is a complete six-digit colour yet. */
export const isHex = (text: string) => /^#?[0-9a-f]{6}$/i.test(text.trim());

export type Hsv = { h: number; s: number; v: number };

export function toHsv(rgb: number): Hsv {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;

  let h = 0;
  if (span) {
    if (max === r) h = ((g - b) / span + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / span + 2) * 60;
    else h = ((r - g) / span + 4) * 60;
  }
  return { h, s: max ? span / max : 0, v: max };
}

export function fromHsv({ h, s, v }: Hsv): number {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const sextant = Math.floor(h / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sextant];
  const byte = (channel: number) => Math.round((channel + m) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/**
 * Every colour already used on this map, most recently added last.
 *
 * The useful half of a colour picker: most colour picking is reusing a colour
 * you chose earlier, and the alternative is matching it by eye against a
 * gradient.
 */
export function palette(map: Record<string, unknown> | null | undefined): number[] {
  if (!map) return [];
  const seen = new Set<number>();
  const walk = (value: unknown, key: string) => {
    if (typeof value === 'number' && /colou?r|tint|sky|ground|fog|ambient/i.test(key)) {
      if (value >= 0 && value <= 0xffffff) seen.add(Math.round(value));
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) walk(item, name);
    }
  };
  walk(map, '');
  return [...seen];
}
