# Secure deployment: booking-email processor

This runbook protects the scheduled `process-booking-emails` worker without
changing its one-minute `pg_cron` schedule. It uses a dedicated credential,
not a service-role key, to authorize the scheduler.

## Preconditions

- Perform the change in a maintenance window or deploy it to staging first.
- Do not place any secret in source control, shell history, tickets, or logs.
- Use the actual project reference and the confirmed live cron job ID `1`.
- Record the current cron command securely before changing it, so it can be
  restored if necessary.
- Record the currently deployed function revision and the UTC time at which the
  cron command and function deployment are changed.

## 1. Create the shared scheduler credential

Generate one high-entropy value in the approved secret-management tool. Set
that same newly generated value as the Edge Function secret named
`EMAIL_PROCESSOR_SECRET`; do not use or reuse a service-role key.

Store the same value in Supabase Vault under the name
`email_processor_secret`.

Use the Supabase Dashboard's Edge Function Secrets and Vault interfaces, or
organization-approved secret-management automation. Do not put the value in a
`supabase secrets set` command, a shell environment variable, or SQL text: all
can be retained by shell history, process inspection, CLI history, query
history, or logs. If a policy requires CLI or SQL, use its approved secure
input mechanism and confirm it does not retain the value. If the Vault name
already exists, update that secret rather than creating a second row.

## 2. Verify the scheduler can read exactly one Vault secret

`pg_cron` executes the job as the role in `cron.job.username`. Supabase's
scheduled-function example uses `vault.decrypted_secrets`, but its use here
must be verified for the actual job role before deployment. First identify the
role and schedule:

```sql
select jobid, username, schedule, active
from cron.job
where jobid = 1;
```

In a transaction, assume that exact role and check only a boolean result; do
not select or print the secret. Substitute the `username` returned above.

```sql
begin;
set local role <cron-job-username>;
select
  count(*) = 1
  and bool_and(decrypted_secret is not null and length(decrypted_secret) > 0)
  as scheduler_secret_ready
from vault.decrypted_secrets
where name = 'email_processor_secret';
rollback;
```

Proceed only when the query returns `true`. A failed `set local role`, a
permission error, zero rows, multiple rows, or a null/empty value is a blocker:
correct Vault access or the secret record first. Do not deploy the function
until this check succeeds.

## 3. Update the existing scheduler before deployment

Keep job ID `1` and its existing `* * * * *` schedule. Replace only its
command so `pg_net` sends the Vault-backed header. Remove the existing
Authorization header in this same change: the current function has
`verify_jwt = false` and does not inspect Authorization, while the updated
function authorizes only `X-Email-Processor-Secret`. The old deployment safely
ignores the new header until the new deployment is live.

```sql
select cron.alter_job(
  1,
  command => $job$
    select net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/process-booking-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Email-Processor-Secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'email_processor_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
```

Confirm the job remains scheduled every minute before continuing:

```sql
select jobid, schedule, active
from cron.job
where jobid = 1;
```

## 4. Deploy only after the scheduler is ready

Deploy the reviewed Edge Function code after the cron command includes
`X-Email-Processor-Secret`. The previous version ignores the additional
header, so this order avoids an email-processing interruption.

## 5. Verify scheduled delivery safely

After at least one scheduled run, inspect both the cron record and the actual
`pg_net` HTTP response. A successful cron record proves only that the request
was queued; it does not prove the function accepted it. Use the recorded
change/deployment time to correlate responses, and do not manually invoke
production or create test bookings.

```sql
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = 1
order by start_time desc
limit 10;

select id, status_code, timed_out, error_msg, left(content, 200) as response_body, created
from net._http_response
where created >= '<change timestamp in UTC>'::timestamptz
  and (
    content like '{"message":"No booking emails are waiting"%'
    or content like '{"message":"Booking email queue processed"%'
    or content like '{"error":"Unauthorized"%'
    or content like '{"error":"Email processor authentication is not configured"%'
  )
order by created desc
limit 10;
```

Expect a `2xx` status, `timed_out = false`, no `error_msg`, and one of the
known processor response bodies. `401` indicates a mismatched/missing header;
`503` indicates the Edge Function secret is absent. Inspect response content
only in the protected SQL editor because it can include operational details.

## Rollback

If a post-deployment scheduled response is `401` or `503`, do not restore the
legacy Authorization header: the updated handler ignores it. Immediately roll
back to the recorded prior Edge Function revision; that revision accepts the
Vault-backed header without requiring it, so scheduled delivery can resume.
Then reconcile the Edge Function and Vault values through the approved secret
management process, repeat the role/cardinality check, and redeploy. If the
failure occurs before deployment, do not deploy; correct the Vault issue while
the current function continues to operate.

## Why a missing configured secret returns 503

The handler intentionally returns `503`, not `401`, when
`EMAIL_PROCESSOR_SECRET` is absent. This is a server configuration failure that
the caller cannot correct with different credentials. Missing or incorrect
caller credentials return `401`.

## Service-role credential rotation

Rotating the existing service-role JWT is not required for this fix to work:
the new scheduler header replaces its use in the cron command. A controlled
rotation is nevertheless recommended because the service-role credential was
stored in the cron command. Before rotating, inventory every dependent Edge
Function, scheduler, server integration, and deployment secret. Rotation can
break any dependency that still presents the old key, including this worker's
service-role database client and Square-related functions, until their secret
configuration is updated. Do not rotate during this change unless exposure is
suspected and the dependency update plan is ready.
