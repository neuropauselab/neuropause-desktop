import { useAuth } from '@renderer/providers/AuthProvider';

/**
 * True when the app is running as a device-local principal (S17 local-first) —
 * no cloud account, cloud features legitimately absent. A cloud-backed surface
 * uses this to render HONEST ABSENCE instead of an error/spinner. Truth derived
 * from the auth state beneath (S19), never guessed.
 */
export function useIsLocalMode(): boolean {
  return useAuth().status.state === 'local';
}
