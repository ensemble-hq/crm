import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { ICON } from './styles';

export type Trend = { direction: 'up' | 'down'; value: string; good: boolean };

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
