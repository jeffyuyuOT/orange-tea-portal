-- Jeff, 2026-09-30: "formula編輯頁面在top10勾取下面新增menu item。被勾取
-- menu item的飲料在formula裡會排在非menu item上面。並且在formula的飲料
-- 名字後面會標註menu item。然後現在quik quiz跟formal quize在Formula
-- fill-in-the-blank questions的部分只會從menu item裡抓取(非menu item不會
-- 抓)。然後formal考試manager在審核的時候也只會check menu item跟shop
-- training並跳出警示說明哪裡還沒memorized。沒有被勾取menu item的飲料等於
-- 非必要背記的飲料，但study log的勾選還是保留，讓自己紀錄是否已記住該飲料。"
--
-- Jeff, 2026-09-30 (same day, revision before this migration was ever
-- applied): "將勾選menu item改成"Must-Know Items"" -- renamed from
-- "menu item"/is_menu_item to "Must-Know Items"/is_must_know before this
-- ever shipped to the live DB, so this is a straight rename, not a
-- migrate-then-rename. See migration 0082 for the matching
-- shop_training_items.is_must_know column added in the same revision.
--
-- A second, independent flag alongside the existing top_10 (migration
-- 0035) -- "Top 10" is about which drinks get extra quiz weighting /
-- surfaced together on a synthetic category page; "Must-Know Items" is
-- about which drinks are the store's official required-memorization menu,
-- used to scope what Quick/Formal Quiz's fill-in-the-blank questions draw
-- from and what the Formal Quiz manager-approval "not yet memorized" check
-- looks at (src/modules/dashboard/study-log/QuickQuizModal.jsx,
-- FormalQuizModal.jsx, src/modules/shop-management/learning-tracker/
-- StaffStudyDetail.jsx), plus (as of the same-day revision) a synthetic
-- Study Log category/tab (StudyLogList.jsx) and Progress Chart/Study
-- Summary breakdowns. A drink left unchecked stays fully visible and
-- editable everywhere and keeps its own Study Log "Memorized" self-tracking
-- checkbox -- it's simply optional rather than mandatory.
alter table formula_items add column if not exists is_must_know boolean not null default false;

-- Only drink items can be a Must-Know item -- same reasoning/shape as
-- formula_items_top_10_drink_only (migration 0035): Tea/Toppings/Others
-- don't have a "menu" concept distinct from just existing.
alter table formula_items drop constraint if exists formula_items_is_menu_item_drink_only;
alter table formula_items drop constraint if exists formula_items_is_must_know_drink_only;
alter table formula_items add constraint formula_items_is_must_know_drink_only
  check (not is_must_know or group_key = 'drink');
