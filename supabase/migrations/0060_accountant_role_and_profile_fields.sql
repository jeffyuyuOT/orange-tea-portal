-- Four small additions bundled into one migration, all from the same
-- request (see handoff point 75):
--
-- 1. profiles gains address + banking columns (bank_account_name, bsb,
--    account_number) for My Information / Staff Information's new shared
--    fields, plus a cash_in_hand flag settable from Admin Center > User
--    Management (UserDetailModal.jsx).
-- 2. A new 'accountant' role. Its page access (permissions.js's
--    ROLE_DEFAULTS.accountant) is client-side-only, same as every other
--    role's page set — but "only staff who are NOT cash_in_hand" is
--    enforced here too, not just client-side: accountant_visible_profile()
--    gates the same `profiles`/`user_documents` rows Staff Information's
--    queries already read, so a cash-in-hand staff member's embedded
--    profile comes back null to an accountant viewer wherever Staff
--    Information joins through it (StaffListPage.jsx already drops a
--    null-profile row when it filters staffRows, so nothing else needs to
--    change there) and their TFN/super/parent-consent uploads stay
--    unreadable to that role too. Accountant is otherwise view-only in the
--    app (StaffDetailModal.jsx disables every input for that role), so no
--    UPDATE/INSERT grant is added here — only the two SELECT policies it
--    actually needs.

alter table profiles add column if not exists address text;
alter table profiles add column if not exists bank_account_name text;
alter table profiles add column if not exists bsb text;
alter table profiles add column if not exists account_number text;
alter table profiles add column if not exists cash_in_hand boolean not null default false;

alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role = any (array['admin', 'shop_manager', 'staff', 'training', 'qr_code_maker', 'developer', 'accountant']));

alter table pending_staff drop constraint pending_staff_role_check;
alter table pending_staff add constraint pending_staff_role_check
  check (role = any (array['admin', 'shop_manager', 'staff', 'training', 'qr_code_maker', 'developer', 'accountant']));

create or replace function is_accountant()
returns boolean language sql stable security definer as $$
  select current_role_key() = 'accountant';
$$;

-- True when the CURRENT user is an accountant AND target_profile is not
-- marked cash_in_hand. Used below in place of is_manager_or_admin() so the
-- accountant role gets exactly the read access it's meant to have — scoped
-- per staff member (not per store, unlike most is_manager_or_admin()
-- policies), since "not cash-in-hand" is a property of the person, not of
-- a store.
create or replace function accountant_visible_profile(target_profile uuid)
returns boolean language sql stable security definer as $$
  select is_accountant() and exists (
    select 1 from profiles p where p.id = target_profile and coalesce(p.cash_in_hand, false) = false
  );
$$;

drop policy "read own or same-store profiles" on profiles;
create policy "read own or same-store profiles" on profiles for select using (
  id = auth.uid() or is_manager_or_admin() or accountant_visible_profile(id)
);

create policy "accountant read non-cash-in-hand documents" on user_documents
  for select using (accountant_visible_profile(profile_id));
