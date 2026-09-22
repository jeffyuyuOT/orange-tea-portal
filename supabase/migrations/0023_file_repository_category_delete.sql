-- File Repository's "Manage categories" now lets an admin delete a
-- category. Deleting one should just leave any files under it
-- uncategorized (the app warns about that first, see FileCategoryManager),
-- not fail outright — so retarget the FK 0021 added from its default
-- RESTRICT action to SET NULL.
--
-- Wrapped so it's a safe no-op whether 0021 has run yet or not, and safe
-- to re-run either way.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'file_repository' and column_name = 'category_id'
  ) then
    alter table file_repository drop constraint if exists file_repository_category_id_fkey;
    alter table file_repository
      add constraint file_repository_category_id_fkey
      foreign key (category_id) references file_repository_categories(id) on delete set null;
  end if;
end $$;
