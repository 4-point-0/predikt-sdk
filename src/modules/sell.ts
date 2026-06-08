import { HttpClient } from '../http-client';
import {
  BatchSellOrderResponse,
  CreateSellOrderResponse,
  SellOrderRequest,
  SellOrderResponse,
  SimulateAllResponse,
  SimulateSellRequest,
} from '../types/trading';

export class SellClient {
  constructor(private readonly http: HttpClient) {}

  simulate(body: SimulateSellRequest): Promise<SimulateAllResponse> {
    return this.http.post<SimulateAllResponse>('/sell/simulate', body);
  }

  createOrder(body: SellOrderRequest): Promise<CreateSellOrderResponse> {
    return this.http.post<CreateSellOrderResponse>('/sell', body);
  }

  setSolanaTx(orderId: string, txSignature: string): Promise<SellOrderResponse> {
    return this.http.post<SellOrderResponse>(`/sell/${orderId}/solana-tx`, { txSignature });
  }

  createBatch(items: SellOrderRequest[]): Promise<BatchSellOrderResponse> {
    return this.http.post<BatchSellOrderResponse>('/sell/batch', { items });
  }

  setBatchChainTx(batchId: string, txSignature: string): Promise<void> {
    return this.http.post<void>(`/sell/batch/${batchId}/chain-tx`, { txSignature });
  }
}
