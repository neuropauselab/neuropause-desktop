/**
 * RankBars (Mobile M1-09) — a ranked horizontal bar list built from flexbox (no
 * SVG, no width measurement), which reads far better than vertical bars on a
 * narrow phone. Rows are optionally tappable so the Dashboard can drill into a
 * family.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BarDatum } from './geometry';
import { colors, font, radius, space } from '../../theme/tokens';

export function RankBars({
  data,
  color = colors.accent,
  max,
  onSelect,
}: {
  data: BarDatum[];
  color?: string;
  max?: number;
  onSelect?: (datum: BarDatum, index: number) => void;
}): JSX.Element {
  const ceiling = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={styles.list}>
      {data.map((d, i) => {
        const pct = `${Math.max(2, (d.value / ceiling) * 100)}%` as const;
        const row = (
          <View style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>
              {d.label}
            </Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: pct, backgroundColor: color }]} />
            </View>
            <Text style={styles.value}>{d.value}</Text>
          </View>
        );
        return onSelect ? (
          <Pressable
            key={`${d.label}-${i}`}
            onPress={() => onSelect(d, i)}
            android_ripple={{ color: colors.hairline }}
            style={({ pressed }) => (pressed ? styles.pressed : undefined)}
          >
            {row}
          </Pressable>
        ) : (
          <View key={`${d.label}-${i}`}>{row}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  label: { color: colors.ink, fontSize: font.small, width: 92 },
  track: {
    flex: 1,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
  value: { color: colors.muted, fontSize: font.small, width: 48, textAlign: 'right' },
  pressed: { opacity: 0.6 },
});
