import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../services/types';

export type SessionRole = 'caregiver' | 'parent';

interface Session {
  role: SessionRole | null;
  lang: Lang;
  /** True once someone has joined on the parent side (or the demo parent is signed in). */
  parentLinked: boolean;
}

interface SessionApi extends Session {
  signIn(role: SessionRole, opts?: { parentLinked?: boolean }): void;
  signOut(): void;
  setLang(lang: Lang): void;
  setParentLinked(v: boolean): void;
}

const KEY = 'pronoia.session.v1';
const defaults: Session = { role: null, lang: 'en', parentLinked: true };

function read(): Session {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

const Ctx = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Session>(read);

  const save = useCallback((next: Session) => {
    setS(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const api = useMemo<SessionApi>(
    () => ({
      ...s,
      signIn: (role, opts) => save({ ...s, role, parentLinked: opts?.parentLinked ?? s.parentLinked }),
      signOut: () => save({ ...s, role: null }),
      setLang: (lang) => save({ ...s, lang }),
      setParentLinked: (parentLinked) => save({ ...s, parentLinked }),
    }),
    [s, save],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
