import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { Medicine, Person, Plan } from '../services/types';
import { planInfo } from '../services/plans';
import { cityShort, fmtTime } from '../lib/time';
import type { Tone } from '../lib/copy';
import { Pebble, type PebbleMood } from './Pebble';

// ---------- status ----------

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status status--${tone}`}>{children}</span>;
}

// ---------- pills, people ----------

/** The pill photo as a thumbnail. Falls back to a drawn pill when there's no photo yet. */
export function PillPhoto({ med, size = 40, className = 'pill-thumb' }: { med: Pick<Medicine, 'color' | 'shape' | 'photo' | 'name'>; size?: number; className?: string }) {
  const style = size === 40 ? undefined : { width: size, height: size };
  if (med.photo) return <img src={med.photo} alt={med.name} className={className} style={style} />;
  return (
    <svg viewBox="0 0 48 48" className={className} style={style} role="img" aria-label={med.name}>
      <rect width={48} height={48} fill="#ECE7DA" />
      {med.shape === 'capsule' ? (
        <g transform="rotate(-30 24 24)">
          <rect x={10} y={17} width={28} height={14} rx={7} fill={med.color} stroke="#3A4A3A" strokeOpacity={0.35} />
          <path d="M24 17 V31" stroke="#3A4A3A" strokeOpacity={0.35} />
        </g>
      ) : med.shape === 'oval' ? (
        <ellipse cx={24} cy={24} rx={15} ry={9} fill={med.color} stroke="#3A4A3A" strokeOpacity={0.35} />
      ) : (
        <circle cx={24} cy={24} r={11} fill={med.color} stroke="#3A4A3A" strokeOpacity={0.35} />
      )}
    </svg>
  );
}

export function Avatar({ person, size = 40 }: { person: Pick<Person, 'name' | 'photo' | 'role'>; size?: number }) {
  if (person.photo) return <img src={person.photo} alt="" className="avatar" style={{ width: size, height: size }} />;
  const bg = person.role === 'parent' ? '#F2C2C0' : person.role === 'refiller' ? '#E6E8D4' : '#D6E0CF';
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }} aria-hidden>
      {(person.name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Parent's time, with the caregiver's time underneath. */
export function TimeCol({ date, parentTz, caregiverTz }: { date: Date; parentTz: string; caregiverTz: string }) {
  return (
    <span className="t-col">
      <b>{fmtTime(date, parentTz)}</b>
      <span>
        {fmtTime(date, caregiverTz)} {cityShort(caregiverTz) === 'New York' ? 'NY' : cityShort(caregiverTz)}
      </span>
    </span>
  );
}

// ---------- Pebble ----------

/** A small Pebble with a one-line speech bubble. */
export function Says({ mood = 'happy', size = 48, children, stack }: { mood?: PebbleMood; size?: number; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`says${stack ? ' says--stack' : ''}`}>
      <Pebble mood={mood} size={size} />
      <div className="bubble" role="status">
        {children}
      </div>
    </div>
  );
}

// ---------- layout ----------

export function AppBar({ title, back, right }: { title: ReactNode; back?: string | true; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="appbar">
      {back && (
        <button className="back-btn" aria-label="Back" onClick={() => (back === true ? nav(-1) : nav(back))}>
          <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <h1 className="title">{title}</h1>
      {right}
    </header>
  );
}

export function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <Link to="/care/plans" className="plan-badge" title="Your plan">
      {planInfo(plan).name}
    </Link>
  );
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export const Chevron = () => (
  <svg className="chev" viewBox="0 0 24 24" width={18} height={18} aria-hidden>
    <path d="M9 6 L15 12 L9 18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** A plain row that links somewhere, for settings lists. */
export function LinkRow({ to, title, sub, end }: { to: string; title: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  return (
    <li>
      <Link to={to} className="link-row">
        <span className="grow">
          <span className="lrow-title block">{title}</span>
          {sub && <span className="lrow-sub block">{sub}</span>}
        </span>
        {end}
        <Chevron />
      </Link>
    </li>
  );
}

const icons: Record<string, string> = {
  Today: 'M4 10.5 L12 4 L20 10.5 V20 H4 Z M9.5 20 V14 H14.5 V20',
  Medicines: 'M8.5 15.5 L15.5 8.5 M6 18 a4.24 4.24 0 0 1 0 -6 L12 6 a4.24 4.24 0 0 1 6 6 L12 18 a4.24 4.24 0 0 1 -6 0 Z',
  Family: 'M9 11 a3 3 0 1 0 0 -6 a3 3 0 0 0 0 6 Z M3.5 19 c0.6 -3 2.8 -5 5.5 -5 s4.9 2 5.5 5 M16 11 a2.5 2.5 0 1 0 0 -5 M17.5 14.2 c1.6 0.6 2.7 2.4 3 4.8',
  Settings: 'M12 15 a3 3 0 1 0 0 -6 a3 3 0 0 0 0 6 Z M19 12 l2 -1 -1.5 -3 -2.2 0.5 -1.3 -1.2 -0.5 -2.3 h-3 l-0.5 2.3 -1.3 1.2 -2.2 -0.5 L5 11 l2 1 -2 1 1.5 3 2.2 -0.5 1.3 1.2 0.5 2.3 h3 l0.5 -2.3 1.3 -1.2 2.2 0.5 1.5 -3 Z',
};

export function TabBar({ dots = {} }: { dots?: Partial<Record<string, boolean>> }) {
  const tabs = [
    { to: '/care', label: 'Today', end: true },
    { to: '/care/meds', label: 'Medicines' },
    { to: '/care/family', label: 'Family' },
    { to: '/care/settings', label: 'Settings' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
            <path d={icons[t.label]} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {dots[t.label] && <span className="tab-dot" aria-label="New" />}
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

// ---------- bottom sheet ----------

export function Sheet({ open, onClose, title, children, label }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
        <div className="sheet-handle" aria-hidden />
        {title && (
          <div className="sheet-head">
            <div className="grow">{title}</div>
            <button className="sheet-close" aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
                <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </>
  );
}

// ---------- plans ----------

/** A soft, locked card for a feature from a higher plan. Never a pop-up. */
export function Locked({ plan, children }: { plan: Plan; children: ReactNode }) {
  return (
    <div className="locked">
      <Pebble mood="happy" size={36} />
      <div className="grow">
        <p>{children}</p>
        <Link to="/care/plans" className="link-btn small">
          Upgrade to {planInfo(plan).name}
        </Link>
      </div>
    </div>
  );
}

// ---------- controls ----------

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="muted small block">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle" aria-hidden />
    </label>
  );
}

export function Stepper({ value, onChange, min = 0, max = 240, step = 5, unit = 'min', label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Less ${label}`} onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <span>
        {value} {unit}
      </span>
      <button type="button" aria-label={`More ${label}`} onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </span>
  );
}

export function Placeholder({ children }: { children: ReactNode }) {
  return <p className="placeholder-note">{children}</p>;
}

// ---------- toast ----------

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {msg && <div className="toast">{msg}</div>}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Read a picked image file into a small JPEG data URL. */
export function readImage(file: File, max = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => resolve(String(r.result));
      img.src = String(r.result);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** A button that asks for a second tap instead of a browser confirm dialog. */
export function ConfirmButton({
  className,
  style,
  confirmLabel,
  onConfirm,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  confirmLabel: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button className={className} style={style} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))} onBlur={() => setArmed(false)}>
      {armed ? confirmLabel : children}
    </button>
  );
}

/** Pull down at the top of the page to refresh. */
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let startY: number | null = null;
    let dist = 0;
    const down = (e: TouchEvent) => {
      startY = window.scrollY <= 0 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      dist = Math.max(0, Math.min(80, (e.touches[0].clientY - startY) * 0.5));
      setPull(dist);
    };
    const up = async () => {
      if (startY !== null && dist > 50) {
        setBusy(true);
        setPull(40);
        await onRefresh();
        setBusy(false);
      }
      startY = null;
      dist = 0;
      setPull(0);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [onRefresh]);
  return { pull, busy };
}
