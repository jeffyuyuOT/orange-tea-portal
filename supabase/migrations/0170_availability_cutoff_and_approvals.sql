-- Jeff, 2026-11-27: "roster hub的setting裡的Message reminder改成Availability
-- Cut-off Settings，改成禮拜幾跟幾點。設定的時間為其他員工變更下週available
-- time的deadline，超過以後員工就沒辦法自己更改available time，要改的話要經過
-- manager同意。員工在兩個情況就不能自行更改available time：第一要更改的時間
-- 的班表已submit (leave也一樣)。第二是登記下禮拜available time過了這禮拜的
-- cut off deadline。...還有一欄是指定一個user (manager以上權限)，如果超過
-- deadline，員工要更改時間需要經過誰的approved。...原本的message reminder就改
-- 成deadline的前一天員工收到通知。leave limit那邊新增勾選員工變更或申請leave
-- 收到通知"
--
-- 1) stores: cut-off weekday + time (Brisbane) and the designated approver.
--    Existing stores start with cut-off = the day AFTER their old reminder day
--    (reminder was "the day before the deadline" in the new design), 11:59 PM.
-- 2) leave_limit_defaults.notify_approver_on_leave: Leave limits tab checkbox.
-- 3) schedule_change_requests: a staff member's availability / leave change
--    that needs the approver's OK; decide_schedule_change() applies it.
-- 4) send_next_week_availability_reminders(): now fires the day BEFORE each
--    store's cut-off (still the daily 9am Brisbane cron job from 0129).

alter table stores
  add column if not exists availability_cutoff_weekday smallint check (availability_cutoff_weekday between 0 and 6),
  add column if not exists availability_cutoff_time time not null default '23:59',
  add column if not exists availability_approver_id uuid references profiles(id) on delete set null;

update stores
set availability_cutoff_weekday = (availability_reminder_weekday + 1) % 7
where availability_cutoff_weekday is null;

alter table stores alter column availability_cutoff_weekday set default 5;
alter table stores alter column availability_cutoff_weekday set not null;

