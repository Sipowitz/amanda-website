import { paymentMethods } from "./bookingDisplay";

const fieldClass =
  "rounded-xl border border-[#d9d5ca] bg-white px-4 py-3 text-[#29332b] outline-none transition focus:border-[#6f8c72] focus:ring-2 focus:ring-[#6f8c72]/10 disabled:cursor-not-allowed disabled:bg-[#efeee9] disabled:text-[#9a9d97]";

const labelClass =
  "flex flex-col gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#747b73]";

export default function BookingPaymentEditor({
  booking,
  form,
  onChange,
  onSubmit,
  onClose,
  saving,
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[#d9d5ca] bg-[#faf8f2] p-5"
    >
      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7c837a]">
          Payment management
        </p>

        <h3 className="mt-2 text-xl font-medium text-[#283128]">
          Update payment
        </h3>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Payment status
          <select
            name="paymentStatus"
            value={form.paymentStatus}
            onChange={onChange}
            className={fieldClass}
          >
            <option value="unpaid">Unpaid</option>
            <option value="part_paid">Part Paid</option>
            <option value="paid">Paid</option>
            <option value="waived">Waived</option>
          </select>
        </label>

        <label className={labelClass}>
          Payment method
          <select
            name="paymentMethod"
            value={form.paymentMethod}
            disabled={["unpaid", "waived"].includes(form.paymentStatus)}
            onChange={onChange}
            className={fieldClass}
          >
            {paymentMethods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Amount due
          <input
            type="number"
            name="amountDue"
            min="0"
            step="0.01"
            required
            value={form.amountDue}
            onChange={onChange}
            className={fieldClass}
          />
        </label>

        <label className={labelClass}>
          Amount paid
          <input
            type="number"
            name="amountPaid"
            min="0"
            step="0.01"
            required
            value={form.amountPaid}
            disabled={["unpaid", "waived"].includes(form.paymentStatus)}
            onChange={onChange}
            className={fieldClass}
          />
        </label>
      </div>

      <label className={`mt-4 ${labelClass}`}>
        Payment reference
        <input
          name="paymentReference"
          placeholder="Optional transaction reference"
          value={form.paymentReference}
          onChange={onChange}
          className={fieldClass}
        />
      </label>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-[#365d3c] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#2d5133] disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Payment"}
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="rounded-xl border border-[#d7d3c8] bg-white px-5 py-2.5 text-sm text-[#536057] transition hover:bg-[#f2f0ea] disabled:opacity-50"
        >
          Close
        </button>
      </div>
    </form>
  );
}
