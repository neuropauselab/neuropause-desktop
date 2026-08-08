/**
 * KpiTile (Mobile M1-09) — one executive KPI from the desktop's real snapshot.
 * A band dot carries the health colour; the display string is shown verbatim
 * (the desktop already formats it), and a trend chevron is added when present.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { CompanionKpi } from '@neuropause/shared';
import { bandColor } from '../state/dashboardModel';
import { colors, font, radius, space } from '../theme/tokens';

const TREND: Record<NonNullable<CompanionKpi['trend']>, string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

export function KpiTile({ kpi }: { kpi: CompanionKpi }): JSX.Element {
  const tone = bandColor(kpi.band);
  return (
    <View style={styles.tile}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={styles.label} numberOfLines={1}>
          {kpi.label}
        </Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1}>
          {kpi.display}
        </Text>
        {kpi.trend ? <Text style={[styles.trend, { color: tone }]}>{TREND[kpi.trend]}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 150,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: space.md,
    gap: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: colors.muted, fontSize: font.small, flex: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  value: { color: colors.ink, fontSize: font.h2, fontWeight: '700', flexShrink: 1 },
  trend: { fontSize: font.small },
});
