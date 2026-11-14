// `node scripts/validate-submission.js [file]`: checks evidence/submission-draft.json against the live HACKATHON.md contract.
// Fields that are null are OWNER-FILL (the owner supplies them; nothing is guessed). Sends nothing.
import fs from 'node:fs';
const file = process.argv[2] ?? 'evidence/submission-draft.json';
const md = await (await fetch('https://nearhackathon.com/HACKATHON.md')).text();
const trackIds = [...md.matchAll(/^\| `([a-z]+)` \| /gm)].map((m) => m[1]);
const sizes = ['1', '2 - 4', '4 - 6', '6 - 8', '8+'];
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const { _note, ...d } = raw; // _note is a draft-only comment and must not be sent
const FIELDS = ['requestId', 'projectName', 'leadName', 'email', 'size', 'tracks', 'nearAddress', 'projectUrl', 'demoUrl', 'idea', 'consent'];
const rules = {
  requestId: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  projectName: (v) => typeof v === 'string' && v.length >= 2 && v.length <= 80,
  leadName: (v) => typeof v === 'string' && v.length >= 2 && v.length <= 80,
  email: (v) => typeof v === 'string' && v.length <= 160 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  size: (v) => sizes.includes(v),
  tracks: (v) => Array.isArray(v) && v.length >= 1 && new Set(v).size === v.length && v.every((t) => trackIds.includes(t)),
  nearAddress: (v) => typeof v === 'string' && v.length >= 2 && v.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(v),
  projectUrl: (v) => typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= 300,
  demoUrl: (v) => typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= 300,
  idea: (v) => typeof v === 'string' && v.length >= 20 && v.length <= 2000,
  consent: (v) => v === true,
};
let bad = 0;
for (const f of FIELDS) {
  const v = d[f];
  const state = v === null || v === undefined ? 'OWNER-FILL' : rules[f](v) ? 'ok' : (bad++, 'INVALID');
  console.log(f.padEnd(12), state, f === 'idea' && typeof v === 'string' ? `(${v.length} chars)` : f === 'tracks' ? JSON.stringify(v) : '');
}
const extra = Object.keys(d).filter((k) => !FIELDS.includes(k));
if (extra.length) { bad++; console.log('EXTRA FIELDS (not allowed):', extra.join(', ')); }
const bytes = Buffer.byteLength(JSON.stringify(d));
console.log('tracks known to HACKATHON.md:', trackIds.join(', '));
console.log('payload bytes:', bytes, bytes <= 12000 ? '(ok, limit 12000)' : '(TOO LARGE)');
if (bytes > 12000) bad++;
console.log(bad ? `${bad} problem(s)` : 'no problems; only the OWNER-FILL fields remain');
process.exit(bad ? 1 : 0);
