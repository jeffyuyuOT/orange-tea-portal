-- Fixes "new row violates row-level security policy" when uploading files
-- in File Repository (admin-center) and My Information (staff documents).
--
-- Root cause: both pages upload into the `documents` Storage bucket via
-- supabase.storage.from('documents').upload(...). Storage objects live in
-- storage.objects, which has row level security ON by default in every
-- Supabase project. 0001_init.sql added RLS policies for every app table
-- (file_repository, user_documents, ...) but never added any policies for
-- storage.objects itself — so with zero policies, every insert (upload) is
-- rejected by the default-deny behaviour of RLS, regardless of user role.
--
-- This migration creates the bucket if it doesn't already exist and adds
-- storage.objects policies that mirror the existing table-level rules:
--   - repository/...            -> file_repository ("admin write ... for all using (is_admin())")
--   - user-documents/<uid>/...  -> user_documents  ("manage own documents" / "delete own documents")

-- Bucket must be public because the app reads files back with
-- supabase.storage.from('documents').getPublicUrl(...) (an unsigned URL,
-- which only resolves for a public bucket).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = true;

-- Any signed-in user can read/list objects in this bucket (the bucket is
-- also public, but this covers .list()/.download() calls that still go
-- through RLS).
create policy "read documents bucket"
on storage.objects for select
using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- Admin-managed shared File Repository, path: repository/<category>/<file>
create policy "admin write file repository objects"
on storage.objects for insert
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'repository'
  and is_admin()
);

create policy "admin update file repository objects"
on storage.objects for update
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'repository'
  and is_admin()
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'repository'
  and is_admin()
);

create policy "admin delete file repository objects"
on storage.objects for delete
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'repository'
  and is_admin()
);

-- Staff's own personal documents, path: user-documents/<profile_id>/<file>
create policy "write own documents objects"
on storage.objects for insert
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'user-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or is_manager_or_admin())
);

create policy "update own documents objects"
on storage.objects for update
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'user-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or is_manager_or_admin())
)
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'user-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or is_manager_or_admin())
);

create policy "delete own documents objects"
on storage.objects for delete
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = 'user-documents'
  and ((storage.foldername(name))[2] = auth.uid()::text or is_admin())
);
