-- ============================================================================
-- Orange Tea AU — Staff & Manager Portal
-- Initial schema migration
-- Run this in a NEW Supabase project's SQL Editor (Database > SQL Editor),
-- separate from the existing OT-I-O-System (inventory) Supabase project.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Helper: updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. STORES & USERS
-- ============================================================================

create table stores (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text unique not null,        -- short code, e.g. "MEL01"
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- One row per auth.users id. Created via a trigger on auth.users signup,
-- or directly by Admin from User Management.
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  role                text not null check (role in ('admin','shop_manager','staff','training')),
  first_name          text,
  last_name           text,
  phone               text,
  date_of_birth       date,
  email               text,
  tax_file_number     text,                  -- consider column-level encryption / Vault in production
  primary_store_id    uuid references stores(id),
  hire_date           date,                  -- editable by manager/admin only (enforced in app + RLS)
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Which stores a user can access (multi-store admins/managers). A row here
-- for a user's own primary_store_id is implied automatically in app logic,
-- but insert it too for simplicity of RLS joins.
create table user_stores (
  profile_id  uuid not null references profiles(id) on delete cascade,
  store_id    uuid not null references stores(id) on delete cascade,
  primary key (profile_id, store_id)
);

-- Per-user page / sub-page permission overrides. Absence of a row means
-- "use the role default" (defaults are enforced in the app's permission
-- matrix, see src/lib/permissions.js).
create table permission_overrides (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  page_key      text not null,          -- e.g. 'admin_center.formula_database'
  allowed       boolean not null,
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  unique (profile_id, page_key)
);

-- Weekly rotating 4-digit login code for Training-role users, per store.
create table training_codes (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  week_start    date not null,
  code          text not null check (code ~ '^[0-9]{4}$'),
  generated_at  timestamptz not null default now(),
  unique (store_id, week_start)
);

-- Employee document uploads (TFN declaration, super choice form, parent
-- consent form, etc). Actual files live in Supabase Storage; this row is
-- the metadata/index.
create table user_documents (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  doc_type      text not null check (doc_type in ('tfn','super','parent_consent','other')),
  file_path     text not null,          -- storage object path
  original_name text,
  uploaded_at   timestamptz not null default now()
);

-- ============================================================================
-- 2. FORMULA DATABASE (Operations & Training + Admin Center)
-- ============================================================================

-- Sub-categories that only apply to the "drink" group (e.g. Fruit Tea, Milk
-- Tea). Tea / Toppings / Others groups don't use categories (category_id is
-- null for items in those groups).
create table formula_categories (
  id            uuid primary key default gen_random_uuid(),
  group_key     text not null check (group_key in ('drink','tea','toppings','others')),
  name          text not null,
  tips_content  text,                  -- rich text (HTML) shown in the "Tips" popup
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_formula_categories_updated_at before update on formula_categories
  for each row execute function set_updated_at();

create table formula_items (
  id            uuid primary key default gen_random_uuid(),
  group_key     text not null check (group_key in ('drink','tea','toppings','others')),
  category_id   uuid references formula_categories(id) on delete set null,
  name_en       text not null,
  name_zh       text,                  -- optional Chinese name; pronounced client-side via Web Speech API
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_formula_items_updated_at before update on formula_items
  for each row execute function set_updated_at();

-- Which stores a formula item is visible in (defaults to all stores — i.e.
-- no rows means "all stores" in app logic, OR you can seed one row per
-- store; app treats "no rows" as all-visible for simplicity).
create table formula_item_stores (
  formula_item_id uuid not null references formula_items(id) on delete cascade,
  store_id        uuid not null references stores(id) on delete cascade,
  primary key (formula_item_id, store_id)
);

create table ingredient_master (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  unit          text,                  -- e.g. "g", "ml", "pump"
  created_at    timestamptz not null default now()
);

-- Presentation rule for an ingredient when it's rendered in a "standard"
-- formula (abbreviation + font/background colour).
create table ingredient_format_rules (
  ingredient_id   uuid primary key references ingredient_master(id) on delete cascade,
  abbreviation    text,
  font_size       text default '14px',
  font_color      text default '#1f2937',
  background_color text default '#ffffff',
  updated_at      timestamptz not null default now()
);
create trigger trg_ingredient_format_rules_updated_at before update on ingredient_format_rules
  for each row execute function set_updated_at();

-- Ingredients that make up one formula item, with quantity + how this line
-- should render: 'standard' (uses ingredient_format_rules) or 'custom'
-- (uses an uploaded image instead of the standard render).
create table formula_item_ingredients (
  id                uuid primary key default gen_random_uuid(),
  formula_item_id   uuid not null references formula_items(id) on delete cascade,
  ingredient_id     uuid references ingredient_master(id),
  quantity_text     text,              -- free text, e.g. "30g" / "2 pumps"
  display_mode      text not null default 'standard' check (display_mode in ('standard','custom')),
  custom_image_path text,
  sort_order        integer not null default 0
);

-- Structured step-by-step method (replaces "upload a Word doc" — see chat
-- discussion). Each step is plain/rich text with an optional image.
create table formula_item_steps (
  id                uuid primary key default gen_random_uuid(),
  formula_item_id   uuid not null references formula_items(id) on delete cascade,
  step_number       integer not null,
  instruction_html  text not null,
  image_path        text,
  unique (formula_item_id, step_number)
);

-- ============================================================================
-- 3. SHOP TRAINING DATABASE
-- ============================================================================

create table shop_training_items (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  content_html          text,
  sort_order            integer not null default 0,
  visible_to_training   boolean not null default false,
  created_by            uuid references profiles(id),
  created_at            timestamptz not null default now(),
  updated_by            uuid references profiles(id),
  updated_at            timestamptz not null default now()
);
create trigger trg_shop_training_items_updated_at before update on shop_training_items
  for each row execute function set_updated_at();

-- ============================================================================
-- 4. QUIZ BANK, STUDY LOG, QUIZ ATTEMPTS
-- ============================================================================

create table quiz_questions (
  id              uuid primary key default gen_random_uuid(),
  group_key       text not null check (group_key in ('drink','tea','toppings','others','shop_training')),
  category_id     uuid references formula_categories(id) on delete set null, -- only for group_key='drink'
  formula_item_id uuid references formula_items(id) on delete cascade,        -- source item (nullable if shop_training)
  shop_training_item_id uuid references shop_training_items(id) on delete cascade,
  question        text not null,
  choices         jsonb not null default '[]',   -- [{"key":"A","text":"..."}, ...]
  correct_choice  text not null,                  -- key matching one of `choices`
  importance      smallint not null default 2 check (importance in (1,2,3)), -- 1 = most important
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_quiz_questions_updated_at before update on quiz_questions
  for each row execute function set_updated_at();

create table quiz_question_stores (
  question_id uuid not null references quiz_questions(id) on delete cascade,
  store_id    uuid not null references stores(id) on delete cascade,
  primary key (question_id, store_id)
);

-- Singleton-ish settings row (one per store, or store_id null = global default)
create table quiz_settings (
  store_id            uuid primary key references stores(id) on delete cascade,
  question_count      integer not null default 10,
  importance_ratio    jsonb not null default '{"1":50,"2":30,"3":20}'  -- percentages
);

-- "Memorized" checkbox per staff member per formula item.
create table study_progress (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  formula_item_id uuid not null references formula_items(id) on delete cascade,
  memorized       boolean not null default false,
  memorized_at    timestamptz,
  updated_by      uuid references profiles(id),   -- supports admin bulk-select on behalf of staff
  unique (profile_id, formula_item_id)
);

create table quiz_attempts (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references profiles(id) on delete cascade,
  store_id        uuid references stores(id),
  taken_at        timestamptz not null default now(),
  total_questions integer not null,
  correct_count   integer not null
);

create table quiz_attempt_answers (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references quiz_attempts(id) on delete cascade,
  question_id     uuid references quiz_questions(id) on delete set null,
  selected_choice text,
  is_correct      boolean not null
);

-- ============================================================================
-- 5. BULLETIN BOARD (announcements) + ROSTER (schedule) publishing
-- ============================================================================

create table announcements (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  title         text not null,
  content_html  text,
  is_important  boolean not null default false,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now()
);
create trigger trg_announcements_updated_at before update on announcements
  for each row execute function set_updated_at();

create table announcement_history (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references announcements(id) on delete cascade,
  action          text not null check (action in ('created','edited','marked_important','unmarked_important')),
  actor_id        uuid references profiles(id),
  acted_at        timestamptz not null default now()
);

-- ============================================================================
-- 6. ROSTER HUB
-- ============================================================================

create table roster_periods (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references stores(id) on delete cascade,
  week_start_date date not null,
  week_end_date   date not null,       -- always week_start_date + 6
  status          text not null default 'draft' check (status in ('draft','submitted')),
  notes           text,
  source_file_path text,               -- the uploaded Excel this roster came from
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  unique (store_id, week_start_date, created_at)  -- allows re-saving iterations; app queries "latest per week"
);

create table roster_entries (
  id                uuid primary key default gen_random_uuid(),
  roster_period_id  uuid not null references roster_periods(id) on delete cascade,
  profile_id        uuid references profiles(id) on delete set null,
  staff_name_raw    text,              -- fallback if the Excel row didn't match a profile
  work_date         date not null,
  start_time        time,
  end_time          time,
  notes             text
);

-- Minimum staffing rule per weekday + time slot. required_counts_raw stores
-- the comma-separated numbers exactly as entered (e.g. "2,3" = acceptable
-- staffing levels); required_min is the parsed minimum used for the
-- understaffed warning in Manage Roster.
create table roster_staffing_rules (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references stores(id) on delete cascade,
  weekday             smallint not null check (weekday between 0 and 6), -- 0=Sunday
  time_slot_label     text not null,     -- e.g. "09:00-13:00"
  time_slot_start     time not null,
  time_slot_end       time not null,
  required_counts_raw text not null,     -- e.g. "2,3"
  required_min        integer not null
);

create table leave_requests (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  store_id      uuid not null references stores(id) on delete cascade,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  reason        text,
  status        text not null default 'active' check (status in ('active','cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_leave_requests_updated_at before update on leave_requests
  for each row execute function set_updated_at();

-- ============================================================================
-- 7. FILE REPOSITORY (Admin Center)
-- ============================================================================

create table file_repository (
  id              uuid primary key default gen_random_uuid(),
  category        text not null,          -- e.g. 'food_safety','tfn_template','super_template','parent_consent_template','other'
  display_name    text not null,
  file_path       text not null,
  uploaded_by     uuid references profiles(id),
  uploaded_at     timestamptz not null default now()
);

-- ============================================================================
-- 8. SYSTEM SETTINGS
-- ============================================================================

create table system_settings (
  key           text primary key,
  value         jsonb not null,
  updated_at    timestamptz not null default now()
);

-- ============================================================================
-- 9. Auth bootstrap trigger: create a blank profile row whenever a new
--    auth.users row is created (Admin still fills in role/store afterwards
--    via User Management).
-- ============================================================================
create or replace function handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, role, email)
  values (new.id, 'staff', new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ============================================================================
-- 10. Row Level Security
-- ============================================================================
-- Helper functions used throughout the policies below.

create or replace function current_role_key()
returns text language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_store_ids()
returns uuid[] language sql stable security definer as $$
  select coalesce(array_agg(store_id), '{}')
  from (
    select primary_store_id as store_id from profiles where id = auth.uid() and primary_store_id is not null
    union
    select store_id from user_stores where profile_id = auth.uid()
  ) s;
$$;

create or replace function is_admin()
returns boolean language sql stable security definer as $$
  select current_role_key() = 'admin';
$$;

create or replace function is_manager_or_admin()
returns boolean language sql stable security definer as $$
  select current_role_key() in ('admin','shop_manager');
$$;

alter table stores enable row level security;
alter table profiles enable row level security;
alter table user_stores enable row level security;
alter table permission_overrides enable row level security;
alter table training_codes enable row level security;
alter table user_documents enable row level security;
alter table formula_categories enable row level security;
alter table formula_items enable row level security;
alter table formula_item_stores enable row level security;
alter table ingredient_master enable row level security;
alter table ingredient_format_rules enable row level security;
alter table formula_item_ingredients enable row level security;
alter table formula_item_steps enable row level security;
alter table shop_training_items enable row level security;
alter table quiz_questions enable row level security;
alter table quiz_question_stores enable row level security;
alter table quiz_settings enable row level security;
alter table study_progress enable row level security;
alter table quiz_attempts enable row level security;
alter table quiz_attempt_answers enable row level security;
alter table announcements enable row level security;
alter table announcement_history enable row level security;
alter table roster_periods enable row level security;
alter table roster_entries enable row level security;
alter table roster_staffing_rules enable row level security;
alter table leave_requests enable row level security;
alter table file_repository enable row level security;
alter table system_settings enable row level security;

-- Everyone authenticated can read reference/formula content; write access
-- is restricted to admin (formula/quiz/training content is centrally
-- managed per the spec). Store-scoped operational data (roster, leave,
-- announcements) is restricted to the user's own store(s).

create policy "read stores" on stores for select using (auth.role() = 'authenticated');
create policy "admin manage stores" on stores for all using (is_admin()) with check (is_admin());

create policy "read own or same-store profiles" on profiles for select using (
  id = auth.uid() or is_manager_or_admin()
);
create policy "update own profile" on profiles for update using (id = auth.uid() or is_manager_or_admin());
create policy "admin insert profiles" on profiles for insert with check (is_admin());
create policy "admin delete profiles" on profiles for delete using (is_admin());

create policy "admin manage user_stores" on user_stores for all using (is_admin()) with check (is_admin());
create policy "read own user_stores" on user_stores for select using (profile_id = auth.uid() or is_admin());

create policy "admin manage permission_overrides" on permission_overrides for all using (is_admin()) with check (is_admin());
create policy "read own permission_overrides" on permission_overrides for select using (profile_id = auth.uid() or is_admin());

create policy "manager admin manage training_codes" on training_codes for all using (is_manager_or_admin()) with check (is_manager_or_admin());
create policy "read training_codes same store" on training_codes for select using (store_id = any(current_store_ids()) or is_admin());

create policy "read own documents" on user_documents for select using (profile_id = auth.uid() or is_manager_or_admin());
create policy "manage own documents" on user_documents for insert with check (profile_id = auth.uid() or is_manager_or_admin());
create policy "delete own documents" on user_documents for delete using (profile_id = auth.uid() or is_admin());

create policy "read formula_categories" on formula_categories for select using (auth.role() = 'authenticated');
create policy "admin write formula_categories" on formula_categories for all using (is_admin()) with check (is_admin());

create policy "read formula_items" on formula_items for select using (auth.role() = 'authenticated');
create policy "admin write formula_items" on formula_items for all using (is_admin()) with check (is_admin());

create policy "read formula_item_stores" on formula_item_stores for select using (auth.role() = 'authenticated');
create policy "admin write formula_item_stores" on formula_item_stores for all using (is_admin()) with check (is_admin());

create policy "read ingredient_master" on ingredient_master for select using (auth.role() = 'authenticated');
create policy "admin write ingredient_master" on ingredient_master for all using (is_admin()) with check (is_admin());

create policy "read ingredient_format_rules" on ingredient_format_rules for select using (auth.role() = 'authenticated');
create policy "admin write ingredient_format_rules" on ingredient_format_rules for all using (is_admin()) with check (is_admin());

create policy "read formula_item_ingredients" on formula_item_ingredients for select using (auth.role() = 'authenticated');
create policy "admin write formula_item_ingredients" on formula_item_ingredients for all using (is_admin()) with check (is_admin());

create policy "read formula_item_steps" on formula_item_steps for select using (auth.role() = 'authenticated');
create policy "admin write formula_item_steps" on formula_item_steps for all using (is_admin()) with check (is_admin());

create policy "read shop_training_items" on shop_training_items for select using (auth.role() = 'authenticated');
create policy "admin write shop_training_items" on shop_training_items for all using (is_admin()) with check (is_admin());

create policy "read quiz_questions" on quiz_questions for select using (auth.role() = 'authenticated');
create policy "admin write quiz_questions" on quiz_questions for all using (is_admin()) with check (is_admin());

create policy "read quiz_question_stores" on quiz_question_stores for select using (auth.role() = 'authenticated');
create policy "admin write quiz_question_stores" on quiz_question_stores for all using (is_admin()) with check (is_admin());

create policy "read quiz_settings" on quiz_settings for select using (auth.role() = 'authenticated');
create policy "admin write quiz_settings" on quiz_settings for all using (is_admin()) with check (is_admin());

create policy "read own study_progress" on study_progress for select using (profile_id = auth.uid() or is_manager_or_admin());
create policy "write own study_progress" on study_progress for all using (profile_id = auth.uid() or is_manager_or_admin())
  with check (profile_id = auth.uid() or is_manager_or_admin());

create policy "read own quiz_attempts" on quiz_attempts for select using (profile_id = auth.uid() or is_manager_or_admin());
create policy "insert own quiz_attempts" on quiz_attempts for insert with check (profile_id = auth.uid() or is_manager_or_admin());

create policy "read own quiz_attempt_answers" on quiz_attempt_answers for select using (
  exists (select 1 from quiz_attempts a where a.id = attempt_id and (a.profile_id = auth.uid() or is_manager_or_admin()))
);
create policy "insert own quiz_attempt_answers" on quiz_attempt_answers for insert with check (
  exists (select 1 from quiz_attempts a where a.id = attempt_id and (a.profile_id = auth.uid() or is_manager_or_admin()))
);

create policy "read same-store announcements" on announcements for select using (store_id = any(current_store_ids()) or is_admin());
create policy "manager admin write announcements" on announcements for all using (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
) with check (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
);

create policy "read announcement_history" on announcement_history for select using (
  exists (select 1 from announcements a where a.id = announcement_id and (a.store_id = any(current_store_ids()) or is_admin()))
);
create policy "insert announcement_history" on announcement_history for insert with check (is_manager_or_admin());

create policy "read same-store roster_periods" on roster_periods for select using (store_id = any(current_store_ids()) or is_admin());
create policy "manager admin write roster_periods" on roster_periods for all using (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
) with check (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
);

create policy "read roster_entries" on roster_entries for select using (
  exists (select 1 from roster_periods p where p.id = roster_period_id and (p.store_id = any(current_store_ids()) or is_admin()))
);
create policy "manager admin write roster_entries" on roster_entries for all using (
  exists (select 1 from roster_periods p where p.id = roster_period_id and (is_manager_or_admin() and p.store_id = any(current_store_ids())) or is_admin())
) with check (
  exists (select 1 from roster_periods p where p.id = roster_period_id and (is_manager_or_admin() and p.store_id = any(current_store_ids())) or is_admin())
);

create policy "read roster_staffing_rules" on roster_staffing_rules for select using (store_id = any(current_store_ids()) or is_admin());
create policy "manager admin write roster_staffing_rules" on roster_staffing_rules for all using (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
) with check (
  (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
);

create policy "read same-store leave_requests" on leave_requests for select using (store_id = any(current_store_ids()) or is_admin());
create policy "insert own leave_requests" on leave_requests for insert with check (
  profile_id = auth.uid() or is_manager_or_admin()
);
create policy "update own or managed leave_requests" on leave_requests for update using (
  profile_id = auth.uid() or (is_manager_or_admin() and store_id = any(current_store_ids())) or is_admin()
);

create policy "read file_repository" on file_repository for select using (auth.role() = 'authenticated');
create policy "admin write file_repository" on file_repository for all using (is_admin()) with check (is_admin());

create policy "admin manage system_settings" on system_settings for all using (is_admin()) with check (is_admin());
create policy "read system_settings" on system_settings for select using (is_admin());

-- ============================================================================
-- 11. Seed data (adjust / delete before go-live)
-- ============================================================================
insert into stores (name, code) values
  ('Example Store 1', 'STORE1');

insert into formula_categories (group_key, name, sort_order, tips_content) values
  ('drink', 'Fruit Tea', 1, '<p>Tips for the Fruit Tea category go here.</p>'),
  ('drink', 'Milk Tea', 2, '<p>Tips for the Milk Tea category go here.</p>');
