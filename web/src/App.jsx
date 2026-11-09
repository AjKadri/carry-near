import React, { useCallback, useEffect, useState } from 'react';

const usdc = (micro) => (micro / 1e6).toFixed(2);
const get = (p) => fetch(p).then((r) => r.json());

function usePoll(path, ms = 1500) {
  const [data, setData] = useState(null);
  const load = useCallback(() => get(path).then(setData).catch(() => {}), [path]);
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [data, load];
}

// Phone: pocket only. The phone endpoints never return reserve data.
function Phone() {
  const [s] = usePoll('/api/phone/state');
  if (!s) return <p>Loading…</p>;
  return (
    <>
      <h1>Pocket</h1>
      <p style={{ fontSize: 32 }}>{usdc(s.pocket)} USDC</p>
      <p>Limit on this phone: {usdc(s.pocketCap)} USDC</p>
      <p>{s.note}</p>
    </>
  );
}

// Home: reserve and full log.
function Home({ mock }) {
  const [s, reloadS] = usePoll('/api/home/state');
  const [log, reloadLog] = usePoll('/api/home/log');
  const [amount, setAmount] = useState('10');
  const pay = async () => {
    await fetch('/api/mock/pay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountUsdc: Number(amount) }) });
    reloadS(); reloadLog();
  };
  return (
    <>
      <h1>Home</h1>
      {s && <p>Reserve (hidden from phone): <b>{usdc(s.reserve)}</b> USDC · Pocket: <b>{usdc(s.pocket)}</b> USDC</p>}
      {mock && (
        <p>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} size={6} /> USDC{' '}
          <button onClick={pay}>Simulate a payment in</button>
        </p>
      )}
      <h2>Activity</h2>
      <table>
        <thead><tr><th>Time</th><th>Event</th><th>USDC</th></tr></thead>
        <tbody>
          {(log?.events ?? []).map((e) => (
            <tr key={e.id}><td>{e.ts.slice(11, 19)}</td><td>{e.kind}{e.ok ? '' : ' (refused)'}</td><td>{e.amount == null ? '' : usdc(e.amount)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function App() {
  const [mode] = usePoll('/api/mode', 60000);
  const path = window.location.pathname;
  const view = path.startsWith('/phone') ? 'phone' : 'home';
  return (
    <>
      {mode?.mode === 'mock' && <div className="banner">Mock mode: simulated money, no network calls.</div>}
      <main>
        <nav><a href="/home">Home</a><a href="/phone">Phone</a></nav>
        {view === 'phone' ? <Phone /> : <Home mock={mode?.mode === 'mock'} />}
      </main>
    </>
  );
}
