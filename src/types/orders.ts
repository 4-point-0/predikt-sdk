export interface OrdersListQuery {
  limit?: number;
  offset?: number;
}

/** Order list envelope: one page of the wallet's orders and the wallet's total count. */
export interface OrdersListResponse<T> {
  items: T[];
  total: number;
}
