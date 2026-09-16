/**
 * S120 — a NON-FROZEN, single reference to the ONE live platform event source's tenant-scoped
 * `replay`. It is NOT a second event bus: it holds a handle to the existing `PlatformEventApi`
 * (which wraps the single `EventBus`), set once by the platform composition root at init. The
 * governed connector-lineage read (`buildInboundLineage`) reads through this handle so it never
 * imports the composition or stands up its own bus. Null until platform init runs ⇒ reads return
 * an honest empty lineage (fail-closed), never an error.
 */
import type { PlatformEvent } from '@neuropause/shared';

export interface PlatformReplaySource {
  replay(filter?: { types?: readonly string[]; limit?: number }): PlatformEvent[];
}

export const platformBusRef: { current: PlatformReplaySource | null } = { current: null };
