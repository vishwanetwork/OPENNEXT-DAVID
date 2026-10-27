/** A transient navigation intent, never an order or an authorization record. */
export interface TopupContext {
  orderId?: string;
  purchaseReference?: string;
  spotCheckout?: boolean;
}

export interface TopupReturnIntent {
  identity: string;
  context: TopupContext;
}