-- Same shape as set_availability_reminder_weekday (0151): stores can only be
-- written by admin/developer, so a shop manager goes through this one narrow
-- function, which only touches the three cut-off columns.
create or replace function set_availability_cutoff(
  p_store_id uuid,
  p_weekday smallint,
  p_time time,
  p_approver uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_weekday is null or p_weekday < 0 or p_weekday > 6 then
    raise exception 'Weekday must be 0 (Sunday) to 6 (Saturday)';
  end if;
  if p_time is null then
    raise exception 'Please pick a cut-off time';
  end if;
  if not (is_admin() or current_role_key() = 'developer'
          or (current_role_key() = 'shop_manager' and p_store_id = any (current_store_ids()))) then
    raise exception 'You do not have permission to change this store''s cut-off settings';
  end if;
  if p_approver is not null and not exists (
    select 1 from profiles where id = p_approver and is_active and role in ('admin', 'shop_manager', 'developer')
  ) then
    raise exception 'The approver must be an active manager, admin or developer';
  end if;
  update stores
  set availability_cutoff_weekday = p_weekday,
      availability_cutoff_time = p_time,
      availability_approver_id = p_approver
  where id = p_store_id;
  if not found then
    raise exception 'Store not found';
  end if;
end;
$$;

revoke all on function set_availability_cutoff(uuid, smallint, time, uuid) from public;
revoke all on function set_availability_cutoff(uuid, smallint, time, uuid) from anon;
grant execute on function set_availability_cutoff(uuid, smallint, time, uuid) to authenticated;

alter table leave_limit_defaults
  add column if not exists notify_approver_on_leave boolean not null default false;

-- ---------------------------------------------------------------------------
create table if not exists schedule_change_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  requester_name text not null default '',
  approver_id uuid references profiles(id) on delete set null,
  kind text not null check (kind in ('availability', 'leave_new', 'leave_edit')),
  -- why this needed approval: past the weekly cut-off, or that week's roster is already submitted
  reason_code text not null check (reason_code in ('cutoff', 'roster_submitted')),
  week_start_date date,
  title text not null,
  -- array of plain-text lines shown in the approver's popup ("Mon 3 Nov: All day available → Before 2:00 PM")
  details jsonb not null default '[]'::jsonb,
  -- what to apply on approval (shape depends on kind, see decide_schedule_change)
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_schedule_change_requests_approver on schedule_change_requests(approver_id, status);
create index if not exists idx_schedule_change_requests_profile on schedule_change_requests(profile_id, status);

alter table schedule_change_requests enable row level security;

create policy "read own, assigned or managed schedule_change_requests" on schedule_change_requests
  for select using (
    profile_id = auth.uid()
    or approver_id = auth.uid()
    or is_admin()
    or (is_manager_or_admin() and store_id = any (current_store_ids()))
  );

create policy "insert own pending schedule_change_requests" on schedule_change_requests
  for insert with check (
    profile_id = auth.uid() and status = 'pending' and store_id = any (current_store_ids())
  );

-- The requester can only withdraw (cancel) their own still-pending request;
-- approving / rejecting goes through decide_schedule_change() below.
create policy "cancel own pending schedule_change_requests" on schedule_change_requests
  for update
  using (profile_id = auth.uid() and status = 'pending')
  with check (profile_id = auth.uid() and status in ('pending', 'cancelled'));

create or replace function decide_schedule_change(p_id uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r schedule_change_requests%rowtype;
  d_key text;
  d_val jsonb;
  w jsonb;
  sid text;
  new_day_id uuid;
  msg_id uuid;
  subj text;
  safe_title text;
begin
  select * into r from schedule_change_requests where id = p_id for update;
  if not found then
    raise exception 'Request not found';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %', r.status;
  end if;
  if not (is_admin() or current_role_key() = 'developer' or r.approver_id = auth.uid()) then
    raise exception 'You are not allowed to decide this request';
  end if;

  if p_approve then
    if r.kind = 'availability' then
      -- Same wipe-and-rewrite the app's saveWeekAvailability() does.
      delete from availability_windows
      where availability_day_id in (
        select id from availability_days where profile_id = r.profile_id and week_start_date = r.week_start_date
      );
      delete from availability_days where profile_id = r.profile_id and week_start_date = r.week_start_date;

      for d_key, d_val in select key, value from jsonb_each(r.payload -> 'days') loop
        if d_val ->> 'mode' = 'all_available' then
          continue;
        end if;
        insert into availability_days (profile_id, week_start_date, entry_date, mode, boundary_time)
        values (
          r.profile_id,
          r.week_start_date,
          d_key::date,
          d_val ->> 'mode',
          case when d_val ->> 'mode' in ('before', 'after') then nullif(d_val ->> 'boundaryTime', '')::time else null end
        )
        returning id into new_day_id;

        if d_val ->> 'mode' = 'custom' then
          for w in select * from jsonb_array_elements(coalesce(d_val -> 'windows', '[]'::jsonb)) loop
            if coalesce(w ->> 'start', '') <> '' and coalesce(w ->> 'end', '') <> ''
               and (w ->> 'end')::time > (w ->> 'start')::time then
              insert into availability_windows (availability_day_id, start_time, end_time)
              values (new_day_id, (w ->> 'start')::time, (w ->> 'end')::time);
            end if;
          end loop;
        end if;
      end loop;

    elsif r.kind = 'leave_new' then
      for sid in select jsonb_array_elements_text(r.payload -> 'storeIds') loop
        insert into leave_requests (profile_id, store_id, start_at, end_at, reason)
        values (
          r.profile_id,
          sid::uuid,
          (r.payload ->> 'startAt')::timestamptz,
          (r.payload ->> 'endAt')::timestamptz,
          r.payload ->> 'reason'
        );
      end loop;

    elsif r.kind = 'leave_edit' then
      update leave_requests
      set start_at = (r.payload ->> 'startAt')::timestamptz,
          end_at = (r.payload ->> 'endAt')::timestamptz,
          reason = r.payload ->> 'reason'
      where profile_id = r.profile_id
        and status = 'active'
        and id in (select e::uuid from jsonb_array_elements_text(r.payload -> 'ids') e);
    end if;
  end if;

  update schedule_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_id;

  -- Tell the requester how it went (a real Message, so it also pushes).
  safe_title := replace(replace(r.title, '<', '&lt;'), '>', '&gt;');
  subj := case when p_approve then 'Approved: ' else 'Not approved: ' end || left(r.title, 120);
  insert into messages (store_id, sender_id, sender_name, subject, content_html)
  values (
    r.store_id,
    null,
    'System',
    subj,
    '<p>' || safe_title || case when p_approve then ' — approved. Your change is now in effect.' else ' — your manager did not approve this change, so nothing was changed.' end || '</p>'
  )
  returning id into msg_id;
  insert into message_recipients (message_id, profile_id) values (msg_id, r.profile_id);

  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

revoke all on function decide_schedule_change(uuid, boolean) from public;
revoke all on function decide_schedule_change(uuid, boolean) from anon;
grant execute on function decide_schedule_change(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The daily 9am-Brisbane reminder (cron job 'availability-reminder-daily',
-- migration 0129) now fires the day BEFORE each store's cut-off. Target week
-- = the week whose cut-off is tomorrow: cut-off day D (weekday cw) sits in
-- the week BEFORE the target week, so target Monday = D + 7 - offset(cw),
-- where offset(Mon)=0 ... offset(Sun)=6.
create or replace function send_next_week_availability_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Australia/Brisbane')::date;
  today_dow smallint := extract(dow from (now() at time zone 'Australia/Brisbane'))::smallint;
  rec record;
  target date;
  subj text;
  msg_id uuid;
begin
  for rec in
    select
      p.id as profile_id,
      s.id as store_id,
      s.availability_cutoff_weekday as cw,
      s.availability_cutoff_time as ct
    from profiles p
    join stores s
      on s.id = coalesce(p.primary_store_id, (select us.store_id from user_stores us where us.profile_id = p.id limit 1))
    where p.is_active
      and p.role not in ('training', 'qr_code_maker', 'accountant')
      and p.join_store_activity
      and s.availability_cutoff_weekday = ((today_dow + 1) % 7)
  loop
    target := today + 8 - ((rec.cw + 6) % 7);
    subj := 'Availability deadline tomorrow: week of ' || to_char(target, 'DD Mon YYYY');

    if exists (select 1 from availability_days ad where ad.profile_id = rec.profile_id and ad.week_start_date = target) then
      continue;
    end if;
    if exists (
      select 1
      from message_recipients mr
      join messages m on m.id = mr.message_id
      where mr.profile_id = rec.profile_id and m.subject = subj and m.sender_id is null
    ) then
      continue;
    end if;

    insert into messages (store_id, sender_id, sender_name, subject, content_html)
    values (
      rec.store_id,
      null,
      'System',
      subj,
      '<p>You haven''t entered your availability for the week of ' || to_char(target, 'DD Mon YYYY')
        || ' yet. The deadline is tomorrow (' || to_char(today + 1, 'Dy DD Mon') || ' at ' || to_char(rec.ct, 'HH12:MI AM')
        || '). After that, any change needs your manager''s approval.</p>'
    )
    returning id into msg_id;

    insert into message_recipients (message_id, profile_id) values (msg_id, rec.profile_id);
  end loop;
end;
$$;
