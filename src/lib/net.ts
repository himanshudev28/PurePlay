/**
 * Compose a caller's abort signal with a hard timeout.
 *
 * None of the catalog APIs are load-bearing enough to wait forever on — a
 * mirror that accepts the connection and then hangs must fail like one that
 * refused, or it silently eats a fetch slot (and, for JioSaavn, one of the two
 * concurrency-semaphore slots) for the life of the tab.
 */
export function withTimeout(signal?: AbortSignal | null, ms = 10_000): AbortSignal | undefined {
  // Older browsers (Safari < 17.4 for `any`, < 16 for `timeout`) miss these —
  // degrade to "no timeout" there rather than throwing on every fetch.
  if (typeof AbortSignal.timeout !== 'function') return signal ?? undefined
  const timeout = AbortSignal.timeout(ms)
  if (!signal) return timeout
  if (typeof AbortSignal.any !== 'function') return signal
  return AbortSignal.any([signal, timeout])
}
