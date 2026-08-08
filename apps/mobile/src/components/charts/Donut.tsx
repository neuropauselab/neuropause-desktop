/**
 * Donut (Mobile M1-09) — an SVG ring chart over the pure donutArcs() geometry,
 * with a legend. A single 100%-slice (and the empty case) is drawn as a full
 * ring so the degenerate arc never shows a seam.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { donutArcs, type DonutSlice } from './geometry';
import { colors, font, space } from '../../theme/tokens';

export function Donut({
  slices,
  size = 156,
  thickness = 22,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
}): JSX.Element {
  const r = size / 2;
  const arcs = donutArcs(slices, { radius: r, thickness });
  const palette = colors.categorical;
  const single = arcs.length === 1 && arcs[0].fraction > 0.999;
  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        {arcs.length === 0 || single ? (
          <Circle
            cx={r}
            cy={r}
            r={r - thickness / 2}
            stroke={arcs.length === 0 ? colors.hairline : palette[0]}
            strokeWidth={thickness}
            fill="none"
          />
        ) : (
          arcs.map((a, i) => <Path key={a.name} d={a.path} fill={palette[i % palette.length]} />)
        )}
      </Svg>
      <View style={styles.legend}>
        {arcs.map((a, i) => (
          <View key={a.name} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: palette[i % palette.length] }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {a.name}
            </Text>
            <Text style={styles.legendValue}>{Math.round(a.fraction * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  legend: { flex: 1, gap: space.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { color: colors.ink, fontSize: font.small, flex: 1 },
  legendValue: { color: colors.muted, fontSize: font.small },
});
