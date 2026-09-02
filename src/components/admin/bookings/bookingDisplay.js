export const paymentMethods = [
  { value: "", label: "Select payment method" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "card", label: "Card" },
  { value: "payment_link", label: "Payment Link" },
  { value: "stripe", label: "Stripe" },
  { value: "square", label: "Square" },
  { value: "complimentary", label: "Complimentary" },
  { value: "other", label: "Other" },
];

export function getStatusLabel(status) {
  return {
    pending: "Pending",
    pending_payment: "Pending Payment",
    payment_expired: "Payment Expired",
    confirmed: "Confirmed",
    completed: "Completed",
    no_show: "No Show",
    cancelled: "Cancelled",
  }[status] || "Pending";
}

export function getStatusStyles(status) {
  return {
    confirmed: "border-[#cfe2cf] bg-[#e7f2e7] text-[#2f6b38]",
    cancelled: "border-[#efcccc] bg-[#f8e7e7] text-[#9a3a3a]",
    completed: "border-[#cbdde9] bg-[#e9f1f6] text-[#315f7c]",
    no_show: "border-[#d8d7d1] bg-[#efeee9] text-[#68685f]",
    pending: "border-[#ead7a6] bg-[#f8edcf] text-[#7b5b12]",
    pending_payment: "border-[#ead7a6] bg-[#f8edcf] text-[#7b5b12]",
    payment_expired: "border-[#ddd0ea] bg-[#f0e8f7] text-[#6d4f88]",
  }[status] || "border-[#ead7a6] bg-[#f8edcf] text-[#7b5b12]";
}

export function getPaymentLabel(status) {
  return {
    unpaid: "Unpaid",
    part_paid: "Part Paid",
    paid: "Paid",
    waived: "Waived",
    refunded: "Refunded",
    part_refunded: "Part Refunded",
  }[status] || "Unpaid";
}

export function getPaymentStyles(status) {
  return {
    paid: "border-[#cfe2cf] bg-[#e7f2e7] text-[#2f6b38]",
    part_paid: "border-[#f0cfc0] bg-[#fae8df] text-[#ad4b22]",
    waived: "border-[#cbdde9] bg-[#e9f1f6] text-[#315f7c]",
    refunded: "border-[#ddd0ea] bg-[#f0e8f7] text-[#6d4f88]",
    part_refunded: "border-[#ddd0ea] bg-[#f0e8f7] text-[#6d4f88]",
    unpaid: "border-[#f0cfc0] bg-[#fae8df] text-[#b23f1f]",
  }[status] || "border-[#f0cfc0] bg-[#fae8df] text-[#b23f1f]";
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

export function formatTimestamp(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString("en-GB") : null;
}

export function formatBookingDate(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${dateString}T12:00:00`));
}

export function getPaymentMethodLabel(method) {
  return paymentMethods.find((item) => item.value === method)?.label || method || "Not recorded";
}
