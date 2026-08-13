/**
 * Card (Mobile M1-09) — the glass surface used across the phone. True blur is a
 * later polish (expo-blur); here the "glass" is a translucent raised surface
 * with a hairline edge, which reads as premium on the near-black background and
 * needs no extra native dependency.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, space } from '../theme/tokens';

export function Card({
  children,
  title,
  style,
}: {
  children: ReactNode;
  title?: string;
  style?: StyleProp<ViewStyle>;
}): JSX.Element {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.lg,
    gap: space.md,
  },
  title: {
    color: colors.muted,
    fontSize: font.small,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
