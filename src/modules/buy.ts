import { HttpClient } from '../http-client';
import {
  BatchBuyOrderResponse,
  BuyOrderRequest,
  BuyOrderResponse,
  CreateBuyOrderResponse,
  SimulateBuyRequest,
  SimulateAllResponse,
} from '../types/trading';

export class BuyClient {
  constructor(private readonly http: HttpClient) {}

  simulate(body: SimulateBuyRequest): Promise<SimulateAllResponse> {
    return this.http.post<SimulateAllResponse>('/buy/simulate', body);
  }

  createOrder(body: BuyOrderRequest): Promise<CreateBuyOrderResponse> {
    return this.http.post<CreateBuyOrderResponse>('/buy', body);
  }

  setTxHash(orderId: string, bridgeTxHash: string): Promise<BuyOrderResponse> {
    return this.http.post<BuyOrderResponse>(`/buy/${orderId}/tx-hash`, { bridgeTxHash });
  }

  createBatch(items: BuyOrderRequest[]): Promise<BatchBuyOrderResponse> {
    return this.http.post<BatchBuyOrderResponse>('/buy/batch', { items });
  }

  setBatchTxHashes(
    batchId: string,
    hashes: Array<{ groupId: string; txHash: string }>,
  ): Promise<void> {
    return this.http.post<void>(`/buy/batch/${batchId}/tx-hashes`, { hashes });
  }
}
