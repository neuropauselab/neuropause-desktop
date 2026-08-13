/**
 * Small shared UI atoms (Mobile M1-09) — the brand wordmark, a primary button,
 * and a centred full-screen container used by the gate screens.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme/tokens';

export function Centered({ children }: { children: ReactNode }): JSX.Element {
  return <View style={styles.centered}>{children}</View>;
}

export function Brand({ subtitle }: { subtitle?: string }): JSX.Element {
  return (
    <View style={styles.brandWrap}>
      <Text style={styles.brand}>NeuroPause</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  busy,
  variant = 'solid',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'solid' | 'ghost';
}): JSX.Element {
  const ghost = variant === 'ghost';
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        ghost ? styles.ghost : styles.solid,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ghost ? colors.ink : '#fff'} />
      ) : (
        <Text style={[styles.buttonLabel, ghost && styles.ghostLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
    gap: space.lg,
  },
  brandWrap: { alignItems: 'center', gap: space.xs },
  brand: { color: colors.ink, fontSize: font.h1, fontWeight: '800', letterSpacing: 0.4 },
  subtitle: { color: colors.muted, fontSize: font.body, textAlign: 'center' },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  solid: { backgroundColor: colors.accent },
  ghost: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  pressed: { opacity: 0.7 },
  buttonLabel: { color: '#fff', fontSize: font.body, fontWeight: '700' },
  ghostLabel: { color: colors.ink },
});
