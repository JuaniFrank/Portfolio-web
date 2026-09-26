# UI palettes: switchable color themes + comfortable density

## Objective
Let the user switch the app palette. Keep today's look as **Default** and add a new **Finanzas** palette:
less pure black, finance-oriented colors (deep navy/slate with teal/green accents), higher contrast for
IPS/old screens, and roomier tables/text for older users.

## Problem / why
- Near-black backgrounds (`zinc-950`) with low-contrast secondary text (`zinc-500/600`) wash out on IPS and
  older panels.
- Tables use `p-2` / `h-10` and `text-sm`: dense, small, few margins.
- Colors are hardcoded: ~1,120 `zinc-*` utilities across 83 files plus ~150 hex literals (charts). Semantic
  tokens in `globals.css` exist but are barely used. Touching every file is the "huge change" the user wants
  to avoid.

## Approach
- Tailwind v4 compiles `bg-zinc-900` to `var(--color-zinc-900)`. Redefine the `--color-zinc-*` scale (plus
  accent scales that need tuning, e.g. emerald/rose/teal) under `html[data-palette="finanzas"]`. Default =
  no attribute = current look, byte-identical.
- Palette is independent from next-themes light/dark (the app is dark-first: `defaultTheme="dark"`).
- Persist the choice (localStorage) and apply it before paint (inline script) to avoid a flash.
- Density: table spacing/text driven by CSS variables so Finanzas gets roomier tables while Default stays
  identical.
- Charts: hex literals come from shared constants; read palette-aware colors at runtime so charts follow.

## Tasks
- [x] T1 Palette registry (pure) + provider, persistence, no-flash script, selector in the sidebar — tests
- [x] T2 Finanzas palette CSS (zinc scale + accents + tokens) with a contrast test (WCAG AA for text pairs)
- [x] T3 Comfortable density: tables (`ui/table.tsx` + raw `<table>`s) and base text via CSS variables
- [x] T4 Charts follow the palette (recharts + lightweight-charts colors from CSS variables)
- [x] T5 `pnpm test`, `tsc --noEmit`, eslint on touched files; browser check by the user

## TDD
Strict TDD on (global config). Runner: `pnpm test` (vitest). RED → GREEN for pure modules (palette registry,
stored-value resolution, contrast math) — all three observed RED (module/CSS block missing) before GREEN.

## Progress

### T1 — palette infrastructure (done)
- `src/lib/theme/palettes.ts`: registry (`default`/`finanzas`), `resolvePalette`, `noFlashScript()` (string,
  generated from the registry, no hardcoded ids). Tests in `palettes.test.ts` (5 tests, RED confirmed first).
- `src/components/providers/palette-provider.tsx`: `useSyncExternalStore` (same pattern as
  `currency-provider.tsx`) + one `useEffect` to set/remove `data-palette` on `<html>`; persists to
  `localStorage["portfolio:palette"]`. Wired into `app-providers.tsx` alongside `ThemeProvider`.
- No-flash: raw `<script suppressHydrationWarning dangerouslySetInnerHTML>` in `src/app/layout.tsx`, first
  child of `<body>` — same technique next-themes itself uses (verified by reading
  `node_modules/next-themes/dist/index.mjs`), confirmed present in the compiled HTML via a dev-server curl.
- `src/components/layout/palette-toggle.tsx`: compact "Tema: Default / Finanzas" control, wired into
  `sidebar.tsx` above `ThemeToggle`.

