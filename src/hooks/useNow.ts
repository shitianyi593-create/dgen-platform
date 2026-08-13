import { useEffect, useState } from 'react';

/**
 * Re-renders the calling component every `intervalMs` with the current
 * Date.now(). Used by elapsed-time displays (queue/run duration badges).
 *
 * Pass `intervalMs = 0` to disable the interval — the hook still returns
 * the current Date.now() snapshot but won't re-render. Use this for
 * components that conditionally need ticking (e.g. only when status is live).
 *
 * Mount this hook only in components that actually need a ticking display
 * — every active mount adds a setInterval. There is no batching across
 * components.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
