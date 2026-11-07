export const READINESS_PROBE_DELAYS_MS = [1_000, 2_000, 3_000, 5_000] as const;

export const READINESS_PROBE_MAX_TOTAL_MS = 3 * 60_000;

export function readinessProbeDelayMs(attempt: number): number {
  // A fractional attempt used to index the tuple directly (`delays[1.9]`),
  // which is `undefined`, and `setTimeout(undefined)` fires immediately.
  // Infinity means the schedule is already exhausted. Anything else that is
  // not a finite count starts over at the first delay.
  const last = READINESS_PROBE_DELAYS_MS.length - 1;
  const n = attempt === Infinity ? last : Number.isFinite(attempt) ? Math.trunc(attempt) : 0;
  const index = Math.min(Math.max(n, 0), last);
  return READINESS_PROBE_DELAYS_MS[index];
}

export function readinessProbeExhausted(startedAtMs: number, nowMs: number): boolean {
  return nowMs - startedAtMs >= READINESS_PROBE_MAX_TOTAL_MS;
}
