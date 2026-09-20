create table pending_staff (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text,
  role text not null default 'staff' check (role in ('admin','shop_manager','staff','training')),
  primary_store_id uuid not null references stores(id),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  linked_profile_id uuid references profiles(id),
  linked_at timestamptz
);

alter table pending_staff enable row level security;

create policy "read same-store pending_staff" on pending_staff for select
  using ((is_manager_or_admin() and primary_store_id = any(current_store_ids())) or is_admin());

create policy "manager admin write pending_staff" on pending_staff for all
  using ((is_manager_or_admin() and primary_store_id = any(current_store_ids())) or is_admin())
  with check ((is_manager_or_admin() and primary_store_id = any(current_store_ids())) or is_admin());
