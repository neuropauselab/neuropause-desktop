/**
 * Pilot mode: the per-install early-access opt-in. Recording and badging only —
 * it does not change the update channel or unlock features.
 */
export interface PilotStatus {
  enabled: boolean;
  /** First time this install ever joined (preserved across leave/rejoin). */
  joinedAt: string | null;
  /** When the install last left (null while enabled). */
  leftAt: string | null;
}
