import { HttpClient } from '../http-client.js';
import { CreateRedeemOrderResponse, RedeemOrderRequest, RedeemOrderResponse } from '../types/trading.js';

export class RedeemClient {
  constructor(private readonly http: HttpClient) {}

  createOrder(body: RedeemOrderRequest): Promise<CreateRedeemOrderResponse> {
    return this.http.post<CreateRedeemOrderResponse>('/redeem', body);
  }

  setSolanaTx(orderId: string, txSignature: string): Promise<{ order: RedeemOrderResponse }> {
    return this.http.post<{ order: RedeemOrderResponse }>(`/redeem/${orderId}/solana-tx`, {
      txSignature,
    });
  }
}
