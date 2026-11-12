import { useCallback, useEffect, useState } from 'react';
import { syncClock } from './homeKey.js';

export const plain = async (path, init = {}) => {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  syncClock(r);
  return { status: r.status, body: await r.json().catch(() => null) };
};

export function usePoll(fetcher, deps, ms = 2000) {
  const [data, setData] = useState(null);
  const load = useCallback(() => fetcher().then(setData).catch(() => {}), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return [data, load];
}
