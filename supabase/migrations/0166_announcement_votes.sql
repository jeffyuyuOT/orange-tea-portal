-- Bulletin "vote" announcements.
--   announcements.announcement_type : 'normal' | 'vote'
--   announcements.vote_deadline     : optional; no votes accepted after it
--   announcements.vote_max_choices  : max options one user may tick
-- Options and votes are only reachable through the RPCs below (RLS on, no
-- direct policies), so the deadline / max-choices rules can't be bypassed.

alter table public.announcements
  add column if not exists announcement_type text not null default 'normal',
  add column if not exists vote_deadline timestamptz,
  add column if not exists vote_max_choices integer not null default 1;

alter table public.announcements drop constraint if exists announcements_type_check;
alter table public.announcements
  add constraint announcements_type_check check (announcement_type in ('normal', 'vote'));
alter table public.announcements drop constraint if exists announcements_vote_max_check;
alter table public.announcements
  add constraint announcements_vote_max_check check (vote_max_choices between 1 and 50);

create table if not exists public.announcement_vote_options (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists announcement_vote_options_ann_idx on public.announcement_vote_options(announcement_id);

create table if not exists public.announcement_votes (
  option_id uuid not null references public.announcement_vote_options(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (option_id, profile_id)
);
create index if not exists announcement_votes_ann_idx on public.announcement_votes(announcement_id);

alter table public.announcement_vote_options enable row level security;
alter table public.announcement_votes enable row level security;

-- Creator / admin: replace the option list. p_options = [{"id": uuid|null, "label": text}, ...]
-- in display order. Options missing from the list are deleted (their votes go too).
create or replace function public.set_vote_options(p_announcement_id uuid, p_options jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_type text;
  v_item jsonb;
  v_idx integer := 0;
  v_id uuid;
  v_label text;
  v_keep uuid[] := '{}';
begin
  select created_by, announcement_type into v_creator, v_type
  from announcements where id = p_announcement_id;
  if v_type is null then raise exception 'Announcement not found'; end if;
  if v_type <> 'vote' then raise exception 'Not a vote announcement'; end if;
  if not (v_creator = auth.uid() or is_admin()) then
    raise exception 'Not authorized';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    v_label := trim(coalesce(v_item->>'label', ''));
    if v_label = '' then continue; end if;
    v_idx := v_idx + 1;
    v_id := nullif(v_item->>'id', '')::uuid;
    if v_id is not null and exists (
      select 1 from announcement_vote_options where id = v_id and announcement_id = p_announcement_id
    ) then
      update announcement_vote_options set label = v_label, sort_order = v_idx where id = v_id;
    else
      insert into announcement_vote_options (announcement_id, label, sort_order)
      values (p_announcement_id, v_label, v_idx) returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;

  delete from announcement_vote_options
  where announcement_id = p_announcement_id and id <> all (v_keep);
end;
$$;

-- Anyone who can see the announcement: options + live counts + which ones I ticked.
create or replace function public.get_vote_results(p_announcement_id uuid)
returns table (option_id uuid, label text, sort_order integer, vote_count bigint, voted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store uuid;
begin
  select store_id into v_store from announcements where id = p_announcement_id;
  if v_store is null then raise exception 'Announcement not found'; end if;
  if not (v_store = any (current_store_ids()) or is_admin()) then
    raise exception 'Not authorized for this store';
  end if;

  return query
  select o.id, o.label, o.sort_order,
         (select count(*) from announcement_votes v where v.option_id = o.id),
         exists (select 1 from announcement_votes v where v.option_id = o.id and v.profile_id = auth.uid())
  from announcement_vote_options o
  where o.announcement_id = p_announcement_id
  order by o.sort_order, o.created_at;
end;
$$;

-- Replaces the caller's ticks with p_option_ids. Rejected after the deadline
-- or when more than vote_max_choices are ticked.
create or replace function public.cast_vote(p_announcement_id uuid, p_option_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
  v_type text;
  v_deadline timestamptz;
  v_max integer;
  v_ids uuid[];
begin
  select store_id, announcement_type, vote_deadline, vote_max_choices
  into v_store, v_type, v_deadline, v_max
  from announcements where id = p_announcement_id;
  if v_type is null then raise exception 'Announcement not found'; end if;
  if v_type <> 'vote' then raise exception 'Not a vote announcement'; end if;
  if not (v_store = any (current_store_ids()) or is_admin()) then
    raise exception 'Not authorized for this store';
  end if;
  if v_deadline is not null and now() > v_deadline then
    raise exception 'Voting has closed';
  end if;

  select coalesce(array_agg(distinct id), '{}') into v_ids
  from announcement_vote_options
  where announcement_id = p_announcement_id and id = any (coalesce(p_option_ids, '{}'));

  if coalesce(array_length(v_ids, 1), 0) > v_max then
    raise exception 'You can choose at most % option(s)', v_max;
  end if;

  delete from announcement_votes where announcement_id = p_announcement_id and profile_id = auth.uid();
  insert into announcement_votes (option_id, announcement_id, profile_id)
  select unnest(v_ids), p_announcement_id, auth.uid();
end;
$$;

grant execute on function public.set_vote_options(uuid, jsonb) to authenticated;
grant execute on function public.get_vote_results(uuid) to authenticated;
grant execute on function public.cast_vote(uuid, uuid[]) to authenticated;
