-- Jeff, 2026-10-30: two Store Notice ("announcements") changes.
--
-- 1) "發comment的人要有可以編輯或刪除comment的功能" — announcement_comments
--    (migration 0056) had an INSERT policy and a manager/admin-only
--    DELETE policy, but no UPDATE policy at all (so nobody, not even the
--    comment's own author, could edit one) and no author-level DELETE
--    policy either (only manager/admin could remove a comment). Adds
--    both, scoped to the comment's own author, alongside the existing
--    policies — Postgres RLS policies for the same command are OR'd
--    together, so manager/admin keep their existing moderation-delete
--    rights on top of this.
create policy "author update own announcement_comments" on announcement_comments
  for update using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy "author delete own announcement_comments" on announcement_comments
  for delete using (author_id = auth.uid());

-- 2) "admin可以在notice勾取，將comment併至內文的選項，這樣新增的comment會像
--    是edit的效果一樣直接加在原文裡，但原文不能改，只能插入或加，comment的
--    顏色會比較深，原文比較淺，comment紀錄就留在history裡，只是會變成
--    comment by 誰誰誰" — a per-notice, admin-only toggle
--    (merge_comments_into_content). While it's on, AnnouncementDetail
--    Modal.jsx routes new comments through append_merged_comment() below
--    instead of inserting into announcement_comments: it appends a
--    darker-styled block straight onto content_html (so it visually reads
--    as part of the notice, darker than the original body text, which is
--    left completely untouched) and logs an announcement_history row with
--    action 'commented' instead of 'edited' — that row already renders as
--    "commented by X" with no app-code change, since the History list
--    just does `action.replace('_',' ') + ' by ' + actor_name` and
--    'commented' has no underscore to replace.
--
--    Routed through a SECURITY DEFINER RPC rather than a direct client
--    .update() on announcements, same reasoning as the existing
--    set_complaint_solved() RPC (migration 0056's own comment on it):
--    anyone who can see this notice — not just its creator or a manager/
--    admin — needs to be able to add a merged comment, and the "update
--    announcements" RLS policies (manager/admin at their store, or the
--    post's own creator) don't grant that to an arbitrary OTHER staff
--    member viewing someone else's notice. p_comment is plain text typed
--    into the same comment box as before (not rich HTML like the notice's
--    own authored content), so it's HTML-escaped here before being
--    spliced into content_html — that field renders via
--    dangerouslySetInnerHTML (RichTextViewer.jsx), and this RPC is the
--    one path that puts arbitrary-staff-typed text straight into HTML
--    every viewer's browser runs as markup, so it needs its own escaping
--    rather than relying on React's usual auto-escaping of plain text.
alter table announcements add column if not exists merge_comments_into_content boolean not null default false;

create or replace function append_merged_comment(p_announcement_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_merge_on boolean;
  v_content text;
  v_actor_name text;
  v_escaped text;
  v_block text;
begin
  select store_id, merge_comments_into_content, content_html
  into v_store_id, v_merge_on, v_content
  from announcements where id = p_announcement_id;

  if v_store_id is null then
    raise exception 'Announcement not found';
  end if;
  if not coalesce(v_merge_on, false) then
    raise exception 'Comment-merging is not enabled for this notice';
  end if;
  if not (v_store_id = any (current_store_ids()) or is_admin()) then
    raise exception 'Not authorized for this store';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'Comment cannot be empty';
  end if;

  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  into v_actor_name
  from profiles where id = auth.uid();

  v_escaped := replace(replace(replace(p_comment, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped := replace(v_escaped, chr(10), '<br/>');

  v_block := '<div class="merged-comment" style="color:#111827;font-weight:600;border-left:3px solid #d1d5db;padding-left:0.75rem;margin-top:0.75rem;">'
    || '<div style="font-size:0.75rem;font-weight:400;color:#6b7280;margin-bottom:0.125rem;">'
    || coalesce(nullif(v_actor_name, ''), 'Unknown')
    || ' &middot; ' || to_char(now() at time zone 'Australia/Brisbane', 'DD/MM/YYYY HH24:MI:SS')
    || '</div>' || v_escaped || '</div>';

  update announcements
  set content_html = coalesce(v_content, '') || v_block,
      updated_by = auth.uid(),
      updated_by_name = coalesce(nullif(v_actor_name, ''), updated_by_name)
  where id = p_announcement_id;

  insert into announcement_history (announcement_id, action, actor_id, actor_name)
  values (p_announcement_id, 'commented', auth.uid(), v_actor_name);
end;
$$;

grant execute on function append_merged_comment(uuid, text) to authenticated;
