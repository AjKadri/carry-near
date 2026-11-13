// The phone view. It loads ONLY the public phone API (/api/phone/*, /api/mode) with the pocket key. It has no reserve
// amount to show: the phone API never returns one, and nothing in this file reads one. test/phone-privacy.test.js checks.
import React, { useRef, useState } from 'react';
import { plain, usePoll } from './api.js';
import { Ico, Wallet, Split as SplitIco, Send as SendIco, ReceiptText } from './icons.jsx';
import { Split, Tiles, BillTile, Refusal, usdc } from './parts.jsx';
import { SLOTS, usePocketMotion, useFlipIds } from './motion.js';

export function PhoneView({ status, pocket, ceiling, sendLimit, note, bills, flipIds, split, tiles, res, to, setTo, amt, setAmt, sending, onSend, onPay }) {
  return (
    <>
      <section className="room teal">
        <div className="inner">
          <h1 className="label"><Ico as={Wallet} /> Pocket</h1>
          {status === 'ok' && <>
            <p className="amount mono" data-pocket-amount>{usdc(pocket)}<span className="unit"> USDC</span></p>
            <Tiles filled={tiles.filled} from={tiles.from} slots={SLOTS} play={tiles.play} />
            <p className="muted limits"><span>Holds up to <span className="mono">{usdc(ceiling)}</span> USDC</span><span>Sends up to <span className="mono">{usdc(sendLimit)}</span> at a time</span><span>{note}</span></p>
          </>}
          {status === 'loading' && <p>Loading…</p>}
          {status === 'unreadable' && <p>Cannot read the pocket. Pair this phone again from the laptop.</p>}
        </div>
      </section>

      <section className="room paper">
        <div className="inner">
          <h2><Ico as={SplitIco} /> Payday</h2>
          <p className="muted">Money arrives as one line. Your pocket takes its share; everything else is Protected.</p>
          <Split audience="phone" pocketShare={split.share} play={split.play} />
        </div>
      </section>

      <section className="room mist">
        <div className="inner">
          <h2><Ico as={SendIco} /> Send</h2>
          <div className="form">
            <label>Recipient NEAR account<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name.near" /></label>
            <label>Amount (USDC)<input className="mono" value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" /></label>
            <button className="action" disabled={sending} onClick={onSend}>{sending ? 'Sending…' : 'Send'}</button>
          </div>
          {res && res.status === 200 && <div className="accepted" role="status"><b className="label">Accepted</b><pre className="mono raw">{JSON.stringify(res.body, null, 2)}</pre></div>}
          {res && res.status !== 200 && <Refusal amount={res.amount} status={res.status} body={res.body} play={res.play} />}
        </div>
      </section>

      <section className="room teal">
        <div className="inner">
          <h2><Ico as={ReceiptText} /> Bills</h2>
          {(bills ?? []).length === 0 && <p className="muted">No pre-approved bills.</p>}
          <div className="bills">
            {(bills ?? []).map((b) => <BillTile key={b.id} bill={b} flip={flipIds.has(b.id)} onPay={onPay} />)}
          </div>
        </div>
      </section>
    </>
  );
}

export function Phone() {
  const [key] = useState(() => { try { return localStorage.getItem('carryPocketKey') || ''; } catch { return ''; } });
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  const [s, reload] = usePoll(() => (key ? plain('/api/phone/state', { headers }) : Promise.resolve(null)), [key], 2000);
  const [bills, reloadBills] = usePoll(() => plain('/api/phone/bills'), [], 3000);
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('1');
  const [res, setRes] = useState(null);
  const [sending, setSending] = useState(false);
  const [split, tiles] = usePocketMotion(s?.status === 200 ? s.body.pocket : null, s?.body?.ceiling);
  const flipIds = useFlipIds(bills?.body?.bills);
  const seq = useRef(0);

  if (!key) return <section className="room teal"><div className="inner"><h1 className="label"><Ico as={Wallet} /> Pocket</h1><p className="amount-mid">Not paired</p><p>This phone is not paired. On your laptop, open Home and choose Pair phone, then scan the QR code.</p></div></section>;
  const send = async () => { setSending(true); setRes(null); const r = await plain('/api/phone/send', { method: 'POST', headers, body: { to, amountUsdc: Number(amt) } }); setRes({ ...r, amount: Number(amt).toFixed(2), play: ++seq.current }); setSending(false); reload(); };
  const payBill = async (id) => { const r = await plain(`/api/phone/bills/${id}/pay`, { method: 'POST', body: {} }); setRes({ ...r, amount: null, play: ++seq.current }); reloadBills(); reload(); };
  const status = s?.status === 200 ? 'ok' : s ? 'unreadable' : 'loading';
  return <PhoneView status={status} pocket={s?.body?.pocket} ceiling={s?.body?.ceiling} sendLimit={s?.body?.sendLimit} note={s?.body?.note} bills={bills?.body?.bills} flipIds={flipIds} split={split} tiles={tiles} res={res} to={to} setTo={setTo} amt={amt} setAmt={setAmt} sending={sending} onSend={send} onPay={payBill} />;
}
