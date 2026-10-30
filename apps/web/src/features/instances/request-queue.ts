/** Reserve browser connections for navigation and foreground actions. */
export function requestQueue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const drain = () => {
    while (active < limit && waiting.length) waiting.shift()?.();
  };
  return <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      const aborted = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const start = () => {
        signal?.removeEventListener('abort', aborted);
        active += 1;
        Promise.resolve()
          .then(() => {
            signal?.throwIfAborted();
            return work();
          })
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            drain();
          });
      };
      if (signal?.aborted) return aborted();
      signal?.addEventListener('abort', aborted, { once: true });
      waiting.push(start);
      drain();
    });
}

export const loadUsage = requestQueue(2);
