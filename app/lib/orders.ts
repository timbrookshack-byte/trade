// Shared order types/constants — safe for client components.
// Queries live in orders.server.ts.

export type OrderStatus =
  | "quote"
  | "submitted"
  | "confirmed"
  | "picking"
  | "dispatched"
  | "completed"
  | "cancelled";

export interface Order {
  id: number;
  order_number: string | null;
  status: OrderStatus;
  customer_id: number | null;
  business_name: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  note: string;
  total_inc_gst: string;
  sale_number_360: string | null;
  created_by_user_id: number | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  sku: string;
  name: string;
  quantity: number;
  unit_price_inc_gst: string;
  position: number;
  available_now?: number | null;
}

export interface Payment {
  id: number;
  order_id: number;
  method: "eft" | "card" | "cash" | "other";
  amount: string;
  reference: string;
  paid_at: string;
  created_at: string;
}

/** Allowed status transitions (quote→submitted is "convert to order"). */
export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  quote: ["submitted", "cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["picking", "cancelled"],
  picking: ["dispatched", "cancelled"],
  dispatched: ["completed"],
  completed: [],
  cancelled: [],
};

export const STATUS_LABELS: Record<OrderStatus, string> = {
  quote: "Quote",
  submitted: "Submitted",
  confirmed: "Confirmed",
  picking: "Picking",
  dispatched: "Dispatched",
  completed: "Completed",
  cancelled: "Cancelled",
};
