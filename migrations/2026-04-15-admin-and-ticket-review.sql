-- ── 1. Role column on profiles ─────────────────────────────────
alter table public.profiles
  add column if not exists role text not null default 'user';

-- Align role with existing is_admin flag so we don't lose any current admins.
update public.profiles set role = 'admin' where is_admin = true;

-- Seed the designated admin account.
update public.profiles set role = 'admin' where email = 'cranzcanal@gmail.com';

-- ── 2. New status allow-list on orders ─────────────────────────
-- Drop the old constraint BEFORE migrating data, otherwise the UPDATE
-- below gets rejected for introducing values the old check didn't allow.
alter table public.orders drop constraint if exists orders_status_check;

update public.orders set status = 'pending_payment'      where status in ('pending', 'accepted');
update public.orders set status = 'paid_pending_ticket'  where status = 'paid';

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pending_payment',
    'paid_pending_ticket',
    'pending_admin_review',
    'completed',
    'rejected'
  ));

alter table public.orders alter column status set default 'pending_payment';

-- ── 3. Seller-uploaded ticket file on orders ───────────────────
alter table public.orders
  add column if not exists ticket_file_url text;

-- ── 4. Storage bucket for the QR / ticket files ────────────────
-- Private bucket — access is entirely mediated by the /api/ticket-file
-- endpoint, which uses the service-role key to issue signed URLs.
insert into storage.buckets (id, name, public)
values ('order-tickets', 'order-tickets', false)
on conflict (id) do nothing;
