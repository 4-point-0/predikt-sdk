import { HttpClient } from '../http-client';
import { VenueStatus } from '../types/venues';

export class VenuesClient {
  constructor(private readonly http: HttpClient) {}

  /** Public trading status per venue. Use to disable execution UI when a venue is paused. */
  getStatus(): Promise<VenueStatus[]> {
    return this.http.get<VenueStatus[]>('/venues/status');
  }
}
