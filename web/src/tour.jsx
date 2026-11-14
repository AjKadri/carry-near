// The sandbox's guided tour: four steps at the very top of Home. Each step is done in place and gets a tick from the session's REAL events.
import React from 'react';
import { Ico, Check, Smartphone } from './icons.jsx';

// Which steps have really happened, read from the session's event log (newest first or any order).
export function tourState(events = []) {
  const has = (k) => events.some((e) => e.kind === k);
  return {
    pay: has('payment_in'),
    phone: has('pair_confirmed'),
    blocked: has('phone_send_refused'),
    rentSaved: has('bill_created'),
    rent: has('bill_paid'),
  };
}

function Step({ n, done, title, children }) {
  return (
    <li className="tour-step" data-done={done ? 'true' : 'false'}>
      <span className="tour-mark" aria-label={done ? 'done' : `step ${n}`}>{done ? <Ico as={Check} /> : n}</span>
      <div className="tour-body"><b className="tour-title">{title}</b>{children}</div>
    </li>
  );
}

export function SandboxTour({ events, busy, note, onPay, onPhone, onRent }) {
  const s = tourState(events);
  return (
    <section className="room paper tour" aria-label="Guided tour">
      <div className="inner">
        <h2><Ico as={Smartphone} /> Try Carry in 60 seconds</h2>
        <p className="lede">Everything here is simulated and private to this browser. Do the four steps in order; each one ticks when it has really happened.</p>
        <ol className="tour-list">
          <Step n={1} done={s.pay} title="Simulate a client payment (5 USDC)">
            <button className="action big" onClick={onPay} disabled={busy === 'pay'}>{s.pay ? 'Simulate another 5 USDC payment' : 'Simulate a client payment (5 USDC)'}</button>
            <span className="muted">Watch Payday: 3.00 goes to the pocket, 2.00 stays Protected.</span>
          </Step>
          <Step n={2} done={s.phone} title="Open the phone view">
            <button className="action big" onClick={onPhone} disabled={busy === 'phone'}>Open the phone view</button>
            <span className="muted">A new tab, already paired to this demo.</span>
          </Step>
          <Step n={3} done={s.blocked} title="On the phone, try to send 500">
            <span className="muted">The phone view has it filled in. Press Send and see it blocked.</span>
          </Step>
          <Step n={4} done={s.rent} title="Pay the rent from the phone">
            <button className="action big" onClick={onRent} disabled={busy === 'rent' || s.rent}>{s.rent ? 'Rent paid' : s.rentSaved ? 'Rent is saved: press Pay on the phone' : 'Create the Rent bill (15 USDC)'}</button>
            <span className="muted">Then press Pay on Rent in the phone tab.</span>
          </Step>
        </ol>
        {s.pay && s.phone && s.blocked && s.rent
          ? <p role="status"><b>All four done.</b> Look around Home, or press "Reset my demo" at the top to start again.</p>
          : note && <p className="mono wrap" role="status">{note}</p>}
      </div>
    </section>
  );
}
