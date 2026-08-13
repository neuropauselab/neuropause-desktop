/**
 * A one-line notification that the experience profile changed underneath the shell.
 *
 * `AppShell` reads the profile once at mount to decide whether the first-run
 * takeover shows. That is correct for the normal path — first run happens
 * before anything else — but it means a profile RESET from deep inside the app
 * would not take effect until the next launch, which reads as the button
 * having done nothing.
 *
 * A window event rather than another provider: exactly one producer, exactly
 * one consumer, no state to hold. Wrapping that in context would be more
 * machinery than the problem has.
 */
export const EXPERIENCE_PROFILE_CHANGED = 'neuropause:experience-profile-changed';

/** Subscribe; returns the unsubscriber. */
export function onExperienceProfileChanged(handler: () => void): () => void {
  window.addEventListener(EXPERIENCE_PROFILE_CHANGED, handler);
  return () => window.removeEventListener(EXPERIENCE_PROFILE_CHANGED, handler);
}
