/**
 * Biometric gate (Mobile M1-08). Face ID / Touch ID unlock before the app
 * reveals enterprise data. If the device has no biometrics enrolled we do NOT
 * lock the user out (returning true) — the sealed session is still required for
 * any data, so this is a convenience lock, not the security boundary.
 */
import * as LocalAuthentication from 'expo-local-authentication';

export async function biometricsAvailable(): Promise<boolean> {
  const [hasHardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && enrolled;
}

export async function requireUnlock(): Promise<boolean> {
  if (!(await biometricsAvailable())) return true;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock NeuroPause',
    fallbackLabel: 'Use passcode',
  });
  return result.success;
}
