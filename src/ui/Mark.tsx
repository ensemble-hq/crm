import { type CSSProperties, useId } from 'react';
import './mark.css';

/**
 * The CRM's mark: a small domed head with two eyes and a star. It is the product's logo and the
 * sign for anything the model does, so it stands wherever a sparkle icon would.
 *
 * The head takes the colour of the text around it, so it is dark on a light page and light on a
 * dark one with nothing to switch; the eyes are cut out, so whatever is behind shows through. The
 * star keeps its purple in both. With `busy`, the eyes blink and stars come and go over the head
 * (left, middle, right): the sign that the model is working.
 */

/** A four-pointed star with drawn-in sides, centred on (x, y). */
function star(x: number, y: number, r: number): string {
  const k = r * 0.16;
  return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`;
}

const STARS = [
  { at: 'left', d: star(212, 186, 104) },
  { at: 'middle', d: star(512, 116, 92) },
  { at: 'right', d: star(812, 186, 108) },
] as const;

export type MarkProps = {
  size?: number | string;
  /** The model is working: blink, and let the stars come and go. */
  busy?: boolean;
  /** Come to life under the pointer, as it does when the model is working. */
  lively?: boolean;
  /** Leave the star out, for places too small to hold it. */
  plain?: boolean;
  /** Read out by a screen reader. Left out, the mark is decoration. */
  label?: string;
  style?: CSSProperties;
  className?: string;
  /** Accepted and ignored, so the mark can stand in wherever an icon from the icon set is expected. */
  strokeWidth?: number | string;
  'aria-hidden'?: boolean | 'true' | 'false';
};

export function Mark({ size = 16, busy = false, lively = false, plain = false, label, style, className }: MarkProps) {
  const id = useId();
  return (
    <svg className={className ? `crm-mark ${className}` : 'crm-mark'} data-busy={busy ? '' : undefined} data-lively={lively ? '' : undefined} width={size} height={size} viewBox="96 8 832 832" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={style}>
      <defs>
        <linearGradient id={`${id}-star`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8F5CFA" />
          <stop offset="1" stopColor="#6A3DF0" />
        </linearGradient>
        <mask id={`${id}-eyes`} maskUnits="userSpaceOnUse" x="96" y="240" width="832" height="560">
          <rect x="96" y="240" width="832" height="560" fill="#fff" />
          <rect className="crm-mark-eye" x="314" y="502" width="84" height="146" rx="42" fill="#000" />
          <rect className="crm-mark-eye" x="626" y="502" width="84" height="146" rx="42" fill="#000" />
        </mask>
      </defs>
      <path d="M128 672C128 440 300 258 512 258C724 258 896 440 896 672A96 96 0 0 1 800 768H224A96 96 0 0 1 128 672Z" fill="currentColor" mask={`url(#${id}-eyes)`} />
      {plain ? null : STARS.map((item) => <path key={item.at} className="crm-mark-star" data-at={item.at} d={item.d} fill={`url(#${id}-star)`} />)}
    </svg>
  );
}
