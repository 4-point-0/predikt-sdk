import { HttpClient } from '../http-client.js';
import { VenueStatus } from '../types/venues.js';

export class VenuesClient {
  constructor(private readonly http: HttpClient) {}

  /** Public trading status per venue. Use to disable execution UI when a venue is paused. */
  getStatus(): Promise<VenueStatus[]> {
    return this.http.get<VenueStatus[]>('/venues/status');
  }
}
