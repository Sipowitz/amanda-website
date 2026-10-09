# Admin website analytics

The `admin-analytics` Edge Function reads aggregated Cloudflare Web Analytics
data for the protected `/admin/analytics` page. It does not install tracking,
set cookies, or expose Cloudflare credentials to the browser.

## Required production configuration

Set these Edge Function secrets in the target Supabase project:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare token with account Analytics Read access.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account containing the Web Analytics site.
- `PUBLIC_SITE_URL`: the exact production origin, without a trailing slash.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied automatically by Supabase.
The function validates the caller's JWT and then calls the existing
`public.is_admin()` allowlist check before reading analytics or using its cache.

Reporting windows are half-open UTC ranges: the first bucket starts at the
reported `window.start`, and `window.end` is excluded. The 24-hour report has
exactly 24 UTC hour buckets. The 7-, 30-, and 90-day reports have exactly that
many UTC day buckets. The final bucket is the bucket containing the report end
(or the preceding bucket when the end falls exactly on a boundary), so it may
be partial but no extra boundary bucket is returned.

## Deployment

From the repository root, with the values already present in the operator's
shell environment:

```sh
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase secrets set \
  CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
  PUBLIC_SITE_URL="$PUBLIC_SITE_URL" \
  --project-ref <PROJECT_REF>
npx supabase functions deploy admin-analytics --project-ref <PROJECT_REF>
```

Deploy the frontend through the project's normal production release process
after the function is available. Do not put either Cloudflare value in a
`VITE_` variable or commit it to source control.
