-- Uploading a "custom image" for a formula item (Edit Item → Display →
-- Custom image) fails with 403 "new row violates row-level security
-- policy" on storage.objects — the formula-images bucket exists, but
-- whatever RLS policy was set up for it (via the Dashboard, not tracked in
-- these migrations) doesn't cover this upload. Postgres RLS is OR'd across
-- policies, so adding this admin-write policy — using the same is_admin()
-- helper every other write policy in this app uses — opens a path for
-- admins to upload/replace/delete objects in this bucket without touching
-- or needing to know whatever policy is already there.
create policy "admin write formula-images" on storage.objects
for all
using (bucket_id = 'formula-images' and is_admin())
with check (bucket_id = 'formula-images' and is_admin());

-- Public read, so uploaded images actually display on the staff-facing
-- Formula page for every signed-in role, not just admins.
create policy "read formula-images" on storage.objects
for select
using (bucket_id = 'formula-images');
