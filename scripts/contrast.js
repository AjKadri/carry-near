// `npm run contrast`: WCAG 2.x contrast for every text/background pair used in the app, read from web/src/tokens.css.
// Exits 1 if any pair is below AA (4.5:1). The README Disclosure table is this script's output.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(new URL('../web/src/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const vars = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const resolve = (n) => { let v = vars[n]; while (v?.startsWith('var(')) v = vars[v.slice(6, -1)]; if (!/^#[0-9a-f]{6}$/i.test(v ?? '')) throw new Error(`token --${n} is not a hex colour: ${v}`); return v.toUpperCase(); };
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [label, text token, background token]
export const PAIRS = [
  ['Text on paper', 'on-paper', 'paper'], ['Muted on paper', 'on-paper-muted', 'paper'],
  ['Text on cobalt', 'on-cobalt', 'cobalt'], ['Muted on cobalt', 'on-cobalt-muted', 'cobalt'],
  ['Text on emerald', 'on-emerald', 'emerald'], ['Muted on emerald', 'on-emerald-muted', 'emerald'],
  ['Text on ink', 'on-ink', 'ink'], ['Muted on ink', 'on-ink-muted', 'ink'],
  ['Refusal slab text', 'on-refusal', 'refusal'], ['Blocked row text (red on paper)', 'refusal', 'paper'],
  ['Button on cobalt room (cobalt on paper)', 'cobalt', 'paper'], ['Button on emerald room (emerald on paper)', 'emerald', 'paper'], ['Button on ink room (ink on paper)', 'ink', 'paper'],
];
export const rows = () => PAIRS.map(([label, fg, bg]) => ({ label, fg: resolve(fg), bg: resolve(bg), ratio: ratio(resolve(fg), resolve(bg)) }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let bad = 0;
  for (const r of rows()) { const ok = r.ratio >= 4.5; if (!ok) bad++; console.log(`${ok ? 'AA ' : 'FAIL'}  ${r.ratio.toFixed(2).padStart(5)}:1  ${r.fg} on ${r.bg}  ${r.label}`); }
  console.log(bad ? `${bad} pair(s) below AA 4.5:1` : 'all pairs meet WCAG AA (4.5:1)');
  process.exit(bad ? 1 : 0);
}
