import { LiveDeviceService } from './liveService';
import { MockDeviceService } from './mockService';
import type { DeviceService } from './service';

export {
  DOSE_WINDOW_MIN,
  FRAMES_KEEP_H,
  LATE_AFTER_MIN,
  isDoneDose,
  normalizeCode,
  type AuthState,
  type DeviceService,
  type NewCircle,
  type TimelineItem,
} from './service';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Live when Supabase is configured (see .env.example). Otherwise everything stays on this phone.
 * Add ?local to the URL to use this-phone-only mode even when Supabase is configured.
 */
const forceLocal = typeof location !== 'undefined' && /[?&]local\b/.test(location.search);

export const deviceService: DeviceService = url && key && !forceLocal ? new LiveDeviceService(url, key) : new MockDeviceService();
export const isLocal = deviceService.mode === 'local';
