import React from 'react';

export const usdc = (micro) => (Number(micro) / 1e6).toFixed(2);

// ------------------------------------------------------------------------------------------------ Payday split
// One incoming line forks. The pocket's share goes to the pocket; the rest drops into the black band "Protected".
// audience="phone": the band NEVER shows an amount and its width never depends on one. Even if a caller passes
// protectedAmount, the phone version ignores it (test/phone-privacy.test.js checks this).
export function Split({ audience, incoming, pocketShare, protectedAmount, play = 0, note }) {
  const phone = audience === 'phone';
  const total = phone ? null : Math.max(Number(incoming ?? 0), Number(pocketShare ?? 0));
  const share = phone || !total ? 0.5 : Math.min(0.78, Math.max(0.22, Number(pocketShare ?? 0) / total));
  const showAmounts = !phone;
  return (
    <div className={`split${play ? ' play' : ''}`} key={play} data-audience={phone ? 'phone' : 'home'} style={{ '--at': `${share * 100}%`, '--share': share, '--rest': 1 - share }}>
      <div className="split-stem">
        <span className="split-in">Incoming{showAmounts && incoming != null ? <b className="mono"> {usdc(incoming)}</b> : null}</span>
      </div>
      <div className="split-fork">
        <div className="split-pocket" data-pocket>
          <span className="split-name">Pocket</span>
          {pocketShare != null && <b className="mono split-amt">+{usdc(pocketShare)}</b>}
        </div>
        <div className="split-protected" data-protected>
          <span className="split-name">Protected</span>
          {showAmounts && protectedAmount != null && <b className="mono split-amt">+{usdc(protectedAmount)}</b>}
        </div>
      </div>
      {note && <p className="split-note">{note}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Pocket tiles (refill)
// Ten slots, each worth a tenth of the phone limit. New tiles pop in one after another.
export function Tiles({ filled, from = filled, slots = 10, play = 0 }) {
  return (
    <div className="tiles" role="img" aria-label={`${filled} of ${slots} tiles`} key={play}>
      {Array.from({ length: slots }, (_, i) => {
        const on = i < filled, fresh = on && i >= from;
        return <span key={i} className={`tile${on ? ' on' : ''}${fresh ? ' pop' : ''}`} style={fresh ? { '--i': i - from } : undefined} />;
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Bill tile (rent)
// A tile that flips to "Paid". `flip` is true only when the page watched it become paid; a bill that was already
// paid when the page loaded simply shows the paid face.
export function BillTile({ bill, flip = false, onPay, canPay = true }) {
  const paid = !!bill.used;
  return (
    <div className={`bill${paid ? ' is-paid' : ''}${paid && flip ? ' flip' : ''}`}>
      <div className="bill-inner">
        <div className="bill-face bill-front" aria-hidden={paid || undefined} inert={paid || undefined}>
          <span className="label">{bill.label}</span>
          <b className="mono bill-amt">{usdc(bill.amount)} USDC</b>
          <span className="mono small">to {bill.payee.slice(0, 12)}…</span>
          {onPay && <button className="action" disabled={!canPay} onClick={() => onPay(bill.id)}>Pay</button>}
        </div>
        <div className="bill-face bill-back" aria-hidden={!paid || undefined}>
          <span className="label">{bill.label}</span>
          <b className="bill-paid">Paid</b>
          <span className="mono small">{usdc(bill.amount)} USDC</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Refusal
// The amount goes out and comes back; the raw refusal reason is shown, unedited, in a red slab.
// Red appears nowhere except here and on blocked log rows.
export function Refusal({ amount, status, body, play = 0 }) {
  return (
    <div className="refusal" role="alert" key={play}>
      {amount != null && <div className="bounce-track"><span className="bounce-amount mono">{amount} USDC</span></div>}
      <div className="refusal-slab">
        <b className="refusal-head">Refused · HTTP {status}</b>
        <pre className="mono refusal-raw">{JSON.stringify(body, null, 2)}</pre>
      </div>
    </div>
  );
}
