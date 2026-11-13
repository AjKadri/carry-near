import React from 'react';
import { Ico, ArrowDownLeft, Split, Smartphone } from './icons.jsx';

// "How Carry protects you": three steps, shown on Home and on the pay page. No amounts, no state: the same words everywhere.
export function Protects() {
  const steps = [
    [ArrowDownLeft, 'Paid', 'A client pays your link. The money arrives as one line.'],
    [Split, 'Split', 'Carry sends a capped share to your pocket. Everything else stays Protected.'],
    [Smartphone, 'Phone holds only the pocket', 'The phone has no way to hold, send or see the rest.'],
  ];
  return (
    <section className="room paper" aria-labelledby="protects-h">
      <div className="inner">
        <h2 id="protects-h">How Carry protects you</h2>
        <ol className="steps">
          {steps.map(([I, head, body], i) => (
            <li key={head}><span className="step-ico"><Ico as={I} /></span><div><b className="step-head"><span className="mono">{i + 1}</span> {head}</b><p>{body}</p></div></li>
          ))}
        </ol>
      </div>
    </section>
  );
}
