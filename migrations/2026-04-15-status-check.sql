-- Realign orders.status allow-list to the Vinted-style values.
-- The old constraint only permitted [pending_review, completed, rejected, failed],
-- which blocked inserts for the new flow.

UPDATE orders SET status = 'rejected'
  WHERE status NOT IN ('pending', 'accepted', 'rejected', 'paid');

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'paid'));

ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
