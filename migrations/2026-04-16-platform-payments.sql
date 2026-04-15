-- Align orders.status allow-list with the platform-payments flow and
-- include the simplified names (pending_review / approved) so either
-- naming scheme is accepted going forward.

alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pending_payment',
    'paid_pending_ticket',
    'pending_admin_review',
    'pending_review',
    'approved',
    'completed',
    'rejected'
  ));

-- Re-seed the designated admin account (idempotent).
update public.profiles set role = 'admin', is_admin = true
  where email = 'cranzcanal@gmail.com';
