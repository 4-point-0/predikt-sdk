import { PlatformType } from './common';

/** Public venue trading status — `GET /venues/status` (no JWT required). */
export interface VenueStatus {
  platform: PlatformType;
  isTradingEnabled: boolean;
  statusMessage: string | null;
}
