import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { loadKey, createKey, clearKey, publicKeySpkiB64, signedFetch, syncClock } from './homeKey.js';

const usdc = (micro) => (Number(micro) / 1e6).toFixed(2);
const plain = async (path, init = {}) => {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  syncClock(r);
  return { status: r.status, body: await r.json().catch(() => null) };
};

function usePoll(fetcher, deps, ms = 2000) {
  const [data, setData] = useState(null);
  const load = useCallback(() => fetcher().then(setData).catch(() => {}), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [data, load];
}

// ---------------------------------------------------------------- Pay page (public)
function Pay({ handle }) {
  const [info] = usePoll(() => plain(`/api/pay/${handle}`), [handle], 60000);
  const [amount, setAmount] = useState('5');
  const [refundTo, setRefundTo] = useState('');
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [mockMsg, setMockMsg] = useState('');
  const [status] = usePoll(() => (quote ? plain(`/api/pay/${handle}/status?address=${quote.address}`) : Promise.resolve(null)), [quote?.address], 3000);
  const [mode] = usePoll(() => plain('/api/mode'), [], 60000);
  if (info?.status === 404) return <p>This payment link does not exist.</p>;
  const ask = async () => {
    setError('');
    const r = await plain(`/api/pay/${handle}/quote`, { method: 'POST', body: { amountUsdc: Number(amount), refundTo } });
    r.status === 200 ? setQuote(r.body) : setError(r.body?.error ?? 'could not get an address');
  };
  const st = status?.body?.status;
  return (
    <>
      <h1>Pay {handle}</h1>
      <p>Pay with USDC on Solana. Enter an amount and your own Solana address (used only to return the payment if it fails).</p>
      {!quote && (
        <p>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} size={8} aria-label="Amount in USDC" /> USDC<br />
          <input value={refundTo} onChange={(e) => setRefundTo(e.target.value)} size={44} placeholder="Your Solana address" aria-label="Your Solana address" /><br />
          <button className="primary" onClick={ask}>Get payment address</button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {quote && (
        <>
          <p>Send <b>{usdc(quote.amountIn)} USDC</b> on <b>Solana</b> to:</p>
          <p><code style={{ wordBreak: 'break-all' }}>{quote.address}</code></p>
          <p>Valid until {new Date(quote.deadline).toLocaleString()}. Status: <b>{st === 'SUCCESS' ? 'Payment received' : st === 'PROCESSING' ? 'Payment seen, settling…' : st === 'REFUNDED' ? 'Returned to you' : 'Waiting for your payment'}</b></p>
          {mode?.body?.mode === 'mock' && st === 'PENDING_DEPOSIT' && <p><button onClick={async () => { const r = await plain('/api/mock/pay', { method: 'POST', body: { address: quote.address } }); setMockMsg(r.body?.ok ? 'simulated' : 'failed'); }}>Mock: simulate this payment</button> {mockMsg}</p>}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Phone pairing page (opened from the QR)
function PairPhone({ id }) {
  const secret = useRef(window.location.hash.slice(1));
  const [state, setState] = useState('claiming');
  const [code, setCode] = useState('');
  useEffect(() => {
    let stop = false;
    (async () => {
      const c = await plain('/api/pair/claim', { method: 'POST', body: { id, secret: secret.current } });
      if (c.status !== 200) { setState('failed'); return; }
      history.replaceState(null, '', window.location.pathname); // the secret does not stay in the address bar
      setCode(c.body.code); setState('waiting');
      while (!stop) {
        await new Promise((r) => setTimeout(r, 2000));
        const r = await plain(`/api/pair/${id}/result?secret=${encodeURIComponent(secret.current)}`);
        if (r.body?.state === 'confirmed') { try { localStorage.setItem('carryPocketKey', r.body.pocketKey); } catch { /* private mode */ } setState('paired'); return; }
        if (r.status !== 200) { setState('failed'); return; }
      }
    })();
    return () => { stop = true; };
  }, [id]);
  return (
    <>
      <h1>Pair this phone</h1>
      {state === 'claiming' && <p>Connecting…</p>}
      {state === 'waiting' && <><p>Check that your laptop shows this same code, then confirm on the laptop.</p><p className="code">{code}</p></>}
      {state === 'paired' && <p>Paired. <a href="/phone">Open the pocket</a></p>}
      {state === 'failed' && <p role="alert">This pairing link did not work or has expired. Start again on the laptop.</p>}
    </>
  );
}

// ---------------------------------------------------------------- Phone (public API, pocket key only)
function Phone() {
  const [key, setKey] = useState(() => { try { return localStorage.getItem('carryPocketKey') || ''; } catch { return ''; } });
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  const [s, reload] = usePoll(() => (key ? plain('/api/phone/state', { headers }) : Promise.resolve(null)), [key], 2000);
  const [bills, reloadBills] = usePoll(() => plain('/api/phone/bills'), [], 3000);
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('1');
  const [res, setRes] = useState(null);
  const [sending, setSending] = useState(false);
  if (!key) return <><h1>Pocket</h1><p>This phone is not paired. On your laptop, open Home and choose Pair phone, then scan the QR code.</p></>;
  const send = async () => { setSending(true); setRes(null); setRes(await plain('/api/phone/send', { method: 'POST', headers, body: { to, amountUsdc: Number(amt) } })); setSending(false); reload(); };
  const payBill = async (id) => { setRes(await plain(`/api/phone/bills/${id}/pay`, { method: 'POST', body: {} })); reloadBills(); reload(); };
  return (
    <>
      <h1>Pocket</h1>
      {s?.status === 200 ? <><p className="big">{usdc(s.body.pocket)} USDC</p><p className="muted">Limit on this phone: {usdc(s.body.ceiling)} USDC · {s.body.note}</p></> : <p>{s ? 'Cannot read the pocket. Pair this phone again from the laptop.' : 'Loading…'}</p>}
      <h2>Send</h2>
      <p><input value={to} onChange={(e) => setTo(e.target.value)} size={30} placeholder="Recipient NEAR account" aria-label="Recipient" /> <input value={amt} onChange={(e) => setAmt(e.target.value)} size={5} aria-label="Amount" /> USDC <button className="primary" disabled={sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button></p>
      <h2>Bills</h2>
      {(bills?.body?.bills ?? []).map((b) => (
        <p key={b.id}>{b.label}: {usdc(b.amount)} USDC to <code>{b.payee.slice(0, 10)}…</code> {b.used ? <b>paid</b> : <button onClick={() => payBill(b.id)}>Pay</button>}</p>
      ))}
      {res && <details open><summary>{res.status === 200 ? 'Accepted' : `Refused (HTTP ${res.status})`}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(res.body, null, 2)}</pre></details>}
    </>
  );
}

// ---------------------------------------------------------------- Home: gate (setup / not the paired laptop / ready)
function HomeGate() {
  const [stage, setStage] = useState('loading'); // loading | setup | blocked | ready | unrecognised
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const check = useCallback(async () => {
    const s = await plain('/api/home/auth/status');
    const key = await loadKey();
    if (!s.body?.registered) setStage('setup');
    else if (!key) setStage('blocked');
    else setStage('ready');
  }, []);
  useEffect(() => { check(); }, [check]);
  const setup = async () => {
    setError('');
    try {
      const pair = await createKey(); // non-extractable
      const r = await plain('/api/home/auth/setup', { method: 'POST', body: { publicKey: await publicKeySpkiB64(pair), setupCode: code } });
      if (r.status === 200) setStage('ready'); else { await clearKey(); setError(r.body?.error ?? 'setup failed'); }
    } catch (e) { setError(String(e.message ?? e)); }
  };
  if (stage === 'loading') return <p>Loading…</p>;
  if (stage === 'setup') return (
    <>
      <h1>Set up this laptop</h1>
      <p>Carry will only take orders from this browser. Enter the one-time setup code shown on the server console. This browser then makes a private key that cannot be exported; the server keeps only its public half.</p>
      <p><input value={code} onChange={(e) => setCode(e.target.value)} size={14} aria-label="Setup code" /> <button className="primary" onClick={setup}>Set up</button></p>
      {error && <p role="alert">{error}</p>}
    </>
  );
  if (stage === 'blocked') return <><h1>Home</h1><p role="alert">Another browser is set up as this Carry's home. Open Home on that laptop. If you lost it, run <code>npm run reset-home-key</code> on the server and set up again. Your funds stay safe either way: moving them out needs the owner's NEAR wallet.</p></>;
  if (stage === 'unrecognised') return <><h1>Home</h1><p role="alert">The server does not recognise this browser's key.</p><button onClick={async () => { await clearKey(); check(); }}>Forget this browser's key</button></>;
  return <HomeApp onUnrecognised={() => setStage('unrecognised')} />;
}

function PairPanel() {
  const [s, setS] = useState(null); // { id, secret, expiresAt }
  const [view, setView] = useState(null);
  const canvas = useRef(null);
  const [mode] = usePoll(() => plain('/api/mode'), [], 60000);
  const start = async () => { const r = await signedFetch('/api/home/pair/start', { method: 'POST' }); if (r.status === 200) { setS(r.body); setView({ state: 'waiting' }); } };
  useEffect(() => {
    if (!s || !canvas.current) return;
    const base = mode?.body?.publicUrl || window.location.origin;
    QRCode.toCanvas(canvas.current, `${base}/pair/${s.id}#${s.secret}`, { width: 220, margin: 1 });
  }, [s, mode?.body?.publicUrl]);
  useEffect(() => {
    if (!s || ['confirmed', 'expired'].includes(view?.state)) return;
    const t = setInterval(async () => { const r = await signedFetch(`/api/home/pair/${s.id}`); if (r.status === 200) setView(r.body); }, 1500);
    return () => clearInterval(t);
  }, [s, view?.state]);
  const confirm = async () => { await signedFetch(`/api/home/pair/${s.id}/confirm`, { method: 'POST' }); setView({ ...view, state: 'confirmed' }); };
  const cancel = async () => { await signedFetch(`/api/home/pair/${s.id}/cancel`, { method: 'POST' }); setS(null); setView(null); };
  return (
    <div className="panel">
      <h2>Pair a phone</h2>
      {!s && <button className="primary" onClick={start}>Pair phone</button>}
      {s && view?.state === 'waiting' && <><p>Scan this with the phone camera. The phone gets only its pocket credential.</p><canvas ref={canvas} /><p><button onClick={cancel}>Cancel</button></p></>}
      {s && view?.state === 'claimed' && <><p>The phone is connected. Does it show this code?</p><p className="code">{view.code}</p><button className="primary" onClick={confirm}>Yes, same code: pair it</button> <button onClick={cancel}>No, cancel</button></>}
      {s && view?.state === 'confirmed' && <p>Paired. The phone now holds its pocket credential. <button onClick={() => { setS(null); setView(null); }}>Done</button></p>}
      {s && view?.state === 'expired' && <p>This pairing link expired. <button onClick={() => { setS(null); setView(null); }}>Start again</button></p>}
    </div>
  );
}

function HomeApp({ onUnrecognised }) {
  const [s, reloadS] = usePoll(() => signedFetch('/api/home/state'), [], 2000);
  const [log, reloadLog] = usePoll(() => signedFetch('/api/home/log'), [], 2000);
  const [allow, setAllow] = useState('40');
  const [bill, setBill] = useState({ id: 'rent', label: 'Rent', payee: '', amountUsdc: '15', expiresAt: '' });
  const [exitAmt, setExitAmt] = useState('1');
  const [msg, setMsg] = useState('');
  useEffect(() => { if (s?.status === 401) onUnrecognised(); }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = s?.body;
  const act = async (p, init) => { const r = await signedFetch(p, init); setMsg(r.status === 200 ? (r.body?.note ?? 'done') : JSON.stringify(r.body)); reloadS(); reloadLog(); };
  return (
    <>
      <h1>Home</h1>
      {st?.halted && <div className="banner" role="alert"><b>{st.halted.code}</b>: refills are halted until reviewed. <button onClick={() => act('/api/home/engine/clear-halt', { method: 'POST' })}>Clear</button></div>}
      {st?.reserve !== undefined && <p>Reserve (hidden from phone): <b>{usdc(st.reserve)}</b> USDC · Pocket: <b>{usdc(st.pocket)}</b> / {usdc(st.ceiling)} · Refills left: <b>{usdc(st.allowance)}</b> USDC</p>}
      {st?.wallets && <p className="muted">Wallets at start: {st.wallets}</p>}
      <p>Authorise total refills: <input value={allow} onChange={(e) => setAllow(e.target.value)} size={6} /> USDC <button onClick={() => act('/api/home/allowance', { method: 'POST', body: { totalUsdc: Number(allow) } })}>Set</button></p>
      <PairPanel />
      <h2>Pre-approved bill</h2>
      <p>
        <input value={bill.id} onChange={(e) => setBill({ ...bill, id: e.target.value })} size={8} aria-label="id" />{' '}
        <input value={bill.payee} onChange={(e) => setBill({ ...bill, payee: e.target.value })} size={24} placeholder="payee account" aria-label="payee" />{' '}
        <input value={bill.amountUsdc} onChange={(e) => setBill({ ...bill, amountUsdc: e.target.value })} size={5} aria-label="amount" /> USDC{' '}
        <input value={bill.expiresAt} onChange={(e) => setBill({ ...bill, expiresAt: e.target.value })} size={20} placeholder="expires (ISO date)" aria-label="expires" />{' '}
        <button onClick={() => act('/api/home/bills', { method: 'POST', body: { ...bill, label: bill.label || bill.id, amountUsdc: Number(bill.amountUsdc), expiresAt: new Date(bill.expiresAt).toISOString() } })}>Save bill</button>
      </p>
      {(st?.bills ?? []).map((b) => <p key={b.id}>{b.label}: {usdc(b.amount)} USDC → <code>{b.payee.slice(0, 12)}…</code> until {new Date(b.expiresAt).toLocaleString()} {b.used ? '(paid)' : ''}</p>)}
      <h2>Withdraw to your exit account</h2>
      <p><input value={exitAmt} onChange={(e) => setExitAmt(e.target.value)} size={6} aria-label="Exit amount" /> USDC to <code>{st?.exitAccount}</code> <button onClick={() => act('/api/home/exit', { method: 'POST', body: { amountUsdc: Number(exitAmt) } })}>Request withdrawal</button></p>
      <p className="muted">Carry's approver never approves this. You approve it in your OutLayer dashboard.</p>
      {msg && <p>{msg}</p>}
      <h2>Activity</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>USDC</th><th></th></tr></thead>
        <tbody>
          {(log?.body?.events ?? []).map((e) => (
            <tr key={e.id} className={e.ok ? undefined : 'blocked'}>
              <td>{e.ts.slice(11, 19)}</td><td>{e.kind}{e.ok ? '' : ' ✗'}</td><td>{e.amount == null ? '' : usdc(e.amount)}</td>
              <td><details><summary>raw</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{JSON.stringify(e.detail, null, 1)}</pre></details></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function App() {
  const [m] = usePoll(() => plain('/api/mode'), [], 60000);
  const mode = m?.body;
  const path = window.location.pathname;
  const view = path.startsWith('/pay/') ? 'pay' : path.startsWith('/pair/') ? 'pair' : path.startsWith('/phone') ? 'phone' : 'home';
  return (
    <>
      {mode?.mode === 'mock' && <div className="banner">Mock mode: simulated money, no network calls.</div>}
      <main>
        {mode && view !== 'pair' && <nav><a href="/home">Home</a><a href="/phone">Phone</a><a href={`/pay/${mode.handle}`}>Pay link</a></nav>}
        {view === 'pay' ? <Pay handle={path.split('/')[2]} /> : view === 'pair' ? <PairPhone id={path.split('/')[2]} /> : view === 'phone' ? <Phone /> : <HomeGate />}
      </main>
    </>
  );
}
