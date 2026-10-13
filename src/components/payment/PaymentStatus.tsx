interface PaymentStatusProps {
  message: string;
}

export default function PaymentStatus({ message }: PaymentStatusProps) {
  return (
    <div className="payment-status" role="status" aria-live="polite">
      <span className="payment-status-spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
