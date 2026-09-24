-- The 'documents' storage bucket's admin-write policies are scoped by the
-- object path's first folder segment (see 0020/0022's 'repository' and
-- 'announcements' policies) -- Shop Training's new shop-training/... uploads
-- need their own matching set, since none of the existing policies'
-- foldername checks match 'shop-training'. That's why saving a Shop Training
-- item with an attached file hit "new row violates row-level security
-- policy" even for an admin. (Read already works: "read documents bucket"
-- is unscoped for any authenticated user, so no new select policy needed.)
create policy "admin write shop training objects" on storage.objects
  for insert
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'shop-training' and is_admin());

create policy "admin update shop training objects" on storage.objects
  for update
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'shop-training' and is_admin())
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = 'shop-training' and is_admin());

create policy "admin delete shop training objects" on storage.objects
  for delete
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = 'shop-training' and is_admin());
