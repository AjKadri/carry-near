// What the page has WATCHED change, so motion can explain it. Nothing here moves money or reads anything extra.
import { useEffect, useRef, useState } from 'react';

export const SLOTS = 10;

// pocket going up = money arrived and the pocket took its share: returns the share and fresh tiles to pop.
export function usePocketMotion(pocketMicro, ceilingMicro) {
  const last = useRef(null);
  const [split, setSplit] = useState({ share: null, play: 0 });
  const [tiles, setTiles] = useState({ filled: 0, from: 0, play: 0 });
  useEffect(() => {
    if (pocketMicro == null) return;
    const pocket = Number(pocketMicro), ceiling = Number(ceilingMicro) || 1;
    const filled = Math.min(SLOTS, Math.round((pocket / ceiling) * SLOTS));
    const prev = last.current;
    last.current = pocket;
    if (prev !== null && pocket > prev) {
      const before = Math.min(SLOTS, Math.round((prev / ceiling) * SLOTS));
      setSplit((o) => ({ share: pocket - prev, play: o.play + 1 }));
      setTiles((o) => ({ filled, from: before, play: o.play + 1 }));
    } else setTiles((o) => (o.filled === filled ? o : { filled, from: filled, play: o.play }));
  }, [pocketMicro, ceilingMicro]);
  return [split, tiles];
}

// ids of bills the page saw go from unpaid to paid (they flip); a bill already paid at load just shows Paid.
export function useFlipIds(bills) {
  const was = useRef(null);
  const [ids, setIds] = useState(() => new Set());
  useEffect(() => {
    if (!bills) return;
    const now = new Map(bills.map((b) => [b.id, b.used]));
    if (was.current) { const fresh = bills.filter((b) => b.used && was.current.get(b.id) === false).map((b) => b.id); if (fresh.length) setIds((o) => new Set([...o, ...fresh])); }
    was.current = now;
  }, [bills]);
  return ids;
}
