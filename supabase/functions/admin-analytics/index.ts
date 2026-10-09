import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";

const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const PRODUCTION_HOST = "reachamandabeach.com";
const CACHE_TTL_MS = 60_000;

const PERIODS = {
  "24h": { bucket: "hour", bucketCount: 24 },
  "7d": { bucket: "day", bucketCount: 7 },
  "30d": { bucket: "day", bucketCount: 30 },
  "90d": { bucket: "day", bucketCount: 90 },
} as const;

type Period = keyof typeof PERIODS;
type Bucket = { timestamp: string; visits: number; pageviews: number };
type AnalyticsReport = {
  period: Period;
  window: { start: string; end: string; timezone: "UTC" };
  totals: { visits: number; publicPageviews: number; bookingPageviews: number };
  trend: Bucket[];
  pages: Array<{ path: string; pageviews: number }>;
  sampling: { sampled: boolean; maxSampleInterval: number };
  generatedAt: string;
};

type CloudflareRow = {
  count?: unknown;
  sum?: { visits?: unknown };
  avg?: { sampleInterval?: unknown };
  dimensions?: { datetimeHour?: unknown; date?: unknown; requestPath?: unknown };
};

const cache = new Map<Period, { expiresAt: number; report: AnalyticsReport }>();

function allowedOrigin(request: Request) {
  const configured = Deno.env.get("PUBLIC_SITE_URL")?.replace(/\/$/, "");
  const origin = request.headers.get("Origin")?.replace(/\/$/, "");
  return configured && origin === configured ? configured : null;
}

function corsHeaders(request: Request) {
  const origin = allowedOrigin(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "private, no-store",
    "Vary": "Origin",
  };
}

function json(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), ...headers },
  });
}

function parsePayload(value: unknown): { period: Period; refresh: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload).sort().join(",");
  if (keys !== "period" && keys !== "period,refresh") return null;
  if (!(typeof payload.period === "string" && payload.period in PERIODS)) return null;
  if (payload.refresh !== undefined && typeof payload.refresh !== "boolean") return null;
  return { period: payload.period as Period, refresh: payload.refresh === true };
}

