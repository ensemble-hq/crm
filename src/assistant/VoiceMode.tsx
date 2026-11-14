import { MessageSquareText, Mic, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ICON, small } from '../ui/styles';
import type { Assistant } from './useAssistant';

/**
 * Voice mode, as a scripted mock: there is no speech recognition, so "your" lines are sample
 * sentences that play when you press the microphone. The assistant's side is real: it runs the same
 * requests as the typed conversation, and can read its answer aloud with the browser's own voice.
 */

type VoiceState = 'idle' | 'hearing' | 'thinking' | 'speaking';

const SAMPLE_LINES = ['How is the pipeline looking?', 'Which big deals have gone quiet?', 'Go ahead and run the plan.', 'Who has closed the most this year?'];

const STATE_WORDS: Record<VoiceState, string> = {
  idle: 'Listening',
  hearing: 'Hearing you',
  thinking: 'Thinking',
  speaking: 'Answering',
};

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How loud each state is at time `t` (seconds), 0 to 1. Stands in for a real audio level. */
function level(state: VoiceState, t: number): number {
  switch (state) {
    case 'hearing':
      return 0.45 + 0.3 * Math.abs(Math.sin(t * 9)) * Math.abs(Math.sin(t * 2.3 + 1));
    case 'speaking':
      return 0.5 + 0.35 * Math.abs(Math.sin(t * 6.5)) * (0.6 + 0.4 * Math.sin(t * 1.7));
    case 'thinking':
      return 0.25 + 0.05 * Math.sin(t * 3);
    default:
      return 0.14 + 0.05 * Math.sin(t * 1.4);
  }
}

