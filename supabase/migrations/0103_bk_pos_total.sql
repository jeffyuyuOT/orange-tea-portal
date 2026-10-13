-- BK follow-up (Jeff, 2026-10-13). Run AFTER 0102_bk_stores_and_ruju_other.sql.
--
-- Sales figure: Total is no longer typed. It is
--     Total = Pos total + Self order kiosk
-- (Pos total = the total printed on the POS report / read from the image; the
-- kiosk orders are not in it). "Sum vs Total" then checks that all the OTHER
-- main payment types add up to that Total, so Pos total itself is a main
-- column that is left out of the sum.
--
-- 1) Every BK store gets a locked main payment type 'Pos total' (typed in,
--    placed after its existing mains; it can be moved, not renamed/disabled).
-- 2) 'Self order kiosk' (the sub under Total Eftpos) becomes locked too, since
--    the Total formula looks it up by name.
-- 3) bk_seed_payment_types() creates both for new stores.
--
-- bk_sf_days.total stays as a column: the page now writes the computed Total
-- into it on every save (so history / reports can still read it).
--
-- Same security model as 0101: RLS = is_developer() (unchanged, no new tables).

-- Stores that already have a 'Pos total' main just get it locked.
update bk_payment_types
   set is_locked = true, is_active = true, updated_at = now()
 where kind = 'main' and name = 'Pos total';

insert into bk_payment_types (store_id, name, kind, is_locked, sort_order)
select s.id,
       'Pos total',
       'main',
       true,
       coalesce((select max(p.sort_order) + 1 from bk_payment_types p where p.store_id = s.id and p.kind = 'main'), 0)
  from bk_stores s
 where not exists (select 1 from bk_payment_types p where p.store_id = s.id and p.name = 'Pos total');

update bk_payment_types
   set is_locked = true, is_active = true, updated_at = now()
 where kind = 'sub' and name = 'Self order kiosk';

create or replace function bk_seed_payment_types(p_store uuid)
returns void language plpgsql as $$
declare
  v_total uuid;
begin
  if exists (select 1 from bk_payment_types where store_id = p_store) then
    return;
  end if;
  insert into bk_payment_types (store_id, name, kind, is_locked, sort_order)
    values (p_store, 'Cash', 'main', true, 0);
  insert into bk_payment_types (store_id, name, kind, is_locked, sort_order)
    values (p_store, 'Total Eftpos', 'main', true, 1)
    returning id into v_total;
  insert into bk_payment_types (store_id, name, kind, sort_order) values
    (p_store, 'Uber Eat', 'main', 2),
    (p_store, 'Doordash', 'main', 3),
    (p_store, 'Fantuan', 'main', 4),
    (p_store, 'Payo', 'main', 5),
    (p_store, 'Panda', 'main', 6);
  insert into bk_payment_types (store_id, name, kind, is_locked, sort_order)
    values (p_store, 'Pos total', 'main', true, 7);
  insert into bk_payment_types (store_id, name, kind, parent_id, sort_order) values
    (p_store, 'POS eftpos', 'sub', v_total, 0);
  insert into bk_payment_types (store_id, name, kind, parent_id, is_locked, sort_order)
    values (p_store, 'Self order kiosk', 'sub', v_total, true, 1);
end;
$$;
