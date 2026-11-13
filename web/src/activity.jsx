// HOME ONLY (it reads the full home log). Plain-language rows, an icon each; the raw JSON stays behind "raw".
import React, { useMemo, useState } from 'react';
import { Ico, ArrowDownLeft, ArrowRightLeft, ReceiptText, LogOut, Send, ShieldAlert, Smartphone, Server, TriangleAlert, Wallet, Landmark, History } from './icons.jsx';
import { usdc, explainRefusal } from './parts.jsx';
import { Empty } from './empty.jsx';

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const why = (d) => cap(explainRefusal(d.http ?? 0, d.raw ?? d).replace(/^Blocked:? ?/, ''));
const short = (s, n = 14) => (String(s ?? '').length > n ? `${String(s).slice(0, n)}…` : String(s ?? ''));
const BLOCKED = {
  missing_or_malformed_headers: ['unsigned request', 'unsigned requests'],
  bad_signature: ['request with a wrong signature', 'requests with a wrong signature'],
  replayed_nonce: ['replayed request', 'replayed requests'],
  stale_timestamp: ['request with a stale or future timestamp', 'requests with a stale or future timestamp'],
};

// One event -> { tab, icon, text, plural(n), blocked, key }. Unknown kinds fall back to their raw name in the System tab.
export function describe(e) {
  const d = e.detail ?? {}, amt = e.amount == null ? '' : ` ${usdc(e.amount)}`;
  switch (e.kind) {
    case 'payment_in': return { tab: 'money', icon: ArrowDownLeft, text: `Payment received${amt}` };
    case 'refill_success': return { tab: 'money', icon: ArrowRightLeft, text: `Moved${amt} to your pocket` };
    case 'refill_skipped': return { tab: 'money', icon: ArrowRightLeft, text: `No refill this time: ${d.why ?? 'nothing to move'}` };
    case 'refill_refused': case 'refill_failed': case 'refill_error': return { tab: 'money', icon: ShieldAlert, blocked: true, text: `Refill${amt} blocked: ${d.reason ?? d.error ?? d.code ?? 'refused'}` };
    case 'GUARD_SHAPE_CHANGED': return { tab: 'money', icon: ShieldAlert, blocked: true, text: 'Refills halted: the approval did not look as expected' };
    case 'bill_created': return { tab: 'money', icon: ReceiptText, text: `Bill saved: ${d.id}${amt}` };
    case 'bill_edited': return { tab: 'money', icon: ReceiptText, text: `Bill changed: ${d.id}${amt}` };
    case 'bill_deleted': return { tab: 'money', icon: ReceiptText, text: `Bill removed: ${d.id}` };
    case 'bill_paid': return { tab: 'money', icon: ReceiptText, text: `Bill paid${amt}: ${d.id}` };
    case 'bill_refused': case 'bill_failed': case 'bill_error': return { tab: 'money', icon: ShieldAlert, blocked: true, text: `Blocked: bill ${d.id}${amt}${d.reason ? ` (${d.reason})` : d.code ? ` (${d.code})` : ''}` };
    case 'allowance_set': return { tab: 'money', icon: Wallet, text: `Refill allowance set to${amt}` };
    case 'phone_send': return { tab: 'money', icon: Send, text: `Phone sent${amt} to ${short(d.to)}` };
    case 'phone_send_refused': return { tab: 'money', icon: ShieldAlert, blocked: true, text: `Blocked: phone tried to send${amt} to ${short(d.to)}. ${why(d)}` };
    case 'exit_requested': return { tab: 'money', icon: LogOut, text: `Withdrawal requested${amt} to ${short(d.to, 18)}` };
    case 'exit_refused': return { tab: 'money', icon: ShieldAlert, blocked: true, text: `Blocked: withdrawal${amt}. ${why(d)}` };
    case 'payment_problem': return { tab: 'money', icon: ShieldAlert, blocked: true, text: `Payment problem${amt}` };
    case 'home_blocked': { const [one, many] = BLOCKED[d.reason] ?? [`request refused (${d.reason ?? 'unknown'})`, `requests refused (${d.reason ?? 'unknown'})`];
      return { tab: 'money', icon: ShieldAlert, blocked: true, key: `home_blocked|${d.reason}`, text: `Blocked: ${one} to your home controls`, plural: (n) => `${n} blocked requests: ${many} to your home controls` }; }
    case 'home_blocked_flood': return { tab: 'money', icon: ShieldAlert, blocked: true, text: 'Blocked: many more refused requests than are listed here' };
    case 'home_setup_failed': return { tab: 'money', icon: ShieldAlert, blocked: true, text: 'Blocked: a wrong setup code was entered' };
    // everything below is plumbing
    case 'refill_planned': return { tab: 'system', icon: ArrowRightLeft, text: `Refill planned${amt}` };
    case 'refill_requested': return { tab: 'system', icon: ArrowRightLeft, text: `Refill requested${amt}` };
    case 'guard_decision': return { tab: 'system', icon: ArrowRightLeft, text: `Guard decided: ${d.approve ? 'approve' : 'refuse'} (${d.code ?? ''})` };
    case 'refill_voted': return { tab: 'system', icon: ArrowRightLeft, text: `Approver voted on the refill${amt}` };
    case 'refill_waiting': return { tab: 'system', icon: ArrowRightLeft, text: 'Refill not settled yet; still checking' };
    case 'address_issued': return { tab: 'system', icon: ArrowDownLeft, text: `Payment address issued for${amt}` };
    case 'pair_started': return { tab: 'system', icon: Smartphone, text: 'Phone pairing started' };
    case 'pair_claimed': return { tab: 'system', icon: Smartphone, text: 'A phone opened the pairing link' };
    case 'pair_confirmed': return { tab: 'system', icon: Smartphone, text: 'Phone pairing confirmed' };
    case 'halt_cleared': return { tab: 'system', icon: Server, text: 'Halt cleared' };
    case 'home_key_registered': return { tab: 'system', icon: Landmark, text: 'This laptop was set up as your Home controller' };
    case 'service_start': return { tab: 'system', icon: Server, text: `Service started (${d.mode ?? ''} mode)` };
    case 'wallet_state': return { tab: 'system', icon: Server, text: `Wallet check: ${d.role ?? ''} v${d.version ?? '?'}, ${d.locked ? 'locked' : 'NOT locked'}, ${d.frozen ? 'FROZEN' : 'not frozen'}` };
    case 'tick_warning': return { tab: 'system', icon: TriangleAlert, key: `tick_warning|${d.call}|${d.status}`, text: `Warning: the platform had a temporary problem (${d.status ?? 'timeout'}); retried, nothing changed`, plural: (n) => `${n} warnings: the platform had a temporary problem (${d.status ?? 'timeout'}); retried, nothing changed` };
    case 'tick_error': return { tab: 'system', icon: TriangleAlert, blocked: true, key: `tick_error|${d.error}`, text: `Error while checking: ${short(d.error, 90)}`, plural: (n) => `${n} errors while checking: ${short(d.error, 90)}` };
    case 'intake_error': return { tab: 'system', icon: TriangleAlert, blocked: true, key: `intake_error|${d.error}`, text: `Could not check a payment address: ${short(d.error, 90)}`, plural: (n) => `${n} failed address checks: ${short(d.error, 90)}` };
    default: return { tab: 'system', icon: Server, text: e.kind };
  }
}

