import type { ReactNode } from 'react';

export type PebbleMood = 'happy' | 'waving' | 'thinking' | 'worried' | 'sleepy' | 'celebrating';

const INK = '#3A4A3A';
const SAGE = '#A8BFA0';
const SAGE_DARK = '#7F9B7B';
const CREAM = '#FBF8F1';
const PINK = '#F2C2C0';
const BLUSH = '#E8A898';

/** An arm drawn as a thick outlined stroke. */
function Arm({ d, className }: { d: string; className?: string }) {
  return (
    <g className={className}>
      <path d={d} stroke={INK} strokeWidth={19} strokeLinecap="round" fill="none" />
      <path d={d} stroke={SAGE} strokeWidth={12} strokeLinecap="round" fill="none" />
    </g>
  );
}

function Heart({ x, y, s = 1, fill = BLUSH }: { x: number; y: number; s?: number; fill?: string }) {
  return (
    <path
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 3 C-1.5 -1 -7 -1 -7 3.5 C-7 7 -2.5 9.5 0 12 C2.5 9.5 7 7 7 3.5 C7 -1 1.5 -1 0 3 Z"
      fill={fill}
      stroke={INK}
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
  );
}

function Mug({ x, y, steam }: { x: number; y: number; steam: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {steam && (
        <g className="pebble-steam" stroke={SAGE_DARK} strokeWidth={2.5} strokeLinecap="round" fill="none" opacity={0.75}>
          <path d="M9 -6 q-5 -6 0 -12 q5 -6 0 -12" />
          <path d="M21 -4 q-5 -6 0 -12 q5 -6 0 -12" />
        </g>
      )}
      <path d="M30 6 h6 a8 8 0 0 1 0 16 h-6" fill="none" stroke={INK} strokeWidth={4} />
      <rect x={0} y={0} width={32} height={30} rx={6} fill={PINK} stroke={INK} strokeWidth={4} />
      <rect x={0} y={0} width={32} height={6} rx={3} fill="#C98E80" stroke={INK} strokeWidth={3} />
      <Heart x={16} y={11} s={0.85} />
    </g>
  );
}

function Face({ mood }: { mood: PebbleMood }) {
  const eyes: Record<PebbleMood, ReactNode> = {
    happy: (
      <>
        <path d="M74 98 Q82 89 90 98" />
        <path d="M110 98 Q118 89 126 98" />
      </>
    ),
    waving: (
      <>
        <path d="M74 98 Q82 89 90 98" />
        <path d="M110 98 Q118 89 126 98" />
      </>
    ),
    celebrating: (
      <>
        <path d="M73 98 Q82 87 91 98" />
        <path d="M109 98 Q118 87 127 98" />
      </>
    ),
    thinking: (
      <>
        <circle cx={83} cy={95} r={4} fill={INK} stroke="none" />
        <circle cx={119} cy={93} r={4} fill={INK} stroke="none" />
        <path d="M110 82 Q118 78 126 82" strokeWidth={3} />
      </>
    ),
    worried: (
      <>
        <path d="M75 93 Q82 99 89 93" />
        <path d="M111 93 Q118 99 125 93" />
        <path d="M72 84 L88 80" strokeWidth={3} />
        <path d="M128 84 L112 80" strokeWidth={3} />
      </>
    ),
    sleepy: (
      <>
        <path d="M75 96 Q82 100 89 96" />
        <path d="M111 96 Q118 100 125 96" />
      </>
    ),
  };
  const mouth: Record<PebbleMood, ReactNode> = {
    happy: <path d="M93 108 Q100 115 107 108" />,
    waving: <path d="M92 107 Q100 116 108 107" />,
    celebrating: <path d="M90 106 Q100 106 110 106 Q108 120 100 120 Q92 120 90 106 Z" fill="#C9706A" />,
    thinking: <path d="M95 111 Q100 109 105 111" />,
    worried: <path d="M93 113 Q96 109 100 112 Q104 109 107 113" />,
    sleepy: <ellipse cx={100} cy={111} rx={3.5} ry={3} fill={INK} stroke="none" />,
  };
  return (
    <g stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none">
      {eyes[mood]}
      <ellipse cx={72} cy={108} rx={8} ry={5} fill={PINK} stroke="none" opacity={0.95} />
      <ellipse cx={128} cy={108} rx={8} ry={5} fill={PINK} stroke="none" opacity={0.95} />
      {mouth[mood]}
    </g>
  );
}

interface Props {
  mood?: PebbleMood;
  size?: number;
  className?: string;
  label?: string;
}

/**
 * Pebble: a chubby pill capsule with a nurse cap and a mug of tea.
 * Drawn in SVG so every mood is the same character with a small change of pose.
 */
