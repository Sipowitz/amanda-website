import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import { getAdminStats } from "../../services/adminService";

const periods = [
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["year", "This year"],
  ["all_time", "All time"],
];

const chartColors = ["#496a50", "#8c6e42", "#617b94", "#9b6c78"];

export function formatMinorCurrency(valueMinor, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(Number(valueMinor || 0) / 100);
  } catch {
    return `${currency} ${(Number(valueMinor || 0) / 100).toFixed(2)}`;
  }
}

function formatCurrencies(valueByCurrency = []) {
  if (valueByCurrency.length === 0) return ["No value reported"];
  return valueByCurrency.map((value) => formatMinorCurrency(value.value_minor, value.currency));
}

function formatMonth(month) {
  return new Intl.DateTimeFormat("en-US", { month: "short" })
    .format(new Date(`${month}-01T12:00:00Z`));
}

export function prepareMonthlyChartData(monthlyHistory = []) {
  const currencies = [...new Set(monthlyHistory.flatMap((row) =>
    (row.value_by_currency || []).map((value) => value.currency),
  ))].sort();
  return {
    currencies,
    rows: monthlyHistory.map((row) => ({
      month: row.month,
      label: formatMonth(row.month),
      paid_booking_count: Number(row.paid_booking_count || 0),
      ...Object.fromEntries((row.value_by_currency || []).map((value) => [
        `value_${value.currency}`,
        Number(value.value_minor || 0),
      ])),
    })),
  };
}

function CurrencyValue({ values }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Paid value">
      {formatCurrencies(values).map((value) => <span key={value}>{value}</span>)}
    </div>
  );
}

function MonthlyTooltip({ active, payload, mode, currencies }) {
  if (!active || !payload?.[0]) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-[#d9ded5] bg-[#fffefa] px-3 py-2 text-xs text-[#263126] shadow-lg">
      <p className="mb-1 font-medium">{row.month}</p>
      {mode === "bookings" ? <p>{row.paid_booking_count} paid {row.paid_booking_count === 1 ? "booking" : "bookings"}</p>
        : currencies.map((currency) => <p key={currency}>{formatMinorCurrency(row[`value_${currency}`], currency)}</p>)}
    </div>
  );
}

