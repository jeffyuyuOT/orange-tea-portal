-- Performance clean-up of RLS policies (Supabase advisor lints
-- `auth_rls_initplan` and `multiple_permissive_policies`). No access rules change.
--
-- 1) Three pairs of permissive policies on the same table + command are merged
--    into one policy whose condition is the OR of the two. Postgres already ORs
--    permissive policies together, so who can do what is identical; it just
--    evaluates one policy instead of two.
-- 2) Every remaining policy that calls auth.uid() / auth.role() / auth.jwt()
--    directly is rewritten to (select auth.uid()) etc., so Postgres evaluates
--    it once per query instead of once per row. Same value, same result.
--
-- (Postgres stores the wrapped form as "( SELECT auth.uid() AS uid)", so the
-- patterns below match case-insensitively.)
--
-- To undo (2) for a policy, replace "(select auth.uid())" with "auth.uid()".

-- ---- 1) merge duplicates ---------------------------------------------------

drop policy "manager admin read announcement_reads" on public.announcement_reads;
drop policy "read own announcement reads" on public.announcement_reads;
create policy "read announcement_reads" on public.announcement_reads
  for select
  using (
    (profile_id = (select auth.uid()))
    or exists (
      select 1 from announcements a
      where a.id = announcement_reads.announcement_id
        and ((is_manager_or_admin() and a.store_id = any (current_store_ids())) or is_admin())
    )
  );

drop policy "insert own attendance_events" on public.attendance_events;
drop policy "manager insert attendance_events" on public.attendance_events;
create policy "insert attendance_events" on public.attendance_events
  for insert
  with check (
    (profile_id = (select auth.uid()))
    or (can_edit_attendance_logs_check() and store_id = any (current_store_ids()))
  );

drop policy "accountant read non-cash-in-hand documents" on public.user_documents;
drop policy "read own documents" on public.user_documents;
create policy "read user_documents" on public.user_documents
  for select
  using (
    accountant_visible_profile(profile_id)
    or (profile_id = (select auth.uid()))
    or is_manager_or_admin()
  );

-- ---- 2) wrap auth.*() calls so they are evaluated once per query ------------

do $$
declare
  p record;
  new_qual text;
  new_check text;
  stmt text;
  n int := 0;
  left_over int;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(?<!select )auth\.(uid|role|jwt)\(\)'
  loop
    new_qual  := regexp_replace(p.qual,       '(?<!select )auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi');
    new_check := regexp_replace(p.with_check, '(?<!select )auth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'gi');
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then stmt := stmt || format(' using (%s)', new_qual); end if;
    if new_check is not null then stmt := stmt || format(' with check (%s)', new_check); end if;
    execute stmt;
    n := n + 1;
  end loop;

  select count(*) into left_over
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(?<!select )auth\.(uid|role|jwt)\(\)';
  if left_over > 0 then
    raise exception 'RLS rewrite incomplete: % policies still call auth.*() directly', left_over;
  end if;
  raise notice 'rewrote % policies', n;
end
$$;
