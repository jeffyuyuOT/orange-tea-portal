-- Multiple vote questions per announcement (each with its own options + max choices).
-- Replaces set_vote_options with set_vote_questions; get_vote_results / cast_vote reworked.
-- (Already applied via MCP on 2026-11-07; keep this file so the repo matches the database.)
delete from public.announcement_votes;
delete from public.announcement_vote_options;

create table if not exists public.announcement_vote_questions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  title text not null default '',
  max_choices integer not null default 1 check (max_choices between 1 and 50),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists announcement_vote_questions_ann_idx on public.announcement_vote_questions(announcement_id);
alter table public.announcement_vote_questions enable row level security;

alter table public.announcement_vote_options
  add column if not exists question_id uuid references public.announcement_vote_questions(id) on delete cascade;
alter table public.announcement_vote_options alter column question_id set not null;

drop function if exists public.set_vote_options(uuid, jsonb);
drop function if exists public.get_vote_results(uuid);

-- p_questions = [{"id": uuid|null, "title": text, "max": int, "options": [{"id": uuid|null, "label": text}]}]
create or replace function public.set_vote_questions(p_announcement_id uuid, p_questions jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_type text;
  q jsonb;
  o jsonb;
  qi integer := 0;
  oi integer;
  v_qid uuid;
  v_oid uuid;
  v_label text;
  v_keep_q uuid[] := '{}';
  v_keep_o uuid[] := '{}';
  v_nopts integer;
begin
  select created_by, announcement_type into v_creator, v_type
  from announcements where id = p_announcement_id;
  if v_type is null then raise exception 'Announcement not found'; end if;
  if v_type <> 'vote' then raise exception 'Not a vote announcement'; end if;
  if not (v_creator = auth.uid() or is_admin()) then raise exception 'Not authorized'; end if;

  for q in select * from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    select count(*) into v_nopts
    from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) x
    where trim(coalesce(x->>'label', '')) <> '';
    if v_nopts = 0 then continue; end if;

    qi := qi + 1;
    v_qid := nullif(q->>'id', '')::uuid;
    if v_qid is not null and exists (
      select 1 from announcement_vote_questions where id = v_qid and announcement_id = p_announcement_id
    ) then
      update announcement_vote_questions
      set title = trim(coalesce(q->>'title', '')),
          max_choices = least(greatest(coalesce((q->>'max')::int, 1), 1), v_nopts),
          sort_order = qi
      where id = v_qid;
    else
      insert into announcement_vote_questions (announcement_id, title, max_choices, sort_order)
      values (p_announcement_id, trim(coalesce(q->>'title', '')),
              least(greatest(coalesce((q->>'max')::int, 1), 1), v_nopts), qi)
      returning id into v_qid;
    end if;
    v_keep_q := v_keep_q || v_qid;

    oi := 0;
    for o in select * from jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) loop
      v_label := trim(coalesce(o->>'label', ''));
      if v_label = '' then continue; end if;
      oi := oi + 1;
      v_oid := nullif(o->>'id', '')::uuid;
      if v_oid is not null and exists (
        select 1 from announcement_vote_options where id = v_oid and question_id = v_qid
      ) then
        update announcement_vote_options set label = v_label, sort_order = oi where id = v_oid;
      else
        insert into announcement_vote_options (announcement_id, question_id, label, sort_order)
        values (p_announcement_id, v_qid, v_label, oi) returning id into v_oid;
      end if;
      v_keep_o := v_keep_o || v_oid;
    end loop;
  end loop;

  delete from announcement_vote_options
  where announcement_id = p_announcement_id and id <> all (v_keep_o);
  delete from announcement_vote_questions
  where announcement_id = p_announcement_id and id <> all (v_keep_q);
end;
$$;

create or replace function public.get_vote_results(p_announcement_id uuid)
returns table (
  question_id uuid, question_title text, question_max integer, question_sort integer,
  option_id uuid, label text, option_sort integer, vote_count bigint, voted boolean
)
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
  select q.id, q.title, q.max_choices, q.sort_order,
         o.id, o.label, o.sort_order,
         (select count(*) from announcement_votes v where v.option_id = o.id),
         exists (select 1 from announcement_votes v where v.option_id = o.id and v.profile_id = auth.uid())
  from announcement_vote_questions q
  join announcement_vote_options o on o.question_id = q.id
  where q.announcement_id = p_announcement_id
  order by q.sort_order, q.created_at, o.sort_order, o.created_at;
end;
$$;

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
  v_ids uuid[];
  v_bad record;
begin
  select store_id, announcement_type, vote_deadline
  into v_store, v_type, v_deadline
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

  select q.title, q.max_choices into v_bad
  from announcement_vote_questions q
  join announcement_vote_options o on o.question_id = q.id
  where o.id = any (v_ids)
  group by q.id, q.title, q.max_choices
  having count(*) > q.max_choices
  limit 1;
  if found then
    raise exception 'You can choose at most % option(s) for "%"', v_bad.max_choices, v_bad.title;
  end if;

  delete from announcement_votes where announcement_id = p_announcement_id and profile_id = auth.uid();
  insert into announcement_votes (option_id, announcement_id, profile_id)
  select unnest(v_ids), p_announcement_id, auth.uid();
end;
$$;

grant execute on function public.set_vote_questions(uuid, jsonb) to authenticated;
grant execute on function public.get_vote_results(uuid) to authenticated;
grant execute on function public.cast_vote(uuid, uuid[]) to authenticated;