function MonthlyChart({ monthlyHistory, mode }) {
  const chart = useMemo(() => prepareMonthlyChartData(monthlyHistory), [monthlyHistory]);
  const dataKeys = mode === "bookings" ? ["paid_booking_count"] : chart.currencies.map((currency) => `value_${currency}`);
  return (
    <div className="h-72 min-w-0 sm:h-80" data-chart-months={chart.rows.map((row) => row.month).join(",")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chart.rows} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#687169", fontSize: 12 }} interval={0} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "#687169", fontSize: 12 }} allowDecimals={false} width={42} />
          <Tooltip content={<MonthlyTooltip mode={mode} currencies={chart.currencies} />} />
          {dataKeys.map((dataKey, index) => (
            <Bar key={dataKey} dataKey={dataKey} name={dataKey} fill={mode === "bookings" ? chartColors[0] : chartColors[index % chartColors.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {mode === "value" && chart.currencies.length === 0 && (
        <p className="-mt-12 text-center text-sm text-[#687169]">No monetary values reported for these months.</p>
      )}
    </div>
  );
}

export default function AdminStats() {
  const [mode, setMode] = useState("value");
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setError("");
    getAdminStats()
      .then((data) => { if (active) setStats(data); })
      .catch(() => { if (active) setError("Unable to load statistics. Please try again."); });
    return () => { active = false; };
  }, [reload]);

  const monthlyHistory = stats?.monthly_history || [];
  const serviceBreakdown = stats?.service_breakdown || [];
  const hasIntegrityExceptions = (stats?.data_integrity_exceptions || []).length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-9">
      <AdminHeader
        title="Stats"
        subtitle="Business reporting"
        description="Paid booking value and volume across the same reporting periods."
      />

      {!stats && !error ? <AdminCard className="p-8"><p className="text-sm text-[#687169]">Loading statistics...</p></AdminCard>
        : error ? <AdminCard className="p-8">
          <p role="alert" className="text-sm text-[#39443c]">{error}</p>
          <button type="button" className="mt-4 text-sm text-[#365d3c]" onClick={() => setReload((value) => value + 1)}>Try again</button>
        </AdminCard> : <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div role="group" aria-label="Statistic mode" className="flex w-fit items-center gap-1 rounded-full border border-[#cfd8ce] bg-white p-1 shadow-sm">
              {[["value", "Value"], ["bookings", "Bookings"]].map(([nextMode, label]) => (
                <button
                  key={nextMode}
                  type="button"
                  aria-pressed={mode === nextMode}
                  onClick={() => setMode(nextMode)}
                  className={`rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition focus:outline-none focus:ring-4 focus:ring-[#55735b]/15 ${mode === nextMode ? "bg-[#496a50] text-white" : "text-[#526052] hover:bg-[#f1f4ef]"}`}
                >{label}</button>
              ))}
            </div>
            {hasIntegrityExceptions && <p role="status" className="rounded-lg border border-[#e5d4a9] bg-[#fff8e7] px-3 py-2 text-xs leading-5 text-[#725b24]">Some paid records were excluded because historical reporting data was incomplete.</p>}
          </div>

          <section aria-label="Period totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {periods.map(([key, label]) => {
              const period = stats.period_totals?.[key] || { paid_booking_count: 0, value_by_currency: [] };
              return <AdminCard key={key} className="min-w-0 p-5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#647064]">{label}</p>
                <div className="mt-3 text-2xl font-light text-[#202620]" data-period={key}>
                  {mode === "value" ? <CurrencyValue values={period.value_by_currency || []} />
                    : <span>{Number(period.paid_booking_count || 0).toLocaleString()} <span className="text-sm text-[#687169]">{Number(period.paid_booking_count || 0) === 1 ? "booking" : "bookings"}</span></span>}
                </div>
              </AdminCard>;
            })}
          </section>

          <section aria-label="Last 12 months" className="flex flex-col gap-5">
            <div><h2 className="text-2xl font-light text-[#202620]">Last 12 months</h2><p className="mt-1 text-sm text-[#687169]">{mode === "value" ? "Paid booking value by business-calendar month." : "Paid bookings by business-calendar month."}</p></div>
            <AdminCard className="p-4 sm:p-6"><MonthlyChart monthlyHistory={monthlyHistory} mode={mode} /></AdminCard>
          </section>

          <section aria-label="By service" className="flex flex-col gap-5">
            <div><h2 className="text-2xl font-light text-[#202620]">By service</h2><p className="mt-1 text-sm text-[#687169]">Frozen historical service names.</p></div>
            <AdminCard>
              {serviceBreakdown.length === 0 ? <p className="p-7 text-sm text-[#687169]">No paid service data yet.</p>
                : <div className="divide-y divide-[#e1e5df]">
                  {serviceBreakdown.map((service) => <div key={`${service.service_id}-${service.service_name}`} className="flex flex-col gap-2 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <p className="text-base text-[#202620]">{service.service_name}</p>
                    <div className="text-sm font-medium text-[#365d3c]">
                      {mode === "value" ? <CurrencyValue values={service.value_by_currency || []} />
                        : `${Number(service.paid_booking_count || 0).toLocaleString()} ${Number(service.paid_booking_count || 0) === 1 ? "booking" : "bookings"}`}
                    </div>
                  </div>)}
                </div>}
            </AdminCard>
          </section>

          <footer className="border-t border-[#dfe4dc] pt-5 text-xs leading-5 text-[#687169]">
            <p>Based on successfully paid bookings.</p>
            <p>Reporting timezone: {stats.reporting_timezone || "Unavailable"}.</p>
          </footer>
        </>}
    </div>
  );
}
