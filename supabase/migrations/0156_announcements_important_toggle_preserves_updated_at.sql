-- Jeff, 2026-10-29: "如果某一notice,從重要改成不重要，應該時間不用變成最新
-- 的" — Store Notice (Bulletin's "announcement" category) is sorted purely
-- by updated_at (BulletinPage.jsx's .order('updated_at', ...) query plus
-- its own client-side merge-sort of the combined feed), and announcements
-- shares a generic BEFORE UPDATE trigger (set_updated_at(), also used by
-- 10 other tables — profiles, leave_requests, roster_periods, audit_items,
-- audit_reports, formula_categories, ingredient_format_rules,
-- maintenance_items, quiz_questions, shop_training_items) that
-- unconditionally bumps updated_at to now() on ANY update. That shared
-- function is left exactly as-is for every other table — this gives
-- announcements its own dedicated trigger/function instead, so only this
-- one table's behaviour changes.
--
-- AnnouncementDetailModal.jsx's Edit form always re-sends title,
-- content_html, is_important AND category together in one .update() call
-- whether or not they actually changed (there's no separate "just the
-- importance checkbox" save path — ticking/unticking "Mark as important"
-- and clicking Save goes through the same general edit flow). So the only
-- way to tell "this save only flipped is_important" from "this save
-- actually edited the notice" is to compare OLD vs NEW inside the
-- trigger: if title/content_html/category (the actual content) and solved
-- (customer-complaint resolution, which should still bump the notice to
-- the top of the feed when a complaint gets resolved) are all unchanged,
-- keep the existing updated_at instead of touching it — regardless of
-- which direction is_important flipped. Any real content edit, or solving
-- a complaint, still bumps it to now() exactly as before.
create or replace function set_announcements_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.title is distinct from old.title
     or new.content_html is distinct from old.content_html
     or new.category is distinct from old.category
     or new.solved is distinct from old.solved
  then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_announcements_updated_at on announcements;

create trigger trg_announcements_updated_at
before update on announcements
for each row execute function set_announcements_updated_at();
