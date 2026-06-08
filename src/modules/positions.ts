import { HttpClient, QueryParams } from '../http-client';
import { PaginatedPositions, PositionResponse, PositionsQuery } from '../types/positions';

export class PositionsClient {
  constructor(private readonly http: HttpClient) {}

  list(query: PositionsQuery): Promise<PaginatedPositions> {
    return this.http.get<PaginatedPositions>('/positions', query as unknown as QueryParams);
  }

  get(id: string): Promise<PositionResponse> {
    return this.http.get<PositionResponse>(`/positions/${id}`);
  }
}
