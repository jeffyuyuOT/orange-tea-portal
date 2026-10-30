-- Jeff, 2026-10-30: "如果comment者刪除的話是不是歷史紀錄也要清楚" — a
-- merge-mode comment has no row of its own to delete (append_merged_
-- comment, migration 0157/0159, splices it straight into content_html),
-- so deleting one means two things have to happen together: strip that
-- exact block back out of content_html, AND remove the announcement_
-- history row that pointed at it (action='commented') — leaving the
-- history row behind would be a dangling entry that highlights nothing
-- when clicked (AnnouncementDetailModal.jsx's History-click-to-highlight,
-- migration 0159) since its data-comment-id block would no longer exist.
--
-- SECURITY DEFINER for the same reason append_merged_comment() is: the
-- comment's own author (not necessarily this notice's creator or a
-- manager/admin) needs to be able to remove their own words, which plain
-- client .update()s on announcements can't grant them. Also open to
-- manager/admin for moderation, matching "manager admin delete
-- announcement_comments" (migration 0056) — the equivalent delete right
-- a normal (non-merge) comment's own row already has.
create or replace function delete_merged_comment(p_announcement_id uuid, p_history_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_actor_id uuid;
  v_action text;
  v_content text;
  v_pattern text;
begin
  select store_id, content_html into v_store_id, v_content
  from announcements where id = p_announcement_id;
  if v_store_id is null then
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

  if not (
    v_actor_id = auth.uid()
    or is_admin()
    or (is_manager_or_admin() and v_store_id = any (current_store_ids()))
  ) then
    raise exception 'Not authorized to delete this comment';
  end if;

  -- Matches exactly the block append_merged_comment() built for this
  -- history id: '<div class="merged-comment" data-comment-id="<uuid>"
  -- style="...">...</div>' — [^>]* skips past the style attribute
  -- regardless of its exact contents, and the lazy .*? stops at the
  -- nearest </div> rather than the last one in the whole document (these
  -- blocks never nest another <div> inside themselves, since the
  -- comment's own text only ever contains escaped text and <br/> tags).
  v_pattern := '<div class="merged-comment" data-comment-id="' || p_history_id || '"[^>]*>.*?</div>';

  update announcements
  set content_html = regexp_replace(coalesce(v_content, ''), v_pattern, '')
  where id = p_announcement_id;

  delete from announcement_history where id = p_history_id;
end;
$$;

grant execute on function delete_merged_comment(uuid, uuid) to authenticated;
