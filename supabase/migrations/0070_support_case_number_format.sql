-- Jeff, 2026-09: case numbers should encode which store + which day a
-- Support request came from, not just an incrementing global counter —
-- e.g. Sunnybank's (store code BNE01) first request today is
-- "BNE0120260929" (code + YYYYMMDD). A second request from the same store
-- on the same day gets a numeric suffix appended ("BNE012026092902"... no —
-- literally the base string with "2" appended: "BNE01202609292"), a third
-- gets "3", and so on. No existing support_requests rows yet (table just
-- shipped in 0069, nothing submitted through it in production), so this is
-- a clean column-type change with no backfill needed.

-- Drop order matters: the column's default expression is what's referencing
-- the sequence, so the default has to go first — dropping the sequence
-- while the default still calls it fails with "cannot drop sequence ...
-- because other objects depend on it" (2BP01), which is what happened when
-- this was run with the two statements the other way around.
alter table support_requests alter column case_number drop default;
drop sequence if exists support_case_number_seq;

alter table support_requests alter column case_number type text using case_number::text;

-- Computed server-side (not client-set) so two people can't race each
-- other into picking the same number, and so the format stays consistent
-- regardless of what the client sends. Scoped to (store_id, that day): the
-- "day" is the date this request is being created on, not created_at itself
-- (which doesn't exist yet at BEFORE INSERT time unless the client sets it).
create or replace function generate_support_case_number()
returns trigger language plpgsql as $$
declare
  v_store_code text;
  v_base text;
  v_count int;
begin
  select code into v_store_code from stores where id = new.store_id;
  v_base := coalesce(v_store_code, 'XXX') || to_char(current_date, 'YYYYMMDD');

  -- How many requests this store already has today (matched by prefix,
  -- since the first one for a store+day has no numeric suffix at all).
  select count(*) into v_count
  from support_requests
  where store_id = new.store_id
    and case_number like (v_base || '%');

  new.case_number := case when v_count = 0 then v_base else v_base || (v_count + 1)::text end;
  return new;
end;
$$;

drop trigger if exists trg_generate_support_case_number on support_requests;
create trigger trg_generate_support_case_number
  before insert on support_requests
  for each row execute function generate_support_case_number();
