import { HttpClient, QueryParams } from '../http-client.js';
import { OrdersListQuery } from '../types/orders.js';
import { BuyOrderResponse, RedeemOrderResponse, SellOrderResponse } from '../types/trading.js';

export class OrdersClient {
  constructor(private readonly http: HttpClient) {}

  getBuyOrder(id: string): Promise<BuyOrderResponse> {
    return this.http.get<BuyOrderResponse>(`/orders/buy/${id}`);
  }

  listBuyOrders(query?: OrdersListQuery): Promise<BuyOrderResponse[]> {
    return this.http.get<BuyOrderResponse[]>('/orders/buy', query as QueryParams);
  }

  getSellOrder(id: string): Promise<SellOrderResponse> {
    return this.http.get<SellOrderResponse>(`/orders/sell/${id}`);
  }

  listSellOrders(query?: OrdersListQuery): Promise<SellOrderResponse[]> {
    return this.http.get<SellOrderResponse[]>('/orders/sell', query as QueryParams);
  }

  getRedeemOrder(id: string): Promise<RedeemOrderResponse> {
    return this.http.get<RedeemOrderResponse>(`/orders/redeem/${id}`);
  }

  listRedeemOrders(query?: OrdersListQuery): Promise<RedeemOrderResponse[]> {
    return this.http.get<RedeemOrderResponse[]>('/orders/redeem', query as QueryParams);
  }
}
