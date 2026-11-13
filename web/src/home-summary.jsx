// HOME ONLY. This file must never be imported by anything the phone loads: it shows the reserve ("Protected") amount.
// test/phone-privacy.test.js bundles the phone view and fails if this text or file reaches it.
import React from 'react';
import { Ico, Lock } from './icons.jsx';
import { usdc } from './parts.jsx';

export const atRisk = (st) => Number(st.pocket) + Number(st.allowance); // the pocket's balance plus the refills still authorised

export function HomeSummary({ st, children }) {
  return (
    <section className="room teal">
      <div className="inner">
        <p className="label">Home</p>
        {st?.reserve === undefined ? <h1 className="summary">Reading your balances…</h1> : <>
          <h1 className="summary" data-summary>If your phone is lost tonight, at most <span className="risk mono">{usdc(atRisk(st))} USDC</span> is at risk.</h1>
          <p className="lede">That is the <b className="mono">{usdc(st.pocket)}</b> in your pocket plus the <b className="mono">{usdc(st.allowance)}</b> of refills you have still authorised.</p>
          <p className="protected-line" data-protected-line><Ico as={Lock} /> Protected: <b className="mono">{usdc(st.reserve)} USDC</b> · hidden from your phone</p>
        </>}
        {children}
      </div>
    </section>
  );
}
