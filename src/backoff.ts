export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function computeBackoffMs(
  attempt: number,
  options?: {
    baseMs?: number;
    maxMs?: number;
    jitter?: number; // 0..1
  }
): number {
  const baseMs = options?.baseMs ?? 250;
  const maxMs = options?.maxMs ?? 10_000;
  const jitter = Math.max(0, Math.min(1, options?.jitter ?? 0.2));
  const exp = Math.min(attempt, 10);
  const raw = Math.min(maxMs, baseMs * Math.pow(2, exp));
  const delta = raw * jitter;
  const randomized = raw - delta + Math.random() * (2 * delta);
  return Math.max(0, Math.floor(randomized));
}

