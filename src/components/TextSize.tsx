import { useT } from '../lib/i18n';
import { useSession, type TextSize as Size } from '../lib/session';

/** Normal, Large or Largest text, for this phone. */
export function TextSizePicker({ big }: { big?: boolean }) {
  const t = useT();
  const { textSize, setTextSize } = useSession();
  const sizes: [Size, string][] = [
    ['normal', t.textNormal],
    ['large', t.textLarge],
    ['largest', t.textLargest],
  ];
  if (big) {
    return (
      <div className="lang-pick">
        {sizes.map(([id, label], i) => (
          <button key={id} aria-pressed={textSize === id} onClick={() => setTextSize(id)} style={{ fontSize: 22 + i * 4 }}>
            {label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="segmented segmented--block" role="group" aria-label={t.textSize}>
      {sizes.map(([id, label], i) => (
        <button key={id} aria-pressed={textSize === id} onClick={() => setTextSize(id)} style={{ fontSize: 13 + i * 2 }}>
          {label}
        </button>
      ))}
    </div>
  );
}
