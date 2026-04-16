-- ── 1. Expand tickets.status allow-list to include the new lifecycle ──
-- `active`   — listed, anyone can buy
-- `reserved` — a buyer's PaymentIntent is live; no one else may purchase
-- `sold`     — admin approved; funds captured & (if connected) transferred
-- `pending` / `completed` are kept for backwards compatibility with rows
-- created before this migration.
alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets
  add constraint tickets_status_check
  check (status in ('active', 'pending', 'reserved', 'sold', 'completed'));

-- ── 2. Who currently holds the reservation ────────────────────
-- Null unless status='reserved'. ON DELETE SET NULL so a profile wipe
-- doesn't cascade and destroy the ticket.
alter table public.tickets
  add column if not exists reserved_by uuid references public.profiles(id) on delete set null;

create index if not exists tickets_reserved_by_idx on public.tickets(reserved_by);
