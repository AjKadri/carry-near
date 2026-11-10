import React, { useCallback, useEffect, useState } from 'react';

const usdc = (micro) => (Number(micro) / 1e6).toFixed(2);
const api = (path, init = {}) => fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, body: init.body ? JSON.stringify(init.body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

function usePoll(path, ms = 2000, headers) {
  const [data, setData] = useState(null);
  const load = useCallback(() => api(path, { headers }).then((r) => setData(r)).catch(() => {}), [path, JSON.stringify(headers)]);
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [data, load];
}

// ---------- Pay page: what a client sees. Shows one deposit address, nothing about the reserve.
function Pay({ handle }) {
  const [info] = usePoll(`/api/pay/${handle}`, 60000);
  const [amount, setAmount] = useState('5');
  const [refundTo, setRefundTo] = useState('');
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [status] = usePoll(quote ? `/api/pay/${handle}/status?address=${quote.address}` : '/api/health', 3000);
  const [mockMsg, setMockMsg] = useState('');
  const mode = usePoll('/api/mode', 60000)[0]?.body?.mode;
  if (info?.status === 404) return <p>This payment link does not exist.</p>;
  const ask = async () => {
    setError('');
    const r = await api(`/api/pay/${handle}/quote`, { method: 'POST', body: { amountUsdc: Number(amount), refundTo } });
    r.status === 200 ? setQuote(r.body) : setError(r.body?.error ?? 'could not get an address');
  };
  const st = quote && status?.body?.status;
  return (
    <>
      <h1>Pay {handle}</h1>
      <p>Pay with USDC on Solana. Enter an amount and your own Solana address (used only to return the payment if it fails).</p>
      {!quote && (
        <p>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} size={8} aria-label="Amount in USDC" /> USDC<br />
          <input value={refundTo} onChange={(e) => setRefundTo(e.target.value)} size={44} placeholder="Your Solana address" aria-label="Your Solana address" /><br />
          <button onClick={ask}>Get payment address</button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {quote && (
        <>
          <p>Send <b>{usdc(quote.amountIn)} USDC</b> on <b>Solana</b> to:</p>
          <p><code style={{ wordBreak: 'break-all' }}>{quote.address}</code></p>
          <p>Valid until {new Date(quote.deadline).toLocaleString()}. Status: <b>{st === 'SUCCESS' ? 'Payment received' : st === 'PROCESSING' ? 'Payment seen, settling…' : st === 'REFUNDED' ? 'Returned to you' : 'Waiting for your payment'}</b></p>
          {mode === 'mock' && st === 'PENDING_DEPOSIT' && <p><button onClick={async () => { const r = await api('/api/mock/pay', { method: 'POST', body: { address: quote.address } }); setMockMsg(r.body?.ok ? 'simulated' : 'failed'); }}>Mock: simulate this payment</button> {mockMsg}</p>}
        </>
      )}
    </>
  );
}

// ---------- Phone: holds only the pocket key. No reserve data anywhere.
function Phone({ mock }) {
  const [key, setKey] = useState(() => { try { return sessionStorage.getItem('pocketKey') || (mock ? 'mock-pocket-key' : ''); } catch { return ''; } });
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  const [s, reload] = usePoll('/api/phone/state', 2000, headers);
  const [bills, reloadBills] = usePoll('/api/phone/bills', 3000);
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('1');
  const [res, setRes] = useState(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { try { key && sessionStorage.setItem('pocketKey', key); } catch { /* private mode */ } }, [key]);
  const send = async () => { setSending(true); setRes(null); const r = await api('/api/phone/send', { method: 'POST', headers, body: { to, amountUsdc: Number(amt) } }); setRes(r); setSending(false); reload(); };
  const payBill = async (id) => { setRes(await api(`/api/phone/bills/${id}/pay`, { method: 'POST', body: {} })); reloadBills(); reload(); };
  return (
    <>
      <h1>Pocket</h1>
      {!mock && <p><input value={key} onChange={(e) => setKey(e.target.value)} size={30} type="password" placeholder="Pocket key" aria-label="Pocket key" /></p>}
      {s?.status === 200 ? <><p style={{ fontSize: 32 }}>{usdc(s.body.pocket)} USDC</p><p>Limit on this phone: {usdc(s.body.ceiling)} USDC · {s.body.note}</p></> : <p>{s ? 'Cannot read the pocket (key missing or wrong).' : 'Loading…'}</p>}
      <h2>Send</h2>
      <p><input value={to} onChange={(e) => setTo(e.target.value)} size={30} placeholder="Recipient NEAR account" aria-label="Recipient" /> <input value={amt} onChange={(e) => setAmt(e.target.value)} size={5} aria-label="Amount" /> USDC <button disabled={sending} onClick={send}>{sending ? 'Sending…' : 'Send'}</button></p>
      <h2>Bills</h2>
      {(bills?.body?.bills ?? []).map((b) => (
        <p key={b.id}>{b.label}: {usdc(b.amount)} USDC to <code>{b.payee.slice(0, 10)}…</code> {b.used ? <b>paid</b> : <button onClick={() => payBill(b.id)}>Pay</button>}</p>
      ))}
      {res && <details open><summary>{res.status === 200 ? 'Accepted' : `Refused (HTTP ${res.status})`}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(res.body, null, 2)}</pre></details>}
    </>
  );
}

// ---------- Home: reserve, log with refusals, allowance, bills.
function Home() {
  const [s, reloadS] = usePoll('/api/home/state');
  const [log, reloadLog] = usePoll('/api/home/log');
  const [allow, setAllow] = useState('40');
  const [bill, setBill] = useState({ id: 'rent', label: 'Rent', payee: '', amountUsdc: '15', expiresAt: '' });
  const [msg, setMsg] = useState('');
  const st = s?.body;
  const act = async (p, init) => { const r = await api(p, init); setMsg(r.status === 200 ? 'done' : JSON.stringify(r.body)); reloadS(); reloadLog(); };
  return (
    <>
      <h1>Home</h1>
      {st?.halted && <div className="banner" role="alert"><b>{st.halted.code}</b>: refills are halted until reviewed. <button onClick={() => act('/api/home/engine/clear-halt', { method: 'POST' })}>Clear</button></div>}
      {st && <p>Reserve (hidden from phone): <b>{usdc(st.reserve)}</b> USDC · Pocket: <b>{usdc(st.pocket)}</b> / {usdc(st.ceiling)} · Refills left: <b>{usdc(st.allowance)}</b> USDC</p>}
      {st?.wallets && <p style={{ fontSize: 13 }}>Wallets at start: {st.wallets}</p>}
      <p>Authorise total refills: <input value={allow} onChange={(e) => setAllow(e.target.value)} size={6} /> USDC <button onClick={() => act('/api/home/allowance', { method: 'POST', body: { totalUsdc: Number(allow) } })}>Set</button></p>
      <h2>Pre-approved bill</h2>
      <p>
        <input value={bill.id} onChange={(e) => setBill({ ...bill, id: e.target.value })} size={8} aria-label="id" />{' '}
        <input value={bill.payee} onChange={(e) => setBill({ ...bill, payee: e.target.value })} size={24} placeholder="payee account" aria-label="payee" />{' '}
        <input value={bill.amountUsdc} onChange={(e) => setBill({ ...bill, amountUsdc: e.target.value })} size={5} aria-label="amount" /> USDC{' '}
        <input value={bill.expiresAt} onChange={(e) => setBill({ ...bill, expiresAt: e.target.value })} size={20} placeholder="expires (ISO date)" aria-label="expires" />{' '}
        <button onClick={() => act('/api/home/bills', { method: 'POST', body: { ...bill, label: bill.label || bill.id, amountUsdc: Number(bill.amountUsdc), expiresAt: new Date(bill.expiresAt).toISOString() } })}>Save bill</button>
      </p>
      {(st?.bills ?? []).map((b) => <p key={b.id}>{b.label}: {usdc(b.amount)} USDC → <code>{b.payee.slice(0, 12)}…</code> until {new Date(b.expiresAt).toLocaleString()} {b.used ? '(paid)' : ''}</p>)}
      {msg && <p>{msg}</p>}
      <h2>Activity</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>USDC</th><th></th></tr></thead>
        <tbody>
          {(log?.body?.events ?? []).map((e) => (
            <tr key={e.id} style={e.ok ? undefined : { background: '#fde' }}>
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
  const [m] = usePoll('/api/mode', 60000);
  const mode = m?.body;
  const path = window.location.pathname;
  const origin = (port) => `${window.location.protocol}//${window.location.hostname}:${port}`;
  const view = path.startsWith('/pay/') ? 'pay' : path.startsWith('/phone') ? 'phone' : 'home';
  return (
    <>
      {mode?.mode === 'mock' && <div className="banner">Mock mode: simulated money, no network calls.</div>}
      <main>
        {mode && <nav><a href={`${origin(mode.homePort)}/home`}>Home</a><a href={`${origin(mode.publicPort)}/phone`}>Phone</a><a href={`${origin(mode.publicPort)}/pay/${mode.handle}`}>Pay link</a></nav>}
        {view === 'pay' ? <Pay handle={path.split('/')[2]} /> : view === 'phone' ? <Phone mock={mode?.mode === 'mock'} /> : <Home />}
      </main>
    </>
  );
}
