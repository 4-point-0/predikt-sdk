import { HttpClient, QueryParams } from '../http-client';
import { OrdersListQuery } from '../types/orders';
import { BuyOrderResponse, RedeemOrderResponse, SellOrderResponse } from '../types/trading';

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
