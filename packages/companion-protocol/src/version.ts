/**
 * Companion protocol versioning (M1-02). One integer, negotiated at pairing
 * (the QR carries it) and asserted on every request; mismatches refuse with a
 * typed code so old apps fail with an upgrade message, never with corruption.
 */
import { CompanionProtocolError } from './errors';

export const COMPANION_PROTOCOL_VERSION = 1;

/** HKDF domain-separation label — changing the protocol version changes keys. */
export const COMPANION_KDF_INFO = `neuropause-companion-v${COMPANION_PROTOCOL_VERSION}`;

export function assertProtocolVersion(v: number): void {
  if (v !== COMPANION_PROTOCOL_VERSION) {
    throw new CompanionProtocolError(
      'version-mismatch',
      `Companion protocol v${v} is not supported (this build speaks v${COMPANION_PROTOCOL_VERSION}).`,
    );
  }
}
