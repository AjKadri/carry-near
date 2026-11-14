import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { loadKey, createKey, clearKey, publicKeySpkiB64, signedFetch } from './homeKey.js';
import { plain, usePoll } from './api.js';
import { Split, Tiles, BillTile, Refusal, usdc } from './parts.jsx';
import { SLOTS, usePocketMotion, useFlipIds } from './motion.js';
import { Phone } from './phone.jsx';
import { Ico, ShieldCheck, Wallet, Split as SplitIco, ReceiptText, LogOut, Smartphone, ArrowDownLeft } from './icons.jsx';
import { Protects } from './protects.jsx';
import { Empty } from './empty.jsx';
import { HomeSummary } from './home-summary.jsx';
import { ActivityPanel } from './activity.jsx';

// The stored id is the name as a slug (lower case letters, digits, dashes): "Rent" -> rent, "Car insurance" -> car-insurance.
export const billId = (name) => String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const Msg = ({ msg, where }) => msg?.where !== where ? null : msg.ok ? <p className="mono wrap" role="status">{msg.text}</p> : <Refusal status={msg.status} body={msg.body} play={msg.status} subject="the reserve" />;
const Refused = ({ head = 'Refused', children }) => <div className="refusal-slab" role="alert"><b className="refusal-head">{head}</b>{children}</div>;

