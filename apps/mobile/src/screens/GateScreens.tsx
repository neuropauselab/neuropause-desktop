/**
 * Gate screens (Mobile M1-09) — the non-tab UI shown before the app is ready:
 * a boot splash, the biometric lock, and a boot-error retry. Each reads the
 * companion context; none of them touch enterprise data.
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useCompanion } from '../state/CompanionProvider';
import { Brand, Centered, PrimaryButton } from '../components/ui';
import { colors, font, space } from '../theme/tokens';

export function Splash(): JSX.Element {
  return (
    <Centered>
      <Brand subtitle="Your enterprise, in your pocket." />
      <ActivityIndicator color={colors.accent} />
    </Centered>
  );
}

export function LockScreen(): JSX.Element {
  const { unlock } = useCompanion();
  // Prompt Face ID / Touch ID as soon as the lock appears.
  useEffect(() => {
    void unlock();
  }, [unlock]);
  return (
    <Centered>
      <Brand subtitle="Locked" />
      <Text style={styles.hint}>Unlock with Face ID to view your enterprise.</Text>
      <PrimaryButton label="Unlock" onPress={() => void unlock()} />
    </Centered>
  );
}

export function ErrorScreen(): JSX.Element {
  const { error, retry } = useCompanion();
  return (
    <Centered>
      <Brand subtitle="Something went wrong" />
      <Text style={styles.error}>{error ?? 'The app could not start.'}</Text>
      <PrimaryButton label="Try again" onPress={retry} />
    </Centered>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: font.body, textAlign: 'center' },
  error: { color: colors.danger, fontSize: font.body, textAlign: 'center', marginBottom: space.sm },
});
