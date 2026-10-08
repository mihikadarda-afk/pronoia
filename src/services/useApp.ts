import { useEffect, useState, useSyncExternalStore } from 'react';
import { deviceService } from './deviceService';
import type { AppState } from './types';

export function useAppState(): AppState {
  return useSyncExternalStore(
    (fn) => deviceService.subscribe(fn),
    () => deviceService.getState(),
  );
}

/** Re-renders every `ms` so clocks and countdowns stay live. */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => deviceService.now());
  useEffect(() => {
    const id = setInterval(() => setNow(deviceService.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function usePeople() {
  const s = useAppState();
  const caregiver = s.people.find((p) => p.id === s.caregiverId)!;
  const parent = s.people.find((p) => p.id === s.parentId)!;
  const refiller = s.people.find((p) => p.role === 'refiller' && p.status === 'active');
  return { caregiver, parent, refiller };
}

export function useAuth() {
  return useSyncExternalStore(
    (fn) => deviceService.subscribe(fn),
    () => deviceService.auth(),
  );
}