// ---------------------------------------------------------------- Pay page (public). Room: teal.
function Pay({ handle }) {
  const [info] = usePoll(() => plain(`/api/pay/${handle}`), [handle], 60000);
  const [amount, setAmount] = useState('5');
  const [refundTo, setRefundTo] = useState('');
  const [chainId, setChainId] = useState('');
  const [est, setEst] = useState(null);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [mockMsg, setMockMsg] = useState('');
  const [status] = usePoll(() => (quote ? plain(`/api/pay/${handle}/status?address=${quote.address}`) : Promise.resolve(null)), [quote?.address], 3000);
  const [mode] = usePoll(() => plain('/api/mode'), [], 60000);
  if (info?.status === 404) return <section className="room teal fill"><div className="inner"><h1>Not found</h1><p>This payment link does not exist.</p></div></section>;
  const chains = info?.body?.chains ?? [];
  const chain = chains.find((c) => c.id === chainId) ?? chains.find((c) => c.id === info?.body?.defaultChain) ?? chains[0];
  // The fee and the lowest accepted amount come from a dry 1Click quote for the chosen chain (no address, no money).
  useEffect(() => {
    if (!chain || quote) return undefined;
    setEst(null);
    let off = false;
    const t = setTimeout(async () => {
      if (!(Number(amount) > 0)) return;
      const r = await plain(`/api/pay/${handle}/estimate`, { method: 'POST', body: { chain: chain.id, amountUsdc: Number(amount) } });
      if (!off) setEst(r.status === 200 ? r.body : { error: r.body?.error ?? 'could not get a fee estimate' });
    }, 400);
    return () => { off = true; clearTimeout(t); };
  }, [chain?.id, amount, quote, handle]);
  const exact = (m) => String(m / 1e6);
  const ask = async () => {
    setError('');
    const r = await plain(`/api/pay/${handle}/quote`, { method: 'POST', body: { chain: chain?.id, amountUsdc: Number(amount), refundTo } });
    r.status === 200 ? setQuote(r.body) : setError(r.body?.error ?? 'could not get an address');
  };
  const st = status?.body?.status;
  const stText = st === 'SUCCESS' ? 'Payment received' : st === 'PROCESSING' ? 'Payment seen, settling…' : st === 'REFUNDED' ? 'Returned to you' : 'Waiting for your payment';
  return (
    <>
    <section className="room teal fill">
      <div className="inner two">
       <div className="pay-main">
        <p className="label">Pay link</p>
        <h1>Pay {info?.body?.payee ?? handle}</h1>
        <p className="lede">Pay with {chain ? chain.label : 'USDC on Solana'}. It always arrives as USDC in a protected account. Enter an amount and your own {chain?.addressName ?? 'Solana address'} (used only to return the payment if it fails).</p>
        {!quote && (
          <div className="form">
            {chains.length > 1 && <label>Pay with<select value={chain?.id ?? ''} onChange={(e) => { setChainId(e.target.value); setRefundTo(''); setError(''); }}>{chains.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>}
            <label>Amount ({chain?.symbol ?? 'USDC'})<input className="mono" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
            <label>Your {chain?.addressName ?? 'Solana address'}<input className="mono" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder={`Your ${chain?.addressName ?? 'Solana address'}`} /></label>
            <p className="mono small" aria-live="polite">{est?.error && !est.tooLow ? est.error : est ? `${est.tooLow ? est.error : `Fee about ${exact(est.fee)} ${chain.symbol} · arrives about ${exact(est.amountOut)} USDC`}${est.minimum != null && !est.tooLow ? ` · minimum ${exact(est.minimum)} ${chain.symbol}` : ''}` : 'Checking the fee…'}</p>
            <button className="action" onClick={ask}>Get payment address</button>
          </div>
        )}
        {error && <Refused><p className="mono refusal-raw">{error}</p></Refused>}
        {quote && (
          <div className="stack">
            <p>Send <b className="mono">{usdc(quote.amountIn)} {quote.chain?.symbol ?? 'USDC'}</b> on <b>{quote.chain?.chain ?? 'Solana'}</b> to:</p>
            <p className="slab mono wrap">{quote.address}</p>
            <p>Valid until <span className="mono">{new Date(quote.deadline).toLocaleString()}</span>{quote.fee != null && <> · fee about <span className="mono">{exact(quote.fee)} {quote.chain?.symbol}</span></>}{quote.minimum != null && <> · minimum <span className="mono">{exact(quote.minimum)} {quote.chain?.symbol}</span></>}. Send only {quote.chain?.symbol ?? 'USDC'} on {quote.chain?.chain ?? 'Solana'} to this address.</p>
            <p className="status" role="status"><span className="label">Status</span><b>{stText}</b></p>
            {mode?.body?.mode === 'mock' && st === 'PENDING_DEPOSIT' && <p><button className="ghost" onClick={async () => { const r = await plain('/api/mock/pay', { method: 'POST', body: { address: quote.address } }); setMockMsg(r.body?.ok ? 'simulated' : 'failed'); }}>Mock: simulate this payment</button> <span className="mono">{mockMsg}</span></p>}
          </div>
        )}
       </div>
       <aside className="card" aria-label="Payment summary">
        <p className="label"><Ico as={ShieldCheck} /> Payment summary</p>
        <dl className="facts">
          <dt>Paying</dt><dd><b>{info?.body?.payee ?? handle}</b></dd>
          <dt>You send</dt><dd className="mono">{quote ? `${usdc(quote.amountIn)} ${quote.chain?.symbol ?? 'USDC'}` : `${Number(amount) > 0 ? Number(amount).toFixed(2) : '–'} ${chain?.symbol ?? 'USDC'}`}</dd>
          <dt>Arrives after fees</dt><dd className="mono">{quote?.amountOut ? `about ${usdc(quote.amountOut)} USDC` : 'shown once you get a payment address'}</dd>
        </dl>
        <p className="card-note">Your payment lands in a protected account. Only a small share reaches their phone.</p>
       </aside>
      </div>
    </section>
    <Protects />
    </>
  );
}

// ---------------------------------------------------------------- Phone pairing page (opened from the QR). Room: teal.
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
        const r = await plain(`/api/pair/${id}/result`, { headers: { 'X-Pair-Secret': secret.current } });
        if (r.body?.state === 'confirmed') { try { localStorage.setItem('carryPocketKey', r.body.pocketKey); } catch { /* private mode */ } setState('paired'); return; }
        if (r.status !== 200) { setState('failed'); return; }
      }
    })();
    return () => { stop = true; };
  }, [id]);
  return (
    <section className="room teal fill">
      <div className="inner">
        <p className="label">Pairing</p>
        <h1>Pair this phone</h1>
        {state === 'claiming' && <p>Connecting…</p>}
        {state === 'waiting' && <><p>Check that your laptop shows this same code, then confirm on the laptop.</p><p className="code mono">{code}</p></>}
        {state === 'paired' && <p>Paired. <a href="/phone">Open the pocket</a></p>}
        {state === 'failed' && <Refused><p>This pairing link did not work or has expired. Start again on the laptop.</p></Refused>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Home: gate (setup / not the paired laptop / ready)
const Gate = ({ title, children }) => <section className="room teal fill"><div className="inner"><p className="label">Home</p><h1>{title}</h1>{children}</div></section>;

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
  if (stage === 'loading') return <Gate title="Home"><p>Loading…</p></Gate>;
  if (stage === 'setup') return (
    <Gate title="Set up this laptop">
      <p className="lede">Carry will only take orders from this browser. Enter the one-time setup code shown on the server console. This browser then makes a private key that cannot be exported; the server keeps only its public half.</p>
      <div className="form"><label>Setup code<input className="mono" value={code} onChange={(e) => setCode(e.target.value)} /></label><button className="action" onClick={setup}>Set up</button></div>
      {error && <Refused><p className="mono refusal-raw">{error}</p></Refused>}
    </Gate>
  );
  if (stage === 'blocked') return <Gate title="Home"><Refused head="Blocked"><p>Another browser is set up as this Carry's home. Open Home on that laptop. If you lost it, run <code className="mono">npm run reset-home-key</code> on the server and set up again. Your funds stay safe either way: moving them out needs the owner's NEAR wallet.</p></Refused></Gate>;
  if (stage === 'unrecognised') return <Gate title="Home"><Refused head="Blocked"><p>The server does not recognise this browser's key.</p></Refused><p><button className="ghost" onClick={async () => { await clearKey(); check(); }}>Forget this browser's key</button></p></Gate>;
  return <HomeApp onUnrecognised={() => setStage('unrecognised')} />;
}

function PairPanel({ paired }) {
  const [s, setS] = useState(null); // { id, secret, expiresAt }
  const [view, setView] = useState(null);
  const canvas = useRef(null);
  const [mode] = usePoll(() => plain('/api/mode'), [], 60000);
  // ONE address, shown twice: as the QR and as the link. Same id, same one-time secret, same session and expiry.
  const pairUrl = s ? `${mode?.body?.publicUrl || window.location.origin}/pair/${s.id}#${s.secret}` : null;
  const start = async () => { const r = await signedFetch('/api/home/pair/start', { method: 'POST' }); if (r.status === 200) { setS(r.body); setView({ state: 'waiting' }); } };
  useEffect(() => {
    if (!s || !canvas.current) return;
    const css = getComputedStyle(document.documentElement); // QR colours come from the tokens
    QRCode.toCanvas(canvas.current, pairUrl, { width: 220, margin: 1, color: { dark: css.getPropertyValue('--ink').trim(), light: css.getPropertyValue('--paper').trim() } });
  }, [s, pairUrl]);
  useEffect(() => {
    if (!s || ['confirmed', 'expired'].includes(view?.state)) return;
    const t = setInterval(async () => { const r = await signedFetch(`/api/home/pair/${s.id}`); if (r.status === 200) setView(r.body); }, 1500);
    return () => clearInterval(t);
  }, [s, view?.state]);
  const confirm = async () => { await signedFetch(`/api/home/pair/${s.id}/confirm`, { method: 'POST' }); setView({ ...view, state: 'confirmed' }); };
  const cancel = async () => { await signedFetch(`/api/home/pair/${s.id}/cancel`, { method: 'POST' }); setS(null); setView(null); };
  return (
    <div className="stack">
      <h2><Ico as={Smartphone} /> Pair a phone</h2>
      {!s && !paired && <Empty icon={Smartphone} head="No phone paired yet." next="Press Pair phone, then scan the QR code with your phone (or open the pairing link in a private window)." />}
      {!s && paired && <p className="muted">A phone has been paired. You can pair another at any time.</p>}
      {!s && <p><button className="action" onClick={start}>Pair phone</button></p>}
      {s && view?.state === 'waiting' && <><p>Scan this with the phone camera. The phone gets only its pocket credential.</p><canvas ref={canvas} className="qr" /><p className="muted">No camera? Open this link in a private window instead: <a className="mono wrap" href={pairUrl} target="_blank" rel="noreferrer">pairing link</a></p><p><button className="ghost" onClick={cancel}>Cancel</button></p></>}
      {s && view?.state === 'claimed' && <><p>The phone is connected. Does it show this code?</p><p className="code mono">{view.code}</p><p><button className="action" onClick={confirm}>Yes, same code: pair it</button> <button className="ghost" onClick={cancel}>No, cancel</button></p></>}
      {s && view?.state === 'confirmed' && <p>Paired. The phone now holds its pocket credential. <button className="ghost" onClick={() => { setS(null); setView(null); }}>Done</button></p>}
      {s && view?.state === 'expired' && <p>This pairing link expired. <button className="ghost" onClick={() => { setS(null); setView(null); }}>Start again</button></p>}
    </div>
  );
}

// The latest arrival and what became of it, read from the home log (newest first).
function paydayFrom(events) {
  const pin = events.find((e) => e.kind === 'payment_in');
  if (!pin) return null;
  const after = events.filter((e) => e.id > pin.id);
  const share = after.filter((e) => e.kind === 'refill_success').at(-1);
  const skipped = after.some((e) => e.kind === 'refill_skipped');
  const incoming = Number(pin.amount ?? 0), pocket = share ? Number(share.amount ?? 0) : 0;
  return { settled: !!share || skipped, incoming, pocket, protectedAmount: Math.max(0, incoming - pocket), over: pocket > incoming, key: `${pin.id}:${share?.id ?? skipped}` };
}

// ---------------------------------------------------------------- Home (signed). Rooms: teal, paper, mist, paper, teal, mist, paper.
function HomeApp({ onUnrecognised }) {
  const [s, reloadS] = usePoll(() => signedFetch('/api/home/state'), [], 2000);
  const [log, reloadLog] = usePoll(() => signedFetch('/api/home/log'), [], 2000);
  const [allow, setAllow] = useState('');
  const [bill, setBill] = useState({ name: '', payee: '', amountUsdc: '15', expiresAt: '' });
  const [exitAmt, setExitAmt] = useState('1');
  const [mode] = usePoll(() => plain('/api/mode'), [], 60000);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (s?.status === 401) onUnrecognised(); }, [s?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = s?.body;
  const act = async (p, init, describe) => {
    const r = await signedFetch(p, init);
    setMsg(r.status === 200 ? { where: p, ok: true, text: describe ? describe(r.body) : 'Saved.' } : { where: p, ok: false, status: r.status, body: r.body });
    reloadS(); reloadLog();
  };
  const events = log?.body?.events ?? [];
  const day = paydayFrom(events);
  const [, tiles] = usePocketMotion(st?.reserve !== undefined ? st.pocket : null, st?.ceiling);
  const flipIds = useFlipIds(st?.bills);
  // The split plays when a NEW settled arrival appears after the page loaded; one already settled at load shows its final state.
  const seen = useRef(undefined);
  const [play, setPlay] = useState(0);
  useEffect(() => {
    if (!log?.body) return;
    const k = day?.settled ? day.key : null;
    if (seen.current === undefined) seen.current = k;
    else if (k && k !== seen.current) { seen.current = k; setPlay((p) => p + 1); }
  }, [log, day?.key, day?.settled]); // eslint-disable-line react-hooks/exhaustive-deps
  const paired = events.some((e) => e.kind === 'pair_confirmed');
  const bills = st?.bills ?? [];
  return (
    <>
      <HomeSummary st={st}>
        {st?.halted && <Refused head={st.halted.code}><p>Refills are halted until reviewed. <button className="ghost" onClick={() => act('/api/home/engine/clear-halt', { method: 'POST' }, () => 'Halt cleared. Refills resume on the next cycle.')}>Clear</button></p></Refused>}
      </HomeSummary>

      <Protects />

      <section className="room mist">
        <div className="inner">
          <h2><Ico as={SplitIco} /> Payday</h2>
          {day ? <>
            <Split audience="home" incoming={day.incoming} pocketShare={day.settled ? day.pocket : null} protectedAmount={day.settled ? day.protectedAmount : null} play={play}
              note={day.over ? 'The refill was larger than this payment: the pocket was also topped up from what the reserve already held.' : undefined} />
            <p><button className="ghost" onClick={() => setPlay((p) => p + 1)}>Replay</button> {!day.settled && <span className="muted">Waiting for the pocket's share…</span>}</p>
          </> : <Empty icon={ArrowDownLeft} head="No payments yet." next="Share your pay link with a client. When money arrives, the split appears here: one line forking into your pocket and the Protected band.">
            <p><a href={`/pay/${mode?.body?.handle ?? 'demo'}`}>Open your pay link</a>{mode?.body?.mode === 'mock' && <span className="muted"> · demo: press "Mock: simulate this payment" on that page</span>}</p>
          </Empty>}
        </div>
      </section>

      <section className="room paper">
        <div className="inner two">
          <div className="stack">
            <h2><Ico as={Wallet} /> Pocket</h2>
            {st?.reserve !== undefined && <>
              <p className="amount-mid mono">{usdc(st.pocket)} <span className="unit">/ {usdc(st.ceiling)}</span></p>
              <Tiles filled={tiles.filled} from={tiles.from} slots={SLOTS} play={tiles.play} />
              <p className="muted">Refills left: <b className="mono">{usdc(st.allowance)}</b> USDC</p>
            </>}
            <div className="form inline">
              <label>Authorise total refills (USDC)<input className="mono" value={allow} onChange={(e) => setAllow(e.target.value)} inputMode="decimal" placeholder={st?.allowance === undefined ? '' : `${usdc(st.allowance)} now`} /></label>
              <button className="action" disabled={allow.trim() === '' || !Number.isFinite(Number(allow))} onClick={() => act('/api/home/allowance', { method: 'POST', body: { totalUsdc: Number(allow) } }, (b) => `Phone allowance set to ${usdc(b.allowance)} USDC.`)}>Set</button>
            </div>
            <Msg msg={msg} where="/api/home/allowance" />
          </div>
          <PairPanel paired={paired} />
        </div>
      </section>

      <section className="room teal">
        <div className="inner two">
          <div className="stack">
            <h2><Ico as={ReceiptText} /> Pre-approved bill</h2>
            <div className="form">
              <label>Name<input value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} placeholder="Rent" /></label>
              <label>Payee account<input className="mono" value={bill.payee} onChange={(e) => setBill({ ...bill, payee: e.target.value })} placeholder="payee account" /></label>
              <label>Amount (USDC)<input className="mono" value={bill.amountUsdc} onChange={(e) => setBill({ ...bill, amountUsdc: e.target.value })} /></label>
              <label>Expires (ISO date)<input className="mono" value={bill.expiresAt} onChange={(e) => setBill({ ...bill, expiresAt: e.target.value })} placeholder="2030-01-01T00:00:00Z" /></label>
              <button className="action" disabled={!billId(bill.name)} onClick={() => act('/api/home/bills', { method: 'POST', body: { id: billId(bill.name), label: bill.name.trim(), payee: bill.payee, amountUsdc: Number(bill.amountUsdc), expiresAt: new Date(bill.expiresAt).toISOString() } }, () => 'Bill saved.')}>Save bill</button>
            </div>
            <Msg msg={msg} where="/api/home/bills" />
          </div>
          <div className="stack">
            <h2><Ico as={ReceiptText} /> Bills</h2>
            <div className="bills">{bills.map((b) => <BillTile key={b.id} bill={b} flip={flipIds.has(b.id)} />)}</div>
            {bills.length === 0 && <Empty icon={ReceiptText} head="No bills yet." next="Save one with the form. Your phone can pay it by its id only, never with another amount or payee." />}
          </div>
        </div>
      </section>

      <section className="room mist">
        <div className="inner">
          <h2><Ico as={LogOut} /> Withdraw to your exit account</h2>
          <div className="form inline">
            <label>Amount (USDC)<input className="mono" value={exitAmt} onChange={(e) => setExitAmt(e.target.value)} /></label>
            <button className="action" onClick={() => act('/api/home/exit', { method: 'POST', body: { amountUsdc: Number(exitAmt) } }, (b) => `Withdrawal requested for ${Number(exitAmt).toFixed(2)} USDC: approve it in your OutLayer dashboard (request ${String(b.requestId ?? '').slice(0, 8)}, status ${b.status}).`)}>Request withdrawal</button>
          </div>
          <p>To <code className="mono">{st?.exitAccount}</code></p>
          <p className="muted">Carry's approver never approves this. You approve it in your OutLayer dashboard.</p>
          <Msg msg={msg} where="/api/home/exit" />
        </div>
      </section>

      <ActivityPanel events={events} wallets={st?.wallets} />
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
      <header className="bar">
        <div className="bar-in">
          <a className="mark" href="/">Carry</a>
          {mode && view !== 'pair' && <nav><a href="/home" aria-current={view === 'home' ? 'page' : undefined}>Home</a><a href="/phone" aria-current={view === 'phone' ? 'page' : undefined}>Phone</a><a href={`/pay/${mode.handle}`} aria-current={view === 'pay' ? 'page' : undefined}>Pay link</a></nav>}
        </div>
      </header>
      <main>
        {view === 'pay' ? <Pay handle={path.split('/')[2]} /> : view === 'pair' ? <PairPhone id={path.split('/')[2]} /> : view === 'phone' ? <Phone /> : <HomeGate />}
      </main>
    </>
  );
}
