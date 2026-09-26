/**
 * Contraste WCAG a partir de oklch — sin dependencias externas. Se usa para (1)
 * fijar los valores de la paleta Finanzas cumpliendo AA y (2) el test que parsea
 * `globals.css` y verifica los pares de texto/fondo reales (ver `contrast.test.ts`
 * y el test de `globals.css`).
 *
 * Cadena: oklch → OKLab → linear sRGB → luminancia relativa → ratio WCAG.
 * Referencias: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance (fórmula del
 * ratio y de la luminancia sRGB) y https://bottosson.github.io/posts/oklab/
 * (matriz OKLab → LMS → sRGB lineal, constantes de Björn Ottosson).
 */

export type Oklch = { l: number; c: number; h: number };

type Rgb01 = { r: number; g: number; b: number };

/** "oklch(0.22 0.03 255)" o "oklch(14.1% 0.005 285.823)" → { l (0-1), c, h (grados) }. */
export function parseOklch(value: string): Oklch {
  const match = value.trim().match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (!match) throw new Error(`No es un oklch() válido: "${value}"`);
  const [, lRaw = "", cRaw = "", hRaw = ""] = match;
  const l = lRaw.endsWith("%") ? Number(lRaw.slice(0, -1)) / 100 : Number(lRaw);
  return { l, c: Number(cRaw), h: Number(hRaw) };
}

/** OKLab → LMS (cubo) → linear sRGB. Constantes de Ottosson, sin redondear. */
function oklabToLinearSrgb(L: number, a: number, b: number): Rgb01 {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function oklchToLinearSrgb(value: Oklch): Rgb01 {
  const hRad = (value.h * Math.PI) / 180;
  const a = value.c * Math.cos(hRad);
  const b = value.c * Math.sin(hRad);
  return oklabToLinearSrgb(value.l, a, b);
}

/** WCAG define la luminancia relativa sobre componentes sRGB *lineales* — que es
 * justo lo que ya entrega la conversión oklab→srgb. Clampeamos a [0,1]: los
 * valores que usamos no deberían salirse de gamut, pero evita NaN/negativos. */
function relativeLuminance({ r, g, b }: Rgb01): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

export function oklchRelativeLuminance(value: string | Oklch): number {
  const parsed = typeof value === "string" ? parseOklch(value) : value;
  return relativeLuminance(oklchToLinearSrgb(parsed));
}

function srgbChannelToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa desde un hex "#rrggbb" — solo para comparar contra oklch
 * en los tests (referencia cruzada) y, en T4, verificar que un literal hex de
 * chart coincide con el color por defecto de una utilidad Tailwind. */
export function relativeLuminanceFromHex(hex: string): number {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return relativeLuminance({
    r: srgbChannelToLinear(r),
    g: srgbChannelToLinear(g),
    b: srgbChannelToLinear(b),
  });
}

/** Ratio WCAG a partir de dos luminancias relativas (orden indistinto). */
export function contrastRatioFromLuminance(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Ratio WCAG entre dos colores oklch (string u objeto ya parseado). */
export function contrastRatio(a: string | Oklch, b: string | Oklch): number {
  return contrastRatioFromLuminance(oklchRelativeLuminance(a), oklchRelativeLuminance(b));
}
