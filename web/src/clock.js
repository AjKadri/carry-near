// The browser's idea of server time: server time minus browser time, in ms. Shared by the plain fetch helper (api.js, used by the phone too)
// and the home signer (homeKey.js). It holds one number and nothing else, so importing it brings no signing code into the phone.
export const clock = { offset: 0 };
// From a response's Date header (1 s resolution).
export const syncClock = (res, now = () => Date.now(), c = clock) => { const d = Date.parse(res.headers.get('date') ?? ''); if (Number.isFinite(d)) c.offset = d - now(); };