export function Pebble({ mood = 'happy', size = 120, className = '', label }: Props) {
  const holdsMug = mood !== 'celebrating';
  const steam = mood === 'happy' || mood === 'waving';
  const clip = `pebble-clip-${mood}`;
  return (
    <svg
      viewBox="0 0 200 240"
      width={size}
      height={size * 1.2}
      className={`pebble pebble--${mood} ${className}`}
      role="img"
      aria-label={label ?? `Pebble, ${mood}`}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={50} y={40} width={100} height={160} rx={50} />
        </clipPath>
      </defs>

      {mood === 'celebrating' && (
        <g className="pebble-confetti">
          <rect x={30} y={30} width={8} height={4} rx={1} fill={BLUSH} transform="rotate(25 34 32)" />
          <rect x={160} y={24} width={8} height={4} rx={1} fill={SAGE_DARK} transform="rotate(-20 164 26)" />
          <circle cx={172} cy={70} r={3.5} fill="#F3D58A" />
          <circle cx={24} cy={78} r={3.5} fill={SAGE} />
          <Heart x={150} y={6} s={0.7} fill={PINK} />
          <rect x={44} y={8} width={7} height={4} rx={1} fill="#F3D58A" transform="rotate(-35 47 10)" />
        </g>
      )}
      {mood === 'sleepy' && (
        <g className="pebble-zzz" fill={SAGE_DARK} fontFamily="Nunito, sans-serif" fontWeight={800}>
          <text x={150} y={42} fontSize={22}>z</text>
          <text x={166} y={24} fontSize={16}>z</text>
        </g>
      )}
      {mood === 'thinking' && (
        <g fill={CREAM} stroke={INK} strokeWidth={3} className="pebble-think">
          <circle cx={158} cy={56} r={5} />
          <circle cx={170} cy={38} r={8} />
          <text x={164} y={44} fontSize={13} fontWeight={800} fill={INK} stroke="none" fontFamily="Nunito, sans-serif">?</text>
        </g>
      )}

      <g className="pebble-body">
        {/* feet */}
        <ellipse cx={80} cy={203} rx={15} ry={9} fill={SAGE} stroke={INK} strokeWidth={4} />
        <ellipse cx={120} cy={203} rx={15} ry={9} fill={SAGE} stroke={INK} strokeWidth={4} />

        {/* back arms (behind body) for raised poses */}
        {mood === 'celebrating' && (
          <>
            <Arm d="M58 128 Q38 108 34 84" className="pebble-arm-left-up" />
            <Arm d="M142 128 Q162 108 166 84" className="pebble-arm-right-up" />
          </>
        )}
        {mood === 'waving' && <Arm d="M142 130 Q162 116 168 94" className="pebble-wave" />}

        {/* capsule: cream bottom, sage top */}
        <rect x={50} y={40} width={100} height={160} rx={50} fill={CREAM} />
        <g clipPath={`url(#${clip})`}>
          <rect x={40} y={30} width={120} height={98} fill={SAGE} />
          <path d="M40 128 H160" stroke={INK} strokeWidth={3.5} />
          <ellipse cx={74} cy={64} rx={9} ry={16} fill="#fff" opacity={0.45} transform="rotate(25 74 64)" />
          <ellipse cx={130} cy={178} rx={10} ry={6} fill={SAGE} opacity={0.18} />
        </g>
        <rect x={50} y={40} width={100} height={160} rx={50} fill="none" stroke={INK} strokeWidth={4.5} />

        {/* nurse cap */}
        <path d="M74 50 Q100 38 126 50 L121 24 Q100 16 79 24 Z" fill="#fff" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <Heart x={100} y={25} s={0.85} fill={PINK} />

        <Face mood={mood} />

        {/* front arms holding the mug */}
        {holdsMug && (
          <>
            <Mug x={84} y={138} steam={steam} />
            <Arm d="M54 142 Q66 160 86 156" />
            {mood === 'thinking' ? (
              <Arm d="M146 140 Q150 120 134 116" />
            ) : mood === 'waving' ? null : (
              <Arm d="M146 142 Q138 162 118 156" />
            )}
          </>
        )}
      </g>
    </svg>
  );
}

/** Pebble with a speech bubble. */
export function PebbleSays({
  mood = 'happy',
  size = 96,
  children,
  align = 'row',
}: {
  mood?: PebbleMood;
  size?: number;
  children: ReactNode;
  align?: 'row' | 'stack';
}) {
  return (
    <div className={`pebble-says pebble-says--${align}`}>
      <Pebble mood={mood} size={size} />
      <div className="bubble" role="status">
        {children}
      </div>
    </div>
  );
}
