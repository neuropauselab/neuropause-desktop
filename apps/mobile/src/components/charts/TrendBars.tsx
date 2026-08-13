/**
 * TrendBars (Mobile M1-09) — a compact SVG column chart for a short series (the
 * family's 6-month record-creation trend). Width is measured with onLayout, then
 * the pure barLayout() places the columns; month labels sit under each column.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { barLayout, type BarDatum } from './geometry';
import { colors, font, space } from '../../theme/tokens';

export function TrendBars({
  data,
  height = 120,
  color = colors.accent,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
}): JSX.Element {
  const [width, setWidth] = useState(0);
  const chartH = height - 20;
  const bars = width > 0 ? barLayout(data, { width, height: chartH, gap: 8 }) : [];
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={chartH}>
          {bars.map((b, i) => (
            <Rect
              key={`${b.label}-${i}`}
              x={b.x}
              y={b.y}
              width={b.width}
              height={Math.max(b.height, 2)}
              rx={3}
              fill={color}
              opacity={0.9}
            />
          ))}
        </Svg>
      ) : null}
      <View style={styles.labels}>
        {data.map((d, i) => (
          <Text
            key={`${d.label}-${i}`}
            style={[styles.label, { width: `${100 / Math.max(1, data.length)}%` }]}
            numberOfLines={1}
          >
            {d.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', marginTop: space.xs },
  label: { color: colors.faint, fontSize: font.tiny, textAlign: 'center' },
});
