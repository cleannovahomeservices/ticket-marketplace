-- Vinted-style marketplace refactor — add order.type, scope messages to orders, enable realtime.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'buy';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_type_chk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_type_chk CHECK (type IN ('buy','offer'));
  END IF;
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE messages ADD COLUMN IF NOT EXISTS order_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_order_id_fk') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_order_id_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE messages ALTER COLUMN receiver_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS messages_order_id_idx ON messages(order_id);
CREATE INDEX IF NOT EXISTS orders_ticket_buyer_idx ON orders(ticket_id, buyer_id);

DROP POLICY IF EXISTS "Message parties can view" ON messages;
DROP POLICY IF EXISTS "Auth users can send messages" ON messages;

CREATE POLICY "Message parties can view" ON messages FOR SELECT USING (
  (order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = messages.order_id AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
  ))
  OR auth.uid() = sender_id
  OR auth.uid() = receiver_id
);

CREATE POLICY "Auth users can send messages" ON messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND (
    order_id IS NULL OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = messages.order_id AND (o.buyer_id = auth.uid() OR o.seller_id = auth.uid())
    )
  )
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
END $$;
