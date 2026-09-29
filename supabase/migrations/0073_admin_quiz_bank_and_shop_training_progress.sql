-- Jeff, 2026-09: two independent changes bundled in one migration since
-- both were asked for in the same request.
--
-- 1. Reinstate a genuinely shared, centrally-managed "Admin Quiz Bank"
-- under Admin Center (admin_center.quiz_bank in permissions.js). Migration
-- 0071 made quiz_questions store-owned outright (store_id NOT NULL, one
-- store per question) — Jeff now wants a THIRD tier on top of that: admin/
-- developer can author questions with no store at all (store_id IS NULL),
-- which every store's Training Centre > Quiz Bank ("Branch Quiz Bank")
-- shows read-only alongside its own store-owned questions, and which Quick
-- Quiz/Formal Quiz pull from together with the store's own bank
-- ("各分店實行quick跟formal quiz出題時就會從admin bank跟分店自己的bank裡一起
-- 抓題"). This is NOT a data migration — no existing per-store row is
-- reinterpreted as shared; every existing quiz_questions row keeps
-- exactly the store_id it already has (i.e. becomes a "branch bank" row,
-- unchanged), and the admin bank starts out empty for admin/developer to
-- populate going forward.
--
-- Only the SELECT policy needs relaxing (to also allow store_id IS NULL)
-- plus dropping the NOT NULL constraint so a row CAN have a null store_id
-- in the first place. The existing write policy ("manager admin write
-- quiz_questions", migration 0071) needs no change at all: its
-- shop_manager/manager branch requires `store_id = any (current_store_ids())`,
-- which a null store_id can never satisfy (`null = any(array)` is not
-- true in SQL), so writing/editing/deleting a null-store_id row already
-- falls through to the `is_admin()` branch alone — exactly the
-- admin/developer-only authoring restriction this needs, with nothing to
-- add.
alter table quiz_questions alter column store_id drop not null;

drop policy if exists "read quiz_questions" on quiz_questions;
create policy "read quiz_questions" on quiz_questions
  for select using (store_id is null or store_id = any (current_store_ids()) or is_admin());

-- 2. "study log裡的tab要新增shop training。因為shop training裡也有內容要
-- memorized" — Shop Training content (shop_training_items, store-owned
-- since migration 0052) gets the same per-person "Memorized" checkbox
-- tracking Formula items already have via study_progress, so Study Log can
-- add a Shop Training tab. Kept as its own table (mirroring study_progress
-- exactly, including its RLS) rather than widening study_progress with a
-- nullable formula_item_id + a new shop_training_item_id column — the two
-- item types are unrelated content, and a dedicated FK to shop_training_items
-- is simpler and safer than a "belongs to exactly one of these two
-- columns" constraint would be.
create table shop_training_progress (
  id                     uuid primary key default gen_random_uuid(),
  profile_id             uuid not null references profiles(id) on delete cascade,
  shop_training_item_id  uuid not null references shop_training_items(id) on delete cascade,
  memorized              boolean not null default false,
  memorized_at           timestamptz,
  updated_by             uuid references profiles(id),   -- supports admin/manager bulk-select on behalf of staff, same as study_progress
  unique (profile_id, shop_training_item_id)
);

alter table shop_training_progress enable row level security;

create policy "read own shop_training_progress" on shop_training_progress
  for select using (profile_id = auth.uid() or is_manager_or_admin());
create policy "write own shop_training_progress" on shop_training_progress
  for all using (profile_id = auth.uid() or is_manager_or_admin())
  with check (profile_id = auth.uid() or is_manager_or_admin());