function number(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Malformed Cloudflare ${field}`);
  }
  return Math.round(value);
}

function sampleInterval(row: CloudflareRow) {
  const value = row.avg?.sampleInterval;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error("Malformed Cloudflare sample interval");
  }
  return value;
}

function aggregateRow(rows: unknown) {
  if (!Array.isArray(rows)) throw new Error("Malformed Cloudflare aggregate");
  if (rows.length === 0) return { count: 0, visits: 0, intervals: [1] };
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
    throw new Error("Malformed Cloudflare aggregate");
  }
  const row = rows[0] as CloudflareRow;
  return {
    count: number(row.count, "count"),
    visits: number(row.sum?.visits, "visits"),
    intervals: [sampleInterval(row)],
  };
}

function floorBucket(value: Date, bucket: "hour" | "day") {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  if (bucket === "day") date.setUTCHours(0, 0, 0, 0);
  return date;
}

function bucketKey(value: Date, bucket: "hour" | "day") {
  return bucket === "hour" ? value.toISOString() : value.toISOString().slice(0, 10);
}

function fillTrend(
  rows: unknown,
  start: Date,
  bucket: "hour" | "day",
  bucketCount: number,
) {
  if (!Array.isArray(rows)) throw new Error("Malformed Cloudflare trend");
  const values = new Map<string, Bucket>();
  const intervals: number[] = [];

  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Malformed Cloudflare trend row");
    }
    const row = candidate as CloudflareRow;
    const rawTimestamp = bucket === "hour"
      ? row.dimensions?.datetimeHour
      : row.dimensions?.date;
    if (typeof rawTimestamp !== "string") {
      throw new Error("Malformed Cloudflare trend timestamp");
    }
    const parsed = new Date(bucket === "day" ? `${rawTimestamp}T00:00:00Z` : rawTimestamp);
    if (Number.isNaN(parsed.getTime())) throw new Error("Malformed Cloudflare trend timestamp");
    const key = bucketKey(floorBucket(parsed, bucket), bucket);
    const current = values.get(key) || { timestamp: key, visits: 0, pageviews: 0 };
    current.visits += number(row.sum?.visits, "trend visits");
    current.pageviews += number(row.count, "trend count");
    values.set(key, current);
    intervals.push(sampleInterval(row));
  }

  const filled: Bucket[] = [];
  const cursor = floorBucket(start, bucket);
  const step = bucket === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  for (let index = 0; index < bucketCount; index += 1) {
    const key = bucketKey(cursor, bucket);
    filled.push(values.get(key) || { timestamp: key, visits: 0, pageviews: 0 });
    cursor.setTime(cursor.getTime() + step);
  }
  return { rows: filled, intervals };
}

function normalizePages(rows: unknown) {
  if (!Array.isArray(rows)) throw new Error("Malformed Cloudflare pages");
  const intervals: number[] = [];
  const pages = rows.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Malformed Cloudflare page row");
    }
    const row = candidate as CloudflareRow;
    const path = row.dimensions?.requestPath;
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error("Malformed Cloudflare page path");
    }
    intervals.push(sampleInterval(row));
    return { path, pageviews: number(row.count, "page count") };
  });
  return { pages, intervals };
}

function graphqlQuery(bucket: "hour" | "day") {
  const dimension = bucket === "hour" ? "datetimeHour" : "date";
  const order = bucket === "hour" ? "datetimeHour_ASC" : "date_ASC";
  return `
    query AdminAnalytics($accountTag: string!, $start: Time!, $end: Time!, $host: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          totals: rumPageloadEventsAdaptiveGroups(
            limit: 1
            filter: { AND: [
              { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 },
              { requestPath_neq: "/admin" },
              { requestPath_notlike: "/admin/%" },
              { requestPath_neq: "/reset-password" }
            ] }
          ) { count sum { visits } avg { sampleInterval } }
          bookings: rumPageloadEventsAdaptiveGroups(
            limit: 1
            filter: { AND: [
              { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 },
              { requestPath_neq: "/admin" },
              { requestPath_notlike: "/admin/%" },
              { requestPath_neq: "/reset-password" },
              { OR: [
                { requestPath_like: "/services/%/book" },
                { requestPath_like: "/services/%/request" }
              ] }
            ] }
          ) { count sum { visits } avg { sampleInterval } }
          trend: rumPageloadEventsAdaptiveGroups(
            limit: 1000, orderBy: [${order}]
            filter: { AND: [
              { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 },
              { requestPath_neq: "/admin" },
              { requestPath_notlike: "/admin/%" },
              { requestPath_neq: "/reset-password" }
            ] }
          ) { count sum { visits } avg { sampleInterval } dimensions { ${dimension} } }
          pages: rumPageloadEventsAdaptiveGroups(
            limit: 10, orderBy: [count_DESC]
            filter: { AND: [
              { datetime_geq: $start, datetime_lt: $end, requestHost: $host, bot: 0 },
              { requestPath_neq: "/admin" },
              { requestPath_notlike: "/admin/%" },
              { requestPath_neq: "/reset-password" }
            ] }
          ) { count avg { sampleInterval } dimensions { requestPath } }
        }
      }
    }
  `;
}

async function fetchReport(
  period: Period,
  accountId: string,
  apiToken: string,
  now = new Date(),
) {
  const config = PERIODS[period];
  const step = config.bucket === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  // The report end is exclusive. Subtracting one millisecond ensures an end
  // exactly on a UTC boundary selects the preceding bucket, not an empty one.
  const lastBucket = floorBucket(new Date(now.getTime() - 1), config.bucket);
  const start = new Date(lastBucket.getTime() - (config.bucketCount - 1) * step);
  const payload = {
    query: graphqlQuery(config.bucket),
    variables: {
      accountTag: accountId,
      start: start.toISOString(),
      end: now.toISOString(),
      host: PRODUCTION_HOST,
    },
  };

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("CLOUDFLARE_UNAVAILABLE");
  }

  if (response.status === 429) throw new Error("CLOUDFLARE_RATE_LIMITED");
  if (!response.ok) throw new Error("CLOUDFLARE_UNAVAILABLE");

  let body: Record<string, unknown>;
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    throw new Error("CLOUDFLARE_MALFORMED");
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const rateLimited = body.errors.some((error) =>
      error && typeof error === "object" &&
      /rate|too many/i.test(String((error as Record<string, unknown>).message || ""))
    );
    throw new Error(rateLimited ? "CLOUDFLARE_RATE_LIMITED" : "CLOUDFLARE_GRAPHQL");
  }

  const data = body.data as Record<string, unknown> | undefined;
  const viewer = data?.viewer as Record<string, unknown> | undefined;
  const accounts = viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1 ||
    !accounts[0] || typeof accounts[0] !== "object") {
    throw new Error("CLOUDFLARE_MALFORMED");
  }

  try {
    const account = accounts[0] as Record<string, unknown>;
    const totals = aggregateRow(account.totals);
    const bookings = aggregateRow(account.bookings);
    const trend = fillTrend(account.trend, start, config.bucket, config.bucketCount);
    const pages = normalizePages(account.pages);
    const intervals = [
      ...totals.intervals,
      ...bookings.intervals,
      ...trend.intervals,
      ...pages.intervals,
    ];
    const maxSampleInterval = Math.max(1, ...intervals);
    return {
      period,
      window: { start: start.toISOString(), end: now.toISOString(), timezone: "UTC" },
      totals: {
        visits: totals.visits,
        publicPageviews: totals.count,
        bookingPageviews: bookings.count,
      },
      trend: trend.rows,
      pages: pages.pages,
      sampling: { sampled: maxSampleInterval > 1, maxSampleInterval },
      generatedAt: now.toISOString(),
    } satisfies AnalyticsReport;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CLOUDFLARE_")) throw error;
    throw new Error("CLOUDFLARE_MALFORMED");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!allowedOrigin(request)) return new Response(null, { status: 403 });
    return new Response("ok", { headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (!allowedOrigin(request)) return json(request, { error: "Origin is not allowed" }, 403);

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(request, { error: "Authentication is required." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return json(request, { error: "Analytics is not configured." }, 503);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return json(request, { error: "Authentication is required." }, 401);
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || isAdmin !== true) {
    return json(request, { error: "Administrator access is required." }, 403);
  }

  let payload: { period: Period; refresh: boolean } | null;
  try {
    payload = parsePayload(await request.json());
  } catch {
    payload = null;
  }
  if (!payload) return json(request, { error: "A valid reporting period is required." }, 400);

  const cloudflareToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
  const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  if (!cloudflareToken || !cloudflareAccountId) {
    return json(request, { error: "Analytics is not configured." }, 503);
  }

  const cached = cache.get(payload.period);
  if (!payload.refresh && cached && cached.expiresAt > Date.now()) {
    return json(request, { ...cached.report, cached: true });
  }

  try {
    const report = await fetchReport(
      payload.period,
      cloudflareAccountId,
      cloudflareToken,
    );
    cache.set(payload.period, { report, expiresAt: Date.now() + CACHE_TTL_MS });
    return json(request, { ...report, cached: false });
  } catch (error) {
    if (error instanceof Error && error.message === "CLOUDFLARE_RATE_LIMITED") {
      return json(
        request,
        { error: "Analytics is temporarily rate limited. Please try again shortly." },
        429,
        { "Retry-After": "60" },
      );
    }
    return json(
      request,
      { error: "Cloudflare analytics is temporarily unavailable." },
      502,
    );
  }
});
