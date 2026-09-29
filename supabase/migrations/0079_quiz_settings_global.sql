-- Jeff, 2026-09-30: "我覺得還是要做到全店面通用，因為有時候如果要套用某一設定
-- 到所有店就會變成頁面的所有設定都套用，因為也沒有指定哪些設定套用的功能。所以
-- 很難做到每家店管理自己的頁面，而且現在又在admin下，基本都是所有分店統一設
-- 定" — quiz_settings/formal_quiz_settings were per-store (one row per
-- store_id) since day one, but that granularity was never actually usable:
-- there's no way to pick WHICH settings apply to which store on a save, so
-- "per-store" in practice just meant repeating the exact same edit five
-- times. Combined with this page already living inside Admin Center — whose
-- header hides the Store Switcher and shows a static "All Stores" label for
-- every other page there, because they really are global — the per-store
-- shape was pure friction with no real benefit. Converting both tables to a
-- true singleton (one row, ever, enforced by the `singleton` PK + check
-- below) removes that friction entirely and also permanently closes the gap
-- that started this whole conversation: Brisbane One and Underwood having
-- silently different quiz behavior from the other three stores just because
-- nobody had saved settings for them yet — now there's only ever one set of
-- numbers for every store to share.
--
-- Starting values for the new single row: Jeff's call (AskUserQuestion) was
-- to carry over Brookside/Sunnybank's numbers (the two that already agreed
-- with each other) rather than Toowong's slightly different mix or the
-- code's own hardcoded defaults — so Toowong's Importance mix and Formal
-- Quiz fill-in-blank ratio move to match the other stores as of this
-- migration, not the other way around.

delete from quiz_settings;
alter table quiz_settings drop column store_id;
alter table quiz_settings add column singleton boolean not null default true;
alter table quiz_settings add constraint quiz_settings_singleton_pk primary key (singleton);
alter table quiz_settings add constraint quiz_settings_singleton_true check (singleton);
insert into quiz_settings (singleton, question_count, importance_ratio, formula_question_ratio, reminder_period_months)
values (true, 10, '{"1":50,"2":30,"3":20}'::jsonb, 80, 3);

delete from formal_quiz_settings;
alter table formal_quiz_settings drop column store_id;
alter table formal_quiz_settings add column singleton boolean not null default true;
alter table formal_quiz_settings add constraint formal_quiz_settings_singleton_pk primary key (singleton);
alter table formal_quiz_settings add constraint formal_quiz_settings_singleton_true check (singleton);
insert into formal_quiz_settings (singleton, question_count, importance_ratio, fill_in_blank_ratio, top10_fill_blank_weight)
values (true, 30, '{"1":50,"2":30,"3":20}'::jsonb, 70, 3);

-- Existing RLS policies (0001_init.sql / 0033_formal_quiz.sql) never
-- referenced store_id in the first place — "read quiz_settings"/"read
-- formal_quiz_settings" already allowed any authenticated user, and the
-- admin-only write policies check is_admin(), not store membership — so
-- nothing there needs to change.
