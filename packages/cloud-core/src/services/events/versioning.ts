/**
 * Event versioning — payload schema evolution via chained upcasters.
 * An event carries a `version`; consumers read at the current version. The
 * registry transforms an older payload up one version at a time to the target,
 * so old persisted events remain replayable after the schema moves on.
 */
export type Upcaster = (payload: unknown, fromVersion: number) => unknown;

export class EventUpcasterRegistry {
  /** type -> (fromVersion -> upcaster producing version fromVersion+1). */
  private readonly map = new Map<string, Map<number, Upcaster>>();

  register(type: string, fromVersion: number, upcaster: Upcaster): this {
    const byVersion = this.map.get(type) ?? new Map<number, Upcaster>();
    byVersion.set(fromVersion, upcaster);
    this.map.set(type, byVersion);
    return this;
  }

  /** Upcast a payload from `fromVersion` up to `toVersion` (best effort). */
  upcast(type: string, payload: unknown, fromVersion: number, toVersion: number): unknown {
    let current = payload;
    let version = fromVersion;
    const byVersion = this.map.get(type);
    while (version < toVersion) {
      const step = byVersion?.get(version);
      if (!step) break;
      current = step(current, version);
      version += 1;
    }
    return current;
  }
}
