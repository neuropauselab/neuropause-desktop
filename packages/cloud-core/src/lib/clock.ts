/**
 * Injectable clock. Logic takes a Clock so behavior is deterministic under test
 * (ManualClock) and audit ids never depend on wall-clock nondeterminism.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: (): number => Date.now(),
};

export class ManualClock implements Clock {
  private t: number;
  constructor(start = 0) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}
