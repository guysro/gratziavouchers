export interface FormData {
  name: string;
  phone: string;
  email: string;
  amount: string;
}

export interface FormErrors {
  name?: string;
  phone?: string;
  email?: string;
  amount?: string;
}

export interface PurchaseDetails {
  name: string;
  phone: string;
  email: string;
  amount: number;
}

export interface PaymentNavigationState {
  purchase: PurchaseDetails;
  orderId: string;
  verificationToken: string;
}

export interface CompletedVoucher extends PurchaseDetails {
  voucherCode: string;
  date: string;
}

export interface AdminVoucher {
  voucherCode: string;
  name: string;
  phone: string;
  email: string;
  amount: number;
  currency: string;
  status: "paid" | "redeemed";
  source?: "admin";
  createdAt: string;
  redeemedAt?: string;
}
