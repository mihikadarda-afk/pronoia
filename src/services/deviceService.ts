import { LiveDeviceService } from './liveService';
import { MockDeviceService } from './mockService';
import type { DeviceService } from './service';

export {
  CLIP_AFTER_REVIEW_H,
  CLIP_AUTO_DELETE_H,
  LATE_AFTER_MIN,
  normalizeCode,
  type AuthState,
  type DeviceService,
  type NewCircle,
} from './service';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Live when Supabase is configured (see .env.example), otherwise the demo family.
 * Add ?demo to the URL to force the demo even when Supabase is configured.
 */
const forceDemo = typeof location !== 'undefined' && /[?&]demo\b/.test(location.search);

export const deviceService: DeviceService = url && key && !forceDemo ? new LiveDeviceService(url, key) : new MockDeviceService();
export const isDemo = deviceService.mode === 'demo';