// Fold runs of identical consecutive rows ("3 blocked requests") and keep every raw record for the "raw" view.
export function foldEvents(events) {
  const out = [];
  for (const e of events) {
    const x = describe(e), key = x.key ?? `${e.kind}|${x.text}`, last = out.at(-1);
    if (last && last.key === key && (x.plural || x.blocked)) { // only noise folds (blocked attempts, warnings); two payments are two rows
      last.n++; last.raws.push(e.detail); last.first = e.ts; }
    else out.push({ ...x, key, id: e.id, ts: e.ts, first: e.ts, n: 1, raws: [e.detail] });
  }
  return out;
}

const when = (ts) => { const d = new Date(ts), today = new Date(); const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === today.toDateString() ? t : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${t}`; };
export const PAGE = 10;

export function ActivityPanel({ events }) {
  const [tab, setTab] = useState('money');
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => foldEvents(events.filter((e) => describe(e).tab === tab)), [events, tab]);
  const pick = (t) => { setTab(t); setShown(PAGE); };
  return (
    <section className="room paper" aria-labelledby="activity-h">
      <div className="inner">
        <h2 id="activity-h"><Ico as={History} /> Activity</h2>
        <div role="tablist" className="tabs" aria-label="Activity filter">
          <button role="tab" className="tab" aria-selected={tab === 'money'} onClick={() => pick('money')}>Money</button>
          <button role="tab" className="tab" aria-selected={tab === 'system'} onClick={() => pick('system')}>System</button>
        </div>
        {events.length === 0
          ? <Empty icon={History} head="Nothing has happened yet." next="Activity appears here as it happens: payments, refills, bills and every blocked attempt." />
          : rows.length === 0
            ? <Empty icon={History} head={tab === 'money' ? 'No money events yet.' : 'No system events yet.'} next={tab === 'money' ? 'Payments, refills, bills, withdrawals and refusals show up here.' : 'Service starts, wallet checks and warnings show up here.'} />
            : <ul className="feed">
              {rows.slice(0, shown).map((r) => (
                <li key={r.id} className={r.blocked ? 'blocked' : undefined}>
                  <span className="row-ico"><Ico as={r.icon} /></span>
                  <span className="row-text">{r.n > 1 ? (r.plural ? r.plural(r.n) : `${r.n} × ${r.text}`) : r.text}</span>
                  <span className="row-time mono small">{when(r.ts)}</span>
                  <details className="row-raw"><summary>raw</summary><pre className="mono raw">{JSON.stringify(r.n > 1 ? r.raws.slice(0, 5) : r.raws[0], null, 1)}{r.n > 5 ? `\n… ${r.n - 5} more` : ''}</pre></details>
                </li>
              ))}
            </ul>}
        {rows.length > shown && <p><button className="ghost" onClick={() => setShown((n) => n + PAGE)}>Show more ({rows.length - shown} older)</button></p>}
      </div>
    </section>
  );
}
