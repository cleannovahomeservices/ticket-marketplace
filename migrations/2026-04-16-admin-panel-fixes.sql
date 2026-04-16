-- ── 1. Add FK hints so PostgREST can embed profiles on orders ───
-- The existing orders_buyer_id_fkey / orders_seller_id_fkey point to
-- auth.users, which PostgREST can't traverse into public.profiles.
-- Add parallel FKs straight to profiles(id) so `profiles!orders_buyer_profile_fkey`
-- resolves. These are additive — the auth.users FKs stay in place.
alter table public.orders
  drop constraint if exists orders_buyer_profile_fkey;
alter table public.orders
  add constraint orders_buyer_profile_fkey
  foreign key (buyer_id) references public.profiles(id) on delete cascade;

alter table public.orders
  drop constraint if exists orders_seller_profile_fkey;
alter table public.orders
  add constraint orders_seller_profile_fkey
  foreign key (seller_id) references public.profiles(id) on delete cascade;

-- ── 2. RLS: admins can view every order ────────────────────────
-- Without this, the admin panel (which uses the anon key + user JWT)
-- only sees orders where the admin is buyer or seller.
drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders"
  on public.orders for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or p.is_admin = true)
    )
  );
