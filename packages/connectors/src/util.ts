/** Bound a promise with a timeout; clears the timer so no handle leaks. */
export function withTimeout<T>(work: Promise<T> | T, ms: number | undefined, label: string): Promise<T> {
  if (!ms) return Promise.resolve(work);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
