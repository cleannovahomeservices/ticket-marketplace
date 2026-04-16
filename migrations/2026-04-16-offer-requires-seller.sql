-- ── New `pending_seller` status for offers awaiting seller approval ──
-- Previously offers were inserted straight as `pending_payment`, which
-- let the buyer pay their own offered price before the seller ever
-- saw it. Offers now land in `pending_seller` and only move to
-- `pending_payment` once the seller accepts them in accept-order.js.
alter table public.orders drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pending_seller',
    'pending_payment',
    'paid_pending_ticket',
    'pending_admin_review',
    'completed',
    'rejected'
  ));
