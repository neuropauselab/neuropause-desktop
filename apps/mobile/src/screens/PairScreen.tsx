/**
 * PairScreen (Mobile M1-09) — the QR pairing gate. Scans the `npc1.` code shown
 * in the desktop's Settings → Companion, then calls into the provider's pair()
 * (which pins the desktop key and stores the sealed session). A scan is handled
 * once; on failure the error is shown and scanning re-arms.
 */
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCompanion } from '../state/CompanionProvider';
import { Brand, Centered, PrimaryButton } from '../components/ui';
import { colors, font, radius, space } from '../theme/tokens';

export function PairScreen(): JSX.Element {
  const { pair } = useCompanion();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const onScan = async (data: string) => {
    if (handled.current || busy) return;
    handled.current = true;
    setBusy(true);
    setError(null);
    try {
      await pair(data);
      // On success the provider flips the phase → this screen unmounts.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pairing failed. Try again.');
      handled.current = false;
      setBusy(false);
    }
  };

  if (!permission) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }

  if (!permission.granted) {
    return (
      <Centered>
        <Brand subtitle="Pair with your desktop" />
        <Text style={styles.body}>
          NeuroPause scans the pairing code shown in your desktop app under Settings → Companion.
          The camera is used only for that scan.
        </Text>
        <PrimaryButton label="Enable camera" onPress={() => void requestPermission()} />
      </Centered>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : (r) => void onScan(r.data)}
      />
      <View style={styles.overlay} pointerEvents="none">
        <Text style={styles.title}>Scan the pairing code</Text>
        <View style={styles.frame} />
        <Text style={styles.hint}>Settings → Companion on your desktop</Text>
        {busy ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  body: { color: colors.muted, fontSize: font.body, textAlign: 'center', lineHeight: 22 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
  },
  title: { color: '#fff', fontSize: font.h2, fontWeight: '700' },
  frame: {
    width: 240,
    height: 240,
    borderRadius: radius.lg,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'transparent',
  },
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: font.small },
  spinner: { marginTop: space.md },
  error: {
    color: '#fff',
    backgroundColor: colors.danger,
    fontSize: font.small,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
});
