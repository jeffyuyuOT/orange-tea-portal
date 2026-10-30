-- Jeff, 2026-10-30: "Merge加的comment發文者也要可以編輯跟刪除" — the person
-- who posted a merge-mode comment could already delete it
-- (delete_merged_comment, migration 0160) but had no way to edit it,
-- unlike a normal (non-merge) comment's own author, who already got both
-- (migration 0157's "author update/delete own announcement_comments"
-- policies). Adds the missing edit half for merge-mode comments.
--
-- Deliberately EDIT-author-only, no manager/admin OR-clause — mirrors
-- that same asymmetry already established for normal comments
-- (AnnouncementDetailModal.jsx's own comment on it: manager/admin get
-- delete for moderation, but never edit on someone else's words). Delete
-- keeps its existing manager/admin allowance (migration 0160)
-- unchanged.
create or replace function edit_merged_comment(p_announcement_id uuid, p_history_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content text;
  v_actor_id uuid;
  v_action text;
  v_escaped text;
  v_pattern text;
  v_new_block text;
begin
  select content_html into v_content from announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement not found';
  end if;

  select actor_id, action into v_actor_id, v_action
  from announcement_history
  where id = p_history_id and announcement_id = p_announcement_id;
  if v_action is null then
    raise exception 'History entry not found';
  end if;
  if v_action <> 'commented' then
    raise exception 'This history entry is not a merged comment';
  end if;
  if v_actor_id <> auth.uid() then
    raise exception 'Not authorized to edit this comment';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'Comment cannot be empty';
  end if;

  v_escaped := replace(replace(replace(p_comment, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_escaped := replace(v_escaped, chr(10), '<br/>');

  v_pattern := '<div class="merged-comment" data-comment-id="' || p_history_id || '"[^>]*>.*?</div>';
  v_new_block := '<div class="merged-comment" data-comment-id="' || p_history_id
    || '" style="color:#111827;font-weight:600;border-left:3px solid #d1d5db;padding-left:0.75rem;margin-top:0.75rem;">'
    || v_escaped || '</div>';
  -- regexp_replace treats backslashes in its REPLACEMENT argument
  -- specially (\1..\9 backreferences, \\ for a literal backslash) — a
  -- comment containing a literal "\" would otherwise get silently mangled
  -- here (there are no capture groups in v_pattern, so e.g. "\1" would
  -- just vanish). Doubling it right before the call is what keeps an
  -- edited comment's own backslashes literal in the stored HTML.
  v_new_block := replace(v_new_block, '\', '\\');

  update announcements
  set content_html = regexp_replace(coalesce(v_content, ''), v_pattern, v_new_block)
  where id = p_announcement_id;
end;
$$;

grant execute on function edit_merged_comment(uuid, uuid, text) to authenticated;
