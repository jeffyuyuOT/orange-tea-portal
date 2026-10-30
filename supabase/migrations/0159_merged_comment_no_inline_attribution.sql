-- Jeff, 2026-10-30: "Merge mode有辦法做到是直接像是寫在原文下面的感覺嗎，
-- 編輯上面不需要有誰跟時間的標記，history都有紀錄，如果想知道哪一段留言是
-- 誰加的，可以點擊該歷史紀錄（顯示highlight），然後該記錄編輯的文字也
-- highlight" — append_merged_comment() (migration 0157) used to prepend a
-- visible "<name> · <timestamp>" line above every merged-in comment. Drops
-- that — who/when is already in History (unchanged) — and instead tags
-- the appended block with data-comment-id="<the new history row's id>",
-- invisible in normal rendering, so AnnouncementDetailModal.jsx can find
-- and highlight that exact block when its matching History entry is
-- clicked (client-side only; see that file's own change).
--
-- Needs the history row's id BEFORE building the content block (to stamp
-- it on), so the insert now happens first and content_html is appended
-- second — the reverse order from 0157, but still the same one
-- transaction, so a failure anywhere still rolls both back together
-- exactly as before.
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
  v_history_id uuid;
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

  insert into announcement_history (announcement_id, action, actor_id, actor_name)
  values (p_announcement_id, 'commented', auth.uid(), v_actor_name)
  returning id into v_history_id;

  v_escaped := replace(replace(replace(p_comment, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped := replace(v_escaped, chr(10), '<br/>');

  v_block := '<div class="merged-comment" data-comment-id="' || v_history_id
    || '" style="color:#111827;font-weight:600;border-left:3px solid #d1d5db;padding-left:0.75rem;margin-top:0.75rem;">'
    || v_escaped || '</div>';

  update announcements
  set content_html = coalesce(v_content, '') || v_block,
      updated_by = auth.uid(),
      updated_by_name = coalesce(nullif(v_actor_name, ''), updated_by_name)
  where id = p_announcement_id;
end;
$$;

grant execute on function append_merged_comment(uuid, text) to authenticated;
