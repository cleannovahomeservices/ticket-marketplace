-- ═══════════════════════════════════════════════════════════════════
-- SECURITY HARDENING — 2026-04-16
-- ─────────────────────────────────────────────────────────────────────
--  1. Close privilege escalation on profiles (users could self-grant
--     role='admin' / is_admin=true via client-side update).
--  2. Pin security-sensitive columns so buyer/seller ids, price,
--     PI ids, transfer ids, stripe_account_id can't be rewritten from
--     the client.
--  3. audit_log + rate_limit tables (service-role only).
--  4. Rate-limit helper function.
-- ═══════════════════════════════════════════════════════════════════

-- ── profiles: block client UPDATE on privileged columns ─────────────
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

-- INSERT: can only create own row, never with elevated role.
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (
    auth.uid() = id
    and coalesce(role, 'user') = 'user'
    and coalesce(is_admin, false) = false
  );

-- UPDATE: can only edit own row; role/is_admin/stripe_account_id pinned
-- to their existing values (a change = WITH CHECK violation = 403).
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and (role is not distinct from (select p.role from public.profiles p where p.id = auth.uid()))
    and (is_admin is not distinct from (select p.is_admin from public.profiles p where p.id = auth.uid()))
    and (stripe_account_id is not distinct from (select p.stripe_account_id from public.profiles p where p.id = auth.uid()))
  );


-- ── orders: pin ids/price/PI id on UPDATE; enforce buy-now matches list price on INSERT ──
drop policy if exists "Buyers can create orders" on public.orders;
drop policy if exists "Order parties can update orders" on public.orders;

create policy "Buyers can create orders"
  on public.orders for insert
  to authenticated
  with check (
    auth.uid() = buyer_id
    and buyer_id <> seller_id
    and price > 0
    and price <= 100000
    and seller_id = (select t.seller_id from public.tickets t where t.id = ticket_id)
    and status in ('pending_seller', 'pending_payment')
    and type in ('buy', 'offer')
    -- Buy-now must match the listing price exactly; offers are free-form.
    and (
      type = 'offer'
      or (type = 'buy' and price = (select t.price from public.tickets t where t.id = ticket_id))
    )
    and stripe_payment_intent_id is null
    and ticket_file_url is null
    and transfer_id is null
    and paid_out_at is null
    and seller_amount is null
  );

create policy "Order parties can update orders"
  on public.orders for update
  to authenticated
  using (auth.uid() = buyer_id or auth.uid() = seller_id)
  with check (
    (auth.uid() = buyer_id or auth.uid() = seller_id)
    and buyer_id  = (select o.buyer_id  from public.orders o where o.id = orders.id)
    and seller_id = (select o.seller_id from public.orders o where o.id = orders.id)
    and ticket_id = (select o.ticket_id from public.orders o where o.id = orders.id)
    and price     = (select o.price     from public.orders o where o.id = orders.id)
    and (stripe_payment_intent_id is not distinct from
         (select o.stripe_payment_intent_id from public.orders o where o.id = orders.id))
    and (transfer_id is not distinct from
         (select o.transfer_id from public.orders o where o.id = orders.id))
    and (seller_amount is not distinct from
         (select o.seller_amount from public.orders o where o.id = orders.id))
    and (paid_out_at is not distinct from
         (select o.paid_out_at from public.orders o where o.id = orders.id))
  );


-- ── tickets: pin seller_id + reserved_by on UPDATE, sane INSERT ─────
drop policy if exists "Users can create tickets" on public.tickets;
drop policy if exists "Owners can update tickets" on public.tickets;

create policy "Users can create tickets"
  on public.tickets for insert
  to authenticated
  with check (
    auth.uid() = seller_id
    and price > 0
    and price <= 100000
    and status in ('active', 'pending')
    and reserved_by is null
  );

create policy "Owners can update tickets"
  on public.tickets for update
  to authenticated
  using (auth.uid() = seller_id)
  with check (
    auth.uid() = seller_id
    and seller_id = (select t.seller_id from public.tickets t where t.id = tickets.id)
    -- reserved/sold/completed are backend-only transitions.
    and status in ('active', 'pending')
    and (reserved_by is not distinct from
         (select t.reserved_by from public.tickets t where t.id = tickets.id))
  );


-- ── messages: enforce participant + length, pin sender ─────────────
drop policy if exists "Auth users can send messages" on public.messages;

create policy "Participants can send messages"
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and order_id is not null
    and exists (
      select 1 from public.orders o
      where o.id = messages.order_id
        and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
        and (receiver_id = o.buyer_id or receiver_id = o.seller_id)
        and receiver_id <> sender_id
    )
    and char_length(content) between 1 and 2000
  );


-- ═══════════════════════════════════════════════════════════════════
-- audit_log — append-only; readable by admins, writable only via
-- service-role (no INSERT/UPDATE/DELETE policies for client roles).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_user_idx    on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_action_idx  on public.audit_log (action, created_at desc);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "Admins can read audit log" on public.audit_log;
create policy "Admins can read audit log"
  on public.audit_log for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.is_admin = true)
    )
  );


-- ═══════════════════════════════════════════════════════════════════
-- rate_limit — token-bucket counters, service-role only.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.rate_limit (
  subject text not null,
  action  text not null,
  window_start timestamptz not null default now(),
  count int not null default 0,
  primary key (subject, action)
);

alter table public.rate_limit enable row level security;
-- No policies → denied for all authenticated/anon roles.


-- Atomic token-bucket increment. Returns new count inside the current
-- window. Backend compares against a per-action limit.
create or replace function public.rate_limit_hit(
  p_subject text,
  p_action  text,
  p_window_seconds int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.rate_limit as rl (subject, action, window_start, count)
  values (p_subject, p_action, now(), 1)
  on conflict (subject, action) do update
    set count = case
          when rate_limit.window_start + make_interval(secs => p_window_seconds) < now()
          then 1
          else rate_limit.count + 1
        end,
        window_start = case
          when rate_limit.window_start + make_interval(secs => p_window_seconds) < now()
          then now()
          else rate_limit.window_start
        end
  returning count into new_count;

  return new_count;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, int) from public;
grant execute on function public.rate_limit_hit(text, text, int) to service_role;
