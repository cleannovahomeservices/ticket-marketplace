-- ── Seller balance bookkeeping on orders ──────────────────────
-- `seller_amount` is the EUR net the seller earns after the platform
-- fee (order.price * 0.95). Written when the admin approves and we
-- prepare the transfer, so it survives transient Stripe retries.
-- `transfer_id` / `paid_out_at` are written after stripe.transfers.create
-- succeeds. Until then the order is in the "money on the way" state.
alter table public.orders
  add column if not exists transfer_id text,
  add column if not exists seller_amount numeric(10,2),
  add column if not exists paid_out_at timestamptz;

create index if not exists orders_seller_paid_out_idx
  on public.orders(seller_id, paid_out_at);