### T2 — Finanzas palette (done)
- `src/lib/theme/contrast.ts`: oklch → OKLab → linear sRGB → relative luminance → WCAG ratio, zero deps.
  Tests include white/black = 21:1 and a cross-check against a known oklch↔hex pair (Tailwind's own
  zinc-950, oklch(14.1% 0.005 285.823) ≈ #09090b, luminance matches within 2 decimals).
- Verified Tailwind v4 fact from the task brief directly in `node_modules/tailwindcss/theme.css`: the zinc
  scale (and accents) live in `@theme default` (not `inline`), so they're real `:root` CSS variables;
  unlayered rules in `globals.css` (like the existing `.dark {}` block) already override them at higher
  cascade priority regardless of specificity — same mechanism `html[data-palette="finanzas"]` relies on.
- `globals.css`: `html[data-palette="finanzas"]` redefines `--color-zinc-50..950` as a navy/slate ramp (hue
  255). Semantic tokens (`--background/--card/--border/--muted/--positive/--negative/--accent`) get a
  `.dark`-scoped block (primary target) and a `:not(.dark)` block (reasonable light variant).
  - Chosen zinc scale (oklch): 950 `0.22 0.035 255`, 900 `0.31 0.04 255`, 800 `0.4 0.045 255`,
    700 `0.47 0.045 255`, 600 `0.64 0.03 255`, 500 `0.74 0.025 255`, 400 `0.81 0.02 255`, 300/200/100/50
    progressively lighter (see file).
  - Measured contrast (via `finanzas-contrast.test.ts`, parses the actual CSS): zinc-500 vs 950 = 7.52:1,
    vs 900 = 5.71:1; zinc-400 vs 950 = 9.6:1, vs 900 = 7.29:1; zinc-600 vs 950 = 5.16:1, vs 900 = 3.92:1;
    zinc-50 vs 950 = 15.87:1. 900-vs-950 separation = 1.32 (vs Default's own 1.12) — more separated than
    today. 800-vs-900 = 1.88, 700-vs-900 = 2.54 (borders clearly visible).
  - Accents: emerald-400/rose-400 (the ones `returnToneClass` actually uses) already clear 4.5:1 against the
    new backgrounds (8.95/6.05) — left untouched, per "only if needed for contrast". `--negative` bumped
    from oklch 0.63→0.66 (4.44→5.01 vs the new background) since it sits right at the AA line; `--positive`/
    `--accent` untouched (7.43/4.69, both pass). Teal not shifted (optional in the brief, not needed).

### T3 — comfortable density (done)
- `ui/table.tsx`: `--table-cell-px/py`, `--table-head-h`, `--table-font-size` + `--table-line-height`
  (added so `text-(length:--var)` doesn't silently drop the `text-sm` paired line-height — confirmed via
  context7 Tailwind docs that `text-(length:--x)` only sets font-size). Defaults = today's `p-2`/`h-10`/
  `text-sm` exactly. Finanzas: px 0.875rem, py 0.75rem, head 3rem, font 0.9375rem, line-height 1.5.
- Raw `<table>`s, each with its own var pair (defaults = each table's own current value, confirmed by
  reading every file): `positions-table.tsx` (px-3/py-2 → 0.75/0.5rem default), `monthly-table.tsx` (shared
  `Th`/`Td` used by both the outer text-sm table and the inner text-xs detail table — 4 vars total), 
  `events-list.tsx` (px-4/py-3 → 1/0.75rem default), `bond-terms-form.tsx` cashflow schedule (px-2/py-1 →
  0.5/0.25rem default, text-[11px]).
- Root font-size 106.25% under `html[data-palette="finanzas"]` (~17px) — charts use fixed px heights, not
  rem, so unaffected.
- Known risk (documented, not fixed): `positions-table.tsx` uses `tableLayout: "fixed"` with persisted
  per-column pixel widths (drag-resize, localStorage) — increasing cell padding in Finanzas shrinks content
  width inside those fixed columns rather than growing them. Cosmetic only; user can re-resize columns.

### T4 — charts follow the palette (done)
- `src/components/providers/use-chart-colors.ts`: `useChartColors()` hook — derived value via `useMemo`
  keyed on `usePalette().palette` (not `useState`+`useEffect`, to avoid the
  `react-hooks/set-state-in-effect` lint error / cascading-render pattern), reading `getComputedStyle` on
  `<html>`. SSR/first-render fallback = today's literal hex values.
- `chart-utils.ts`: `TOOLTIP_CLASS` hex literals → `border-zinc-800 bg-zinc-950` (verified byte-identical:
  computed #27272a/#09090b match Tailwind's own zinc-800/950 exactly, via a throwaway oklch→sRGB→hex script
  using `contrast.ts`'s own conversion).
- Wired `useChartColors()` into: `portfolio-evolution.tsx` (lightweight-charts — grid/axis/crosshair/text
  colors applied on mount from a ref, and re-applied via `chart.applyOptions`/`series.applyOptions` in a
  separate effect keyed on the resolved colors, so palette toggles don't remount the chart or lose
  zoom/state), `drawdown-chart.tsx`, `monthly-return-chart.tsx`, `portfolio-vs-benchmark.tsx`,
  `value-evolution.tsx`, `value-bars.tsx` (recharts axis/grid/tooltip `contentStyle`), `allocation-donut.tsx`
  (Pie `stroke`; its plain-div tooltip switched to Tailwind classes instead, since it isn't a recharts prop).
  `monthly-returns.tsx`'s heatmap "no value" cell switched from an inline hex to a `bg-zinc-900` class
  (same reasoning — plain `<span>`, not a chart-library prop).
- **Left as-is, by design** ("keep series identity colors... unless they fail contrast"): `SERIES_COLORS`
  (`chart-utils.ts`), `CHART_COLORS`/`SECTOR_COLORS`/`MARKET_COLORS` (`dashboard/format.ts`), the buy/sell/
  neutral marker colors in `portfolio-evolution.tsx`, `sector-bars.tsx`'s per-sector fallback color, and
  `allocation-donut.tsx`'s `REST_COLOR` — all categorical/semantic identity colors, not axis/grid chrome.
- **Not converted** (out of the stated dashboard+rendimientos priority, left for a follow-up):
  `dividend-charts.tsx` — same axis/tooltip hex pattern (`#71717a`/`#27272a`/`#18181b`), mechanical to
  convert with the same hook if picked up later.

## Verification
- `pnpm test`: 42 files, 525 tests passed.
- `pnpm tsc --noEmit`: clean.
- `pnpm eslint` on every touched/created file: clean except 4 pre-existing unrelated warnings in
  `sidebar.tsx` (unused lucide icon imports for commented-out nav items — predate this change, confirmed via
  `git show HEAD:...`).
- Dev server (`pnpm dev`, backgrounded then killed): `curl .../login` → `200`; response HTML contains the
  no-flash `<script>` (reads `portfolio:palette`, sets `data-palette`) as the first child of `<body>`.

## Next step
Manual/browser check of the Finanzas palette by the user (visual review, toggle behavior, table density).
Optional follow-up: convert `dividend-charts.tsx` the same way as the other rendimientos charts.

### Independent verification + fixes
- Verifier found: (1) Default line-height regression on raw tables (`text-sm`/`text-xs` roots replaced by
  `text-(length:--var)`, which drops the paired line-height) in positions/monthly/monthly-detail/events tables;
  (2) cross-tab staleness: charts in other tabs read `getComputedStyle` before the attribute was applied;
  (3) misleading comment in `portfolio-evolution.tsx`.
- Fixed: per-table `--*-line-height` vars (Default = `calc(1.25/0.875)` / `calc(1/0.75)`, i.e. text-sm/text-xs;
  Finanzas 1.5) + `leading-(--var)`; `storage` listener applies the attribute before notifying React; comment
  corrected. `pnpm test` 525/525, `tsc` clean, eslint clean on touched files.
- Pending: dividend-charts.tsx palette conversion (follow-up); user browser check.
- Runtime bug (user report): `Failed to parse color: lab(...)` in `createChart` — `getComputedStyle` returns
  Tailwind 4 colors in oklch/lab, lightweight-charts only parses hex/rgb/rgba (affected Default too; recharts
  was fine because SVG accepts them). Fix: `useChartColors` normalizes every value to `rgb()/rgba()` through a
  1×1 canvas (browser-side conversion, cached; falls back to the hex default if conversion fails).
  tsc/eslint clean, tests 525/525. Not reproducible in vitest (needs a real canvas) — browser check pending.
