// Home's connection states: a transient problem, and "this browser's key is not the registered one".
import React, { useState } from 'react';

export const FORGET_WARNING = "Forget this browser's key?\n\nThis locks this device out of Home until `npm run reset-home-key` is run on the server and you set Home up again with a new code. Your money stays safe either way.\n\nOnly do this if you are sure this is not a temporary problem.";

// "Forget" is destructive for this device, so it only runs after an explicit yes.
export async function forgetWithConfirm({ confirmFn, clearKey, after }) {
  if (!confirmFn(FORGET_WARNING)) return false;
  await clearKey();
  await after?.();
  return true;
}

// Shown while home requests are failing for a reason that is not "this key is not recognised": the page keeps retrying by itself.
export function HomeLinkBanner({ problem }) {
  return problem ? <div className="banner" role="status">Couldn't reach your home controls, retrying…</div> : null;
}

// Shown only after the server itself said this key is not the registered one. "Forget" is never the first thing offered.
export function Unrecognised({ onRetry, onForget }) {
  const [more, setMore] = useState(false);
  return (
    <>
      <div className="refusal-slab" role="alert"><b className="refusal-head">Blocked</b><p>The server says this browser's key is not the one set up for Home.</p></div>
      <p><button className="action" onClick={onRetry}>Try again</button></p>
      {!more && <p><a href="#more-options" onClick={(e) => { e.preventDefault(); setMore(true); }}>More options</a></p>}
      {more && (
        <div className="stack" id="more-options">
          <p className="muted">If you are sure this is the wrong device, you can forget this browser's key. That locks this device out until <code className="mono">npm run reset-home-key</code> runs on the server.</p>
          <p><button className="ghost" onClick={onForget}>Forget this browser's key</button></p>
        </div>
      )}
    </>
  );
}
