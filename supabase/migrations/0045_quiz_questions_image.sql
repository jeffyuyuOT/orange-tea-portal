-- Quiz Bank questions can optionally show an image. Images are shared with
-- File Repository rather than uploaded per-question — this column just
-- holds the storage path of a `documents` bucket object (same convention
-- as formula_item_steps.image_path etc: a plain path, looked up with
-- supabase.storage.from('documents').getPublicUrl() at render time, no FK).
alter table quiz_questions add column if not exists image_path text;

-- A dedicated category keeps quiz question images from cluttering the
-- File Repository page's other categories (TFN/Super forms, Food Safety,
-- ...) while still living in the same table/bucket so the same image can
-- be picked and reused across multiple questions instead of re-uploaded.
-- Fixed id so QuestionEditModal's "Upload new image" can file straight
-- into it without a category picker.
insert into file_repository_categories (id, label, sort_order) values
  ('00000000-0000-0000-0000-000000000007', 'Quiz Images', 6)
on conflict (id) do nothing;
