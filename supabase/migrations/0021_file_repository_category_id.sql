-- file_repository.category was a free-text tag matching the frontend's old
-- hardcoded category list. Categories now live in file_repository_categories
-- (0020) and can be freely renamed, so files need to point at a category by
-- its permanent id instead of by that text value — otherwise renaming a
-- category would silently disconnect every file already tagged with its
-- old name.
alter table file_repository add column if not exists category_id uuid references file_repository_categories(id);

-- Backfill from the old text column, using the same fixed ids 0020 seeded
-- the built-in categories with.
update file_repository set category_id = '00000000-0000-0000-0000-000000000001' where category = 'tfn_template' and category_id is null;
update file_repository set category_id = '00000000-0000-0000-0000-000000000002' where category = 'super_template' and category_id is null;
update file_repository set category_id = '00000000-0000-0000-0000-000000000003' where category = 'parent_consent_template' and category_id is null;
update file_repository set category_id = '00000000-0000-0000-0000-000000000004' where category = 'food_safety' and category_id is null;
update file_repository set category_id = '00000000-0000-0000-0000-000000000005' where category = 'training_video' and category_id is null;
update file_repository set category_id = '00000000-0000-0000-0000-000000000006' where category = 'other' and category_id is null;

-- The old `category` text column is left in place (the app no longer reads
-- or writes it from here on) rather than dropped, so nothing is lost for
-- any row that didn't match one of the fixed categories above.
