-- Security hardening, phase 1: create the allowlist and guard functions.
-- This phase intentionally does not activate restrictive booking policies.
--
-- Deployment prerequisite before the next migration:
--   1. Resolve Amanda's existing, verified UUID from auth.users.
--   2. Insert that UUID with a privileged SQL session, for example:
--        insert into public.admin_users (user_id) values ('<verified-uuid>');
-- No email address or UUID is intentionally embedded in source control.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public, anon, authenticated;
grant all on table public.admin_users to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.admin_users
      where user_id = auth.uid()
    );
$$;

alter function public.is_admin() owner to postgres;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create or replace function private.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return;
  end if;

  if not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'Administrator access is required.';
  end if;
end;
$$;

alter function private.require_admin() owner to postgres;
revoke all on function private.require_admin() from public, anon, authenticated;
-- No direct service_role grant is needed: postgres-owned SECURITY DEFINER RPC
-- wrappers invoke this guard internally without exposing the private schema.
revoke all on function private.require_admin() from service_role;

-- PostgreSQL grants PUBLIC execute on new functions by default. Supabase may
-- also have role-specific defaults. Future public RPCs must be granted
-- explicitly after these defaults are removed.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;

comment on table public.admin_users is
  'Allowlist of verified auth.users identities permitted to administer bookings.';
comment on function public.is_admin() is
  'Returns true when the authenticated user is in public.admin_users.';
comment on function private.require_admin() is
  'Allows service_role or an allowlisted authenticated administrator; otherwise raises 42501.';
