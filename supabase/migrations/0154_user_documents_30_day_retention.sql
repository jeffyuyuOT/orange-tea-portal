-- Jeff, 2026-10-29: files uploaded in My Information (TFN / Super / Parent
-- consent, table user_documents + `documents` bucket, folder user-documents/)
-- are kept for 30 days only. A daily pg_cron job removes the storage files
-- (via the delete-storage-files Edge Function, same pg_net pattern as
-- cleanup_profile_storage_files) and deletes the user_documents rows, so
-- Staff Information and PR (which read user_documents live) stop showing
-- the link automatically.

create or replace function public.cleanup_expired_user_documents()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_paths text[];
begin
  select array_agg(id), array_agg(file_path)
    into v_ids, v_paths
  from user_documents
  where uploaded_at < now() - interval '30 days';

  if v_ids is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://rwstojuipeaaqdehqoqw.supabase.co/functions/v1/delete-storage-files',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3c3RvanVpcGVhYXFkZWhxb3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NTcxODgsImV4cCI6MjEwNTEzMzE4OH0.c9N2jlLkTVeT3O_A-LnQDLXALspo6GJ2Ud2NiSE9TgA'
    ),
    body := jsonb_build_object('bucket', 'documents', 'paths', to_jsonb(v_paths))
  );

  delete from user_documents where id = any(v_ids);
end;
$$;

revoke all on function public.cleanup_expired_user_documents() from public, anon, authenticated;

-- 03:30 UTC daily (= 13:30 Brisbane).
select cron.schedule('user-documents-30-day-cleanup', '30 3 * * *', 'select public.cleanup_expired_user_documents();');
