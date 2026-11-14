import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { Trend } from '../mock/dashboard';
import { ICON } from './styles';

/** A change against the comparison period. Colour follows whether the change is good, not its direction. */
export function TrendValue({ trend }: { trend: Trend }) {
  const Arrow = trend.direction === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className="m-cluster"
      data-gap="0"
      style={{
        fontSize: 'var(--m-font-size-sm)',
        color: trend.good ? 'var(--m-color-success-fg)' : 'var(--m-color-danger-fg)',
      }}
    >
      <Arrow size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
      {trend.value}
    </span>
  );
}

/** Small bar series for a KPI tile. The last `recent` bars are the current week and drawn lighter. */
export function SparkBars({ series, recent = 5 }: { series: number[]; recent?: number }) {
  const max = Math.max(...series, 1);
  const height = 24;
  return (
    <svg viewBox={`0 0 ${series.length * 6 - 2} ${height}`} width={series.length * 6 - 2} height={height} aria-hidden style={{ display: 'block' }}>
      {series.map((value, index) => {
        const barHeight = Math.max(2, Math.round((value / max) * (height - 2)));
        const isRecent = index >= series.length - recent;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed series, never reordered
            key={index}
            x={index * 6}
            y={height - barHeight}
            width={4}
            height={barHeight}
            rx={1}
            style={{ fill: isRecent ? 'var(--m-color-info-border)' : 'var(--m-color-info-solid)' }}
          />
        );
      })}
    </svg>
  );
}

function linePath(series: number[], max: number, width: number, height: number): string {
  const step = width / Math.max(series.length - 1, 1);
  return series
    .map((value, index) => {
      const x = (index * step).toFixed(1);
      const y = (height - (value / max) * (height - 16) - 4).toFixed(1);
      return `${index === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

/** Area chart of the current period over a dashed comparison line. */
export function AreaChart({ current, previous, label }: { current: number[]; previous: number[]; label: string }) {
  const width = 600;
  const height = 160;
  const max = Math.max(...current, ...previous, 1);
  const currentLine = linePath(current, max, width, height);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" preserveAspectRatio="none" role="img" aria-label={label} style={{ display: 'block', blockSize: 176 }}>
      <path d={`M0,40H${width}M0,80H${width}M0,120H${width}`} strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--m-color-border-muted)' }} />
      <path d={linePath(previous, max, width, height)} fill="none" strokeWidth={2} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--m-color-info-solid)' }} />
      <path d={`${currentLine} L${width},${height} L0,${height} Z`} style={{ fill: 'var(--m-color-info-bg)', opacity: 0.6 }} />
      <path d={currentLine} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--m-color-info-border)' }} />
    </svg>
  );
}

/** One horizontal bar, as a share of the largest value in its group. */
export function Bar({ share }: { share: number }) {
  return (
    <span
      aria-hidden
      style={{
        flex: `0 0 ${Math.max(4, Math.round(share * 70))}%`,
        blockSize: 8,
        borderRadius: 'var(--m-radius-full)',
        background: 'var(--m-color-info-border)',
      }}
    />
  );
}
