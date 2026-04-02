export const DEFAULT_CLICK_SUPPRESS_MS = 500;

export function markClickSuppressed(
  ref: { current: number },
  nowMs: number,
  durationMs: number = DEFAULT_CLICK_SUPPRESS_MS,
) {
  ref.current = nowMs + durationMs;
}

export function isClickSuppressed(ref: { current: number }, nowMs: number) {
  return nowMs < ref.current;
}