/** The assistant's presence: a core and three rings that move with whoever is talking. */
function Blob({ state, size = 180 }: { state: VoiceState; size?: number }) {
  const rings = useRef<Array<SVGCircleElement | null>>([]);
  const core = useRef<SVGCircleElement>(null);
  const arc = useRef<SVGCircleElement>(null);
  const current = useRef(state);
  current.current = state;

  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const started = performance.now();
    const draw = (now: number) => {
      const t = (now - started) / 1000;
      const loud = level(current.current, t);
      core.current?.setAttribute('r', String(26 + loud * 14));
      rings.current.forEach((ring, index) => {
        // Each ring trails the one inside it, so sound seems to travel outward.
        const trailing = level(current.current, t - (index + 1) * 0.12);
        ring?.setAttribute('r', String(44 + index * 16 + trailing * (10 + index * 6)));
        ring?.setAttribute('opacity', String(Math.max(0.12, 0.7 - index * 0.2) * (0.5 + trailing)));
      });
      if (arc.current) {
        arc.current.setAttribute('opacity', current.current === 'thinking' ? '1' : '0');
        arc.current.setAttribute('transform', `rotate(${(t * 220) % 360} 100 100)`);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label={STATE_WORDS[state]} style={{ display: 'block', color: 'var(--m-color-fg-default)' }}>
      {[0, 1, 2].map((index) => (
        <circle
          key={index}
          ref={(element) => {
            rings.current[index] = element;
          }}
          cx="100"
          cy="100"
          r={46 + index * 16}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity={0.5 - index * 0.14}
        />
      ))}
      <circle ref={arc} cx="100" cy="100" r="38" fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray="60 180" opacity="0" style={{ stroke: 'var(--m-color-info-border)' }} />
      <circle ref={core} cx="100" cy="100" r="28" fill="currentColor" />
    </svg>
  );
}

/** The person's voice as a row of bars, moving only while they speak. */
function Bars({ active }: { active: boolean }) {
  const [heights, setHeights] = useState<number[]>(() => Array.from({ length: 14 }, () => 3));

  useEffect(() => {
    if (!active || reducedMotion()) {
      setHeights(Array.from({ length: 14 }, () => 3));
      return;
    }
    const timer = setInterval(() => setHeights(Array.from({ length: 14 }, () => 3 + Math.round(Math.random() * 15))), 90);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <span aria-hidden className="m-cluster" style={{ gap: 2, flexWrap: 'nowrap', blockSize: 20, alignItems: 'center' }}>
      {heights.map((height, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of bars
        <span key={index} style={{ inlineSize: 2, blockSize: height, borderRadius: 'var(--m-radius-full)', background: 'currentColor', opacity: active ? 0.9 : 0.35 }} />
      ))}
    </span>
  );
}

export function VoiceMode({ assistant, onLeave }: { assistant: Assistant; onLeave: () => void }) {
  const [line, setLine] = useState(0);
  const [heard, setHeard] = useState('');
  const [hearing, setHearing] = useState(false);
  const [aloud, setAloud] = useState(false);
  const [reading, setReading] = useState(false);
  const spoken = useRef<string>();

  const lastUser = [...assistant.messages].reverse().find((message) => message.role === 'user');
  const lastAnswer = assistant.messages[assistant.messages.length - 1]?.role === 'assistant' ? assistant.messages[assistant.messages.length - 1] : undefined;

  const state: VoiceState = hearing ? 'hearing' : assistant.working ? (lastAnswer?.text ? 'speaking' : 'thinking') : reading ? 'speaking' : 'idle';
  const doing = state === 'thinking' && assistant.activity ? assistant.activity : STATE_WORDS[state];
  const nextLine = SAMPLE_LINES[line % SAMPLE_LINES.length] ?? '';

  // Read each finished answer aloud, once, when that is switched on.
  useEffect(() => {
    if (!aloud || assistant.working || !lastAnswer?.text || spoken.current === lastAnswer.id || !('speechSynthesis' in window)) return;
    spoken.current = lastAnswer.id;
    const utterance = new SpeechSynthesisUtterance(lastAnswer.text);
    utterance.onend = () => setReading(false);
    utterance.onerror = () => setReading(false);
    setReading(true);
    window.speechSynthesis.speak(utterance);
  }, [aloud, assistant.working, lastAnswer?.id, lastAnswer?.text]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function speak() {
    if (hearing || assistant.working) return;
    window.speechSynthesis?.cancel();
    setReading(false);
    const words = nextLine.split(' ');
    setHearing(true);
    setHeard('');
    words.forEach((_, index) => {
      setTimeout(() => setHeard(words.slice(0, index + 1).join(' ')), 220 * (index + 1));
    });
    setTimeout(
      () => {
        setHearing(false);
        setHeard('');
        setLine((value) => value + 1);
        assistant.send(nextLine);
      },
      220 * words.length + 450,
    );
  }

  const youSaid = hearing ? heard : (lastUser?.text ?? '');
  const itSaid = hearing ? '' : (lastAnswer?.text ?? '');

  return (
    <div className="m-stack" data-gap="0" style={{ blockSize: '100%', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--m-space-6) var(--m-space-5)' }}>
      <div className="m-cluster" data-justify="between" style={{ inlineSize: '100%' }}>
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={onLeave}>
          <MessageSquareText size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Show the conversation
        </button>
        <label className="m-field" data-layout="inline" style={small}>
          <input className="m-switch" type="checkbox" role="switch" checked={aloud} onChange={(event) => setAloud(event.target.checked)} />
          Read answers aloud
        </label>
      </div>

      <div className="m-stack" data-gap="4" style={{ alignItems: 'center', textAlign: 'center', maxInlineSize: 560 }}>
        <Blob state={state} />
        <p role="status" style={{ ...small, margin: 0, minBlockSize: '1.4em' }}>
          {doing}
        </p>
        <div className="m-stack" data-gap="2" aria-live="polite" style={{ minBlockSize: 132, alignItems: 'center' }}>
          {itSaid ? (
            <p style={{ margin: 0, fontSize: 'var(--m-font-size-lg)', lineHeight: 'var(--m-font-leading-normal)', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{itSaid}</p>
          ) : null}
          {youSaid ? (
            <p style={{ margin: 0, color: 'var(--m-color-fg-muted)' }}>
              <span style={{ color: 'var(--m-color-fg-subtle)' }}>You · </span>
              {youSaid}
            </p>
          ) : null}
          {!youSaid && !itSaid ? <p style={{ margin: 0, color: 'var(--m-color-fg-muted)' }}>Press the microphone and ask about your pipeline, your deals or your team.</p> : null}
        </div>
      </div>

      <div className="m-stack" data-gap="2" style={{ alignItems: 'center' }}>
        <div
          className="m-cluster"
          data-gap="3"
          style={{
            flexWrap: 'nowrap',
            padding: 'var(--m-space-2) var(--m-space-3)',
            borderRadius: 'var(--m-radius-full)',
            background: 'var(--m-color-bg-surface)',
            boxShadow: 'var(--m-shadow-md)',
          }}
        >
          <button type="button" className="m-button" data-variant="primary" data-icon-only aria-label={`Say: ${nextLine}`} aria-pressed={hearing} disabled={hearing || assistant.working} onClick={speak} style={{ borderRadius: 'var(--m-radius-full)' }}>
            <Mic size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden />
          </button>
          <Bars active={hearing} />
          <button type="button" className="m-button" data-size="sm" onClick={onLeave}>
            <X size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Leave voice
          </button>
        </div>
        <p style={{ ...small, margin: 0, textAlign: 'center' }}>
          Mock: the microphone plays a sample line. Next: “{nextLine}”
        </p>
      </div>
    </div>
  );
}
