import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { DoseStatus, Medicine, Person, PillShape, SlotHealth } from '../services/types';
import { fmtTime, cityShort } from '../lib/time';

// ---------- status ----------

export const statusLabel: Record<DoseStatus, string> = {
  taken: 'Taken',
  unconfirmed: 'Picked up, not confirmed',
  late: 'Late',
  missed: 'Missed',
  dispensed: 'In the cup',
  upcoming: 'Upcoming',
};

const statusShort: Record<DoseStatus, string> = { ...statusLabel, unconfirmed: 'Not confirmed' };

export function StatusChip({ status, short }: { status: DoseStatus; short?: boolean }) {
  return (
    <span className={`chip chip--${status}`}>
      <span className="chip-dot" aria-hidden />
      {short ? statusShort[status] : statusLabel[status]}
    </span>
  );
}

export const healthLabel: Record<SlotHealth, string> = {
  ok: 'Good',
  low: 'Refill soon',
  empty: 'Empty',
  stuck: 'Stuck',
  unused: 'Not in use',
};

export function HealthChip({ health }: { health: SlotHealth }) {
  const cls = health === 'ok' ? 'taken' : health === 'low' ? 'unconfirmed' : health === 'unused' ? 'upcoming' : 'missed';
  return (
    <span className={`chip chip--${cls}`}>
      <span className="chip-dot" aria-hidden />
      {healthLabel[health]}
    </span>
  );
}

// ---------- pills, people ----------

export function PillIcon({ med, size = 44 }: { med: Pick<Medicine, 'color' | 'shape' | 'photo' | 'name'>; size?: number }) {
  if (med.photo) {
    return <img src={med.photo} alt={med.name} className="pill-photo" style={{ width: size, height: size }} />;
  }
  return (
    <span className="pill-icon" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 48 48" width={size * 0.8} height={size * 0.8}>
        <PillShapeSvg shape={med.shape} color={med.color} />
      </svg>
    </span>
  );
}

function PillShapeSvg({ shape, color }: { shape: PillShape; color: string }) {
  const s = { stroke: '#3A4A3A', strokeWidth: 2.5 } as const;
  if (shape === 'capsule') {
    return (
      <g transform="rotate(-35 24 24)">
        <rect x={8} y={16} width={32} height={16} rx={8} fill={color} {...s} />
        <path d="M24 16 V32" {...s} />
        <rect x={24} y={16} width={16} height={16} rx={8} fill="#FBF8F1" opacity={0.55} />
      </g>
    );
  }
  if (shape === 'oval') {
    return (
      <g>
        <ellipse cx={24} cy={24} rx={17} ry={11} fill={color} {...s} />
        <path d="M13 24 H35" stroke="#3A4A3A" strokeWidth={1.6} opacity={0.5} />
      </g>
    );
  }
  return (
    <g>
      <circle cx={24} cy={24} r={14} fill={color} {...s} />
      <path d="M15 24 H33" stroke="#3A4A3A" strokeWidth={1.6} opacity={0.5} />
    </g>
  );
}

export function Avatar({ person, size = 44 }: { person: Pick<Person, 'name' | 'photo' | 'role'>; size?: number }) {
  if (person.photo) return <img src={person.photo} alt="" className="avatar" style={{ width: size, height: size }} />;
  const bg = person.role === 'parent' ? '#F2C2C0' : person.role === 'refiller' ? '#E6E8D4' : '#A8BFA0';
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.42 }} aria-hidden>
      {person.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function DualTime({ date, parentTz, caregiverTz }: { date: Date; parentTz: string; caregiverTz: string }) {
  return (
    <span className="dual-time">
      <strong>{fmtTime(date, parentTz)}</strong>
      <span className="muted small">
        {' '}
        {cityShort(parentTz)} · {fmtTime(date, caregiverTz)} {cityShort(caregiverTz)}
      </span>
    </span>
  );
}

// ---------- layout ----------

export function TopBar({ title, back, right }: { title: string; back?: string | true; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back ? (
        <button className="icon-btn" aria-label="Back" onClick={() => (back === true ? nav(-1) : nav(back))}>
          <svg viewBox="0 0 24 24" width={22} height={22}>
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <span className="icon-btn-spacer" />
      )}
      <h1 className="topbar-title">{title}</h1>
      {right ?? <span className="icon-btn-spacer" />}
    </header>
  );
}

const navItems = [
  { to: '/care', label: 'Today', icon: 'M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z', end: true },
  { to: '/care/meds', label: 'Slots', icon: 'M4 7 H20 V17 H4 Z M8 7 V17 M12 7 V17 M16 7 V17' },
  { to: '/care/refills', label: 'Refills', icon: 'M6 4 H18 V20 H6 Z M9 9 H15 M12 6 V12' },
  { to: '/care/week', label: 'Week', icon: 'M4 6 H20 V20 H4 Z M4 10 H20 M9 4 V8 M15 4 V8' },
  { to: '/care/more', label: 'More', icon: 'M6 12 h.01 M12 12 h.01 M18 12 h.01' },
];

export function BottomNav() {
  return (
    <nav className="bottomnav" aria-label="Main">
      {navItems.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `bottomnav-item${isActive ? ' active' : ''}`}>
          <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden>
            <path
              d={n.icon}
              fill="none"
              stroke="currentColor"
              strokeWidth={n.label === 'More' ? 4 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

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

/** Read a picked image file into a data URL (mock upload). */
export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
