import type { ExpoConfig } from 'expo/config';

/**
 * NeuroPause Mobile — Expo app config (Mobile M1-08). Dark UI, expo-router,
 * and the three native capabilities the companion needs: the secure keychain
 * (device identity key), the camera (pairing QR), and local biometrics (Face
 * ID / Touch ID gate).
 */
const config: ExpoConfig = {
  name: 'NeuroPause',
  slug: 'neuropause-companion',
  scheme: 'neuropause',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0a0a0f',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.neuropause.companion',
  },
  android: {
    package: 'com.neuropause.companion',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission:
          'NeuroPause uses the camera to scan the pairing code shown on your desktop.',
      },
    ],
    [
      'expo-local-authentication',
      { faceIDPermission: 'NeuroPause uses Face ID to unlock your companion.' },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;
