import { useEffect, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import { getAdminAnalytics } from "../../services/adminService";

const periods = [
  ["24h", "24 hours"],
  ["7d", "7 days"],
  ["30d", "30 days"],
  ["90d", "90 days"],
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatTrendLabel(timestamp, period) {
  const date = new Date(timestamp.length === 10 ? `${timestamp}T00:00:00Z` : timestamp);
  if (period === "24h") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function TrendTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-[#d9ded5] bg-[#fffefa] px-3 py-2 text-xs text-[#263126] shadow-lg">
      <p className="mb-1 font-medium">{row.fullLabel}</p>
      <p>{formatNumber(row.visits)} {row.visits === 1 ? "visit" : "visits"}</p>
    </div>
  );
}

function VisitorTrend({ rows, period }) {
  const data = rows.map((row) => ({
    ...row,
    label: formatTrendLabel(row.timestamp, period),
    fullLabel: period === "24h" ? `${formatTrendLabel(row.timestamp, period)} UTC` : formatTrendLabel(row.timestamp, period),
  }));
  const interval = period === "24h" ? 3 : period === "7d" ? 0 : "preserveStartEnd";

  return (
    <div className="h-72 min-w-0 sm:h-80" data-trend-points={data.length}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e4e7e1" strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#687169", fontSize: 11 }} interval={interval} minTickGap={16} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "#687169", fontSize: 12 }} allowDecimals={false} width={42} />
          <Tooltip content={<TrendTooltip />} />
          <Line type="monotone" dataKey="visits" name="Visits" stroke="#496a50" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricCard({ label, value, description }) {
  return (
    <AdminCard className="p-5 sm:p-6">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#647064]">{label}</p>
      <p className="mt-3 text-3xl font-light text-[#202620]">{formatNumber(value)}</p>
      <p className="mt-2 text-xs leading-5 text-[#687169]">{description}</p>
    </AdminCard>
  );
}

export default function AdminAnalytics() {
  const [period, setPeriod] = useState("24h");
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const forceRefresh = useRef(false);

  useEffect(() => {
    let active = true;
    const refresh = forceRefresh.current;
    forceRefresh.current = false;
    getAdminAnalytics(period, { refresh })
      .then((data) => {
        if (active) setAnalytics(data);
      })
      .catch((requestError) => {
        if (active) setError(requestError?.message || "Unable to load analytics. Please try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [period, reload]);

  function refresh() {
    forceRefresh.current = true;
    setLoading(true);
    setAnalytics(null);
    setError("");
    setReload((value) => value + 1);
  }

  function changePeriod(value) {
    if (value === period) return;
    setLoading(true);
    setAnalytics(null);
    setError("");
    setPeriod(value);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-8">
      <AdminHeader
        title="Analytics"
        subtitle="Website reporting"
        description="Visits and pageviews reported by Cloudflare Web Analytics for the public website."
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Reporting period" className="flex w-full items-center gap-1 overflow-x-auto rounded-full border border-[#cfd8ce] bg-white p-1 shadow-sm sm:w-fit">
          {periods.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              onClick={() => changePeriod(value)}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition focus:outline-none focus:ring-4 focus:ring-[#55735b]/15 ${period === value ? "bg-[#496a50] text-white" : "text-[#526052] hover:bg-[#f1f4ef]"}`}
            >{label}</button>
          ))}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="w-fit rounded-lg border border-[#c6d0c4] bg-white px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#344034] shadow-sm transition hover:border-[#9fb09f] hover:bg-[#f4f6f1] focus:outline-none focus:ring-4 focus:ring-[#55735b]/15 disabled:cursor-wait disabled:opacity-60"
        >{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {loading && (
        <AdminCard className="p-8">
          <p role="status" className="text-sm text-[#687169]">Loading website analytics…</p>
        </AdminCard>
      )}

      {!loading && error && (
        <AdminCard className="p-8">
          <p role="alert" className="text-sm text-[#39443c]">{error}</p>
          <button type="button" className="mt-4 text-sm font-medium text-[#365d3c]" onClick={refresh}>Try again</button>
        </AdminCard>
      )}

      {!loading && analytics && (
        <>
          <section aria-label="Analytics totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Visits" value={analytics.totals?.visits} description="Sessions beginning on a public page; not unique visitors." />
            <MetricCard label="Public pageviews" value={analytics.totals?.publicPageviews} description="Human page loads on the production site, excluding private routes." />
            <MetricCard label="Booking pageviews" value={analytics.totals?.bookingPageviews} description="Views of service booking and request pages." />
          </section>

          <section aria-labelledby="visitor-trend-title" className="flex flex-col gap-4">
            <div>
              <h2 id="visitor-trend-title" className="text-2xl font-light text-[#202620]">Visitor trend</h2>
              <p className="mt-1 text-sm text-[#687169]">Visits by {period === "24h" ? "hour" : "day"}, shown in UTC.</p>
            </div>
            <AdminCard className="p-4 sm:p-6">
              <VisitorTrend rows={analytics.trend || []} period={period} />
            </AdminCard>
          </section>

          <section aria-labelledby="popular-pages-title" className="flex flex-col gap-4">
            <div>
              <h2 id="popular-pages-title" className="text-2xl font-light text-[#202620]">Most viewed public pages</h2>
              <p className="mt-1 text-sm text-[#687169]">Up to ten production paths, ranked by pageviews.</p>
            </div>
            <AdminCard>
              {(analytics.pages || []).length === 0 ? (
                <p className="p-7 text-sm text-[#687169]">No public pageviews were reported for this period.</p>
              ) : (
                <ol className="divide-y divide-[#e1e5df]">
                  {analytics.pages.map((page, index) => (
                    <li key={page.path} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                      <span className="w-6 text-xs tabular-nums text-[#899189]">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[#202620]" title={page.path}>{page.path}</span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-[#365d3c]">{formatNumber(page.pageviews)} <span className="hidden text-xs font-normal text-[#687169] sm:inline">pageviews</span></span>
                    </li>
                  ))}
                </ol>
              )}
            </AdminCard>
          </section>

          <footer className="border-t border-[#dfe4dc] pt-5 text-xs leading-5 text-[#687169]">
            {analytics.sampling?.sampled && (
              <p role="status">Cloudflare sampled some matching events, so figures are estimates.</p>
            )}
            <p>Figures may include site-owner browsing and exclude visitors who block analytics.</p>
            <p>Private admin and password-reset routes, known bots, and non-production hosts are excluded.</p>
          </footer>
        </>
      )}
    </div>
  );
}
