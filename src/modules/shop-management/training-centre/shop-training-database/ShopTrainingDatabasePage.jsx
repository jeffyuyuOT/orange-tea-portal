import { useEffect, useState } from 'react'
import { supabase } from '../../../../lib/supabaseClient'
import { useAuth } from '../../../../lib/AuthContext'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import Modal from '../../../../components/ui/Modal'
import ClampedText from '../../../../components/ui/ClampedText'
import SimpleRichTextEditor from '../../../../components/ui/SimpleRichTextEditor'
import { EmptyState } from '../../../../components/ui/LoadingSpinner'
import FileRepositoryPicker from '../../../../components/ui/FileRepositoryPicker'
import { useDragReorder, DragHandle } from '../../../../lib/useDragReorder'

// Moved here from Admin Center (migration 0052): each store now owns its own
// training content outright — no more one shared global list with an
// optional "visible at these stores" restriction. Switching stores (the
// picker up in the header, which now shows here since this page is no
// longer under /admin-center) edits that store's own items. Admins keep a
// "Copy to store…" action per item for seeding another store from an
// existing one — see CopyToStoreModal below.
//
// Jeff, 2026-09: moved a second time, from its own top-level Shop Management
// page into a Training Centre sub-tab alongside Quiz Bank ("將quiz bank裡的
// quiz bank跟shop training database合併變成training centre") — same
// per-store shape of content, same "copy to other store" admin/developer
// action, so it now lives next to its Quiz Bank counterpart. No code changes
// needed for the move itself — this file's relative import depth is
// unchanged.
//
// Jeff, 2026-10-07: "shop training database裡的item新增assign to training
// journey的選項" — EditModal below gets its own Phase dropdown (Phase 1-3 for
// a Must-Know item, Phase 4/Master for a non-Must-Know one — same split
// TrainingJourneySettingPage.jsx's own tab already enforces for this store;
// that tab is unaffected/still there, this is just a second, inline place to
// set the same training_journey_phase column). "copy to store也會將phase
// assign設定copy過去" — CopyToStoreModal's insert carries it over too.
//
// Jeff, 2026-10-22: "admin在shop training database在改有copy到其他店的资料
// 时，save旁有多一个Save to Multiple Stores。這樣的話之前有copy到其他分店的
// 同樣資料就會一起更改" — an item copied via "Copy to store…" now carries a
// shared `copy_group_id` (migration 0135) linking it to every copy that was
// made from it (or that it was made from). EditModal's footer gets a second
// "Save to Multiple Stores" button, shown only when the item being edited
// has that group id, which pushes title/content/flags/files to every linked
// row at once — `store_id` and `sort_order` are never touched, so each
// store keeps its own position in its own list. The plain "Save" button is
// unchanged and only ever touches this one row. Also answers Jeff's "only
// admin?" question: it's `isAdmin` below, which is admin + developer (see
// the 2026-09 note just under this one) — shop_manager never gets either
// button.
//
// Jeff, 2026-10-22 (same day, follow-up): "還有copy到其他store，如果有同名的
// item，先視窗提醒有同名item是否覆蓋，確認則覆蓋" — CopyToStoreModal's copy()
// now checks each destination store for an item whose title matches (case-
// insensitive) before inserting. A match asks to confirm per store ("already
// has an item named … — overwrite it?"); confirming overwrites that existing
// row in place (and joins it into this item's copy_group_id) instead of
// creating a second item with the same name; declining leaves that one store
// untouched and still copies to any other selected stores with no conflict.
//
// Jeff, 2026-10-26: "shop training頁面,有的內容想做分類...想新增New
// collection...item編輯頁面title下面新增移至colleciton...collectio名稱後面
// 也會有編輯頁面,可以編輯collection的名字跟刪除" (then, mid-build: "colleciton
// 都改成category") — items can optionally belong to a Category
// (`shop_training_categories`, migration 0143; `shop_training_items
// .category_id`, nullable, on delete set null — deleting a category never
// deletes its items, they just become uncategorized again). "+ New Category"
// sits next to "+ New Item"; a category row (📁 icon) shows at the top level
// alongside any items that aren't in a category ("照常" — uncategorized items
// render exactly as before); clicking one drills into just that category's
// items (same pattern as `openCollectionId`... now `openCategoryId` below).
// Its ✎ edit button opens CategoryModal to rename or delete (confirms, with
// a stronger warning naming how many items are in it, since deleting still
// only un-sets those items' category_id, never the items themselves).
// EditModal gets a "Move to Category" dropdown right under Title.
//
// Jeff, 2026-10-26 (same day, third follow-up): "如果要將category也copy to
// other store and link store要怎麼處理? 還有如果category跟裡面item都是link
// to other store，改的時候也要都改" — categories get their own
// `copy_group_id` now too (migration 0144), same mechanism as items'. Three
// places use it:
// 1. CategoryModal: renaming a linked category (category.copy_group_id set)
//    now updates every category sharing that group id in one go — not just
//    this row — so a category's name can't drift out of sync across stores.
//    This is the "the name is only ever stored once" comment from the first
//    Category round, now true across stores too, not just within one store.
// 2. CopyToStoreModal (per-item copy): if the item being copied has a
//    category, that category is resolved/linked at each destination store
//    too (see `resolveLinkedCategoryAtStore` below) — reusing an existing
//    linked copy there, else linking a same-named category it finds, else
//    creating a brand-new one — and the copied item lands in it. Previously
//    this deliberately left `category_id` out and every copy landed
//    uncategorized; that's no longer true.
// 3. New `CopyCategoryToStoreModal` (the 📋 button on a category row,
//    admin/developer only like the item one): copies the category itself
//    AND every item currently in it to the selected store(s) in one action,
//    linking the category and running the exact same per-item copy logic
//    (`copyItemToStore`, factored out of CopyToStoreModal so both share it)
//    — including the same same-name-overwrite confirm per item per store.
// "Save to Multiple Stores" (pushing an item's content to its linked copies)
// deliberately still does NOT touch category_id — that stays store-specific
// placement, same as sort_order, so each store can file a synced item under
// whatever locally-relevant category it wants without the push fighting it.
//
// Jeff, 2026-10-26 (same day, follow-up): "shop training data base裡的排序
// 改成用拉的，不是用箭頭上下" — item reordering is now drag-and-drop (the same
// `useDragReorder`/`DragHandle` helper Formula Database's CategoryManager.jsx
// and ItemManager.jsx already use) instead of ↑/↓ buttons. Dragging only
// ever reorders within whichever group is on screen — the open category, or
// the uncategorized list — same scoping the ↑/↓ buttons had.
export default function ShopTrainingDatabasePage() {
  const { profile, currentStoreId, accessibleStores } = useAuth()
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [copyingItem, setCopyingItem] = useState(null)
  // null = top-level view (categories + uncategorized items). Set to a
  // category's id to drill into just that category's items.
  const [openCategoryId, setOpenCategoryId] = useState(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [copyingCategory, setCopyingCategory] = useState(null)

  // Jeff, 2026-09: "developer也要像admin一樣可以copy到其他分店" — developer
  // is meant to be admin's superset everywhere (RLS already treats it that
  // way since migration 0058), but this was a front-end-only miss: the
  // "Copy to store…" button/copy checked the literal 'admin' role and never
  // included 'developer'.
  const isAdmin = profile?.role === 'admin' || profile?.role === 'developer'

  async function load() {
    if (!currentStoreId) return
    setLoading(true)
    const [{ data: itemRows }, { data: categoryRows }] = await Promise.all([
      supabase.from('shop_training_items').select('*').eq('store_id', currentStoreId).order('sort_order'),
      supabase.from('shop_training_categories').select('*').eq('store_id', currentStoreId).order('sort_order'),
    ])
    setItems(itemRows ?? [])
    setCategories(categoryRows ?? [])
    setLoading(false)
  }
  useEffect(() => {
    setOpenCategoryId(null) // switching stores — the open category belonged to the old one
    load()
  }, [currentStoreId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The items shown right now: either the open category's items, or (at the
  // top level) the ones not in any category — categorized items only ever
  // show inside their own category, never alongside the uncategorized list.
  const visibleItems = openCategoryId
    ? items.filter((i) => i.category_id === openCategoryId)
    : items.filter((i) => !i.category_id)

  // Dragging a row can move it several places in one go, so every item in
  // `next` (the reordered visibleItems slice `useDragReorder` hands back)
  // gets a fresh sequential sort_order (0..n-1) — only ever meaningful
  // relative to its own group's other members, since every view here
  // already filters by category_id before sorting, so it's fine for these
  // values to overlap with another group's sort_order.
  async function persistOrder(next) {
    await Promise.all(next.map((it, idx) => supabase.from('shop_training_items').update({ sort_order: idx }).eq('id', it.id)))
    await load()
  }
  const { handleProps, rowProps } = useDragReorder(visibleItems, persistOrder)

  async function remove(id) {
    if (!confirm('Delete this training item?')) return
    await supabase.from('shop_training_items').delete().eq('id', id)
    load()
  }

  return (
    <div>
      {/* No own <h1> here — this now renders under TrainingCentreLayout's
          shared "Training Centre" heading + tab bar, same as QuizBankPage.jsx
          alongside it. */}
      <p className="mb-4 text-sm text-gray-500">
        Content shown in Operations &amp; Training &gt; Shop Training — for the store selected above only. Switch
        stores to edit another store's content.
        {isAdmin && ' As an admin, you can also copy an item from here straight into other stores.'}
      </p>

      <div className="mb-3 flex items-center justify-between gap-2">
        {openCategoryId ? (
          <button
            type="button"
            onClick={() => setOpenCategoryId(null)}
            className="flex items-center gap-1 text-sm text-brand-600 hover:underline"
          >
            ‹ Back to all items
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {!openCategoryId && (
            <Button variant="secondary" onClick={() => setCreatingCategory(true)}>
              + New Category
            </Button>
          )}
          <Button onClick={() => setEditing(openCategoryId ? { category_id: openCategoryId } : {})}>
            + New Item
          </Button>
        </div>
      </div>

      {openCategoryId && (
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <span>📁</span>
          {categories.find((c) => c.id === openCategoryId)?.name}
        </h2>
      )}

      {loading ? null : (
        <>
          {!openCategoryId && categories.length > 0 && (
            <div className="mb-3 divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
              {categories.map((c) => {
                const count = items.filter((i) => i.category_id === c.id).length
                return (
                  <div key={c.id} className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => setOpenCategoryId(c.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-brand-600"
                    >
                      <span>📁</span>
                      <ClampedText text={c.name} title="Category name" className="min-w-0 flex-1 font-medium text-gray-800" />
                      {c.copy_group_id && <Badge color="brand">🔗 Linked</Badge>}
                      <span className="shrink-0 text-xs text-gray-400">
                        {count} item{count === 1 ? '' : 's'}
                      </span>
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setCopyingCategory(c)}
                        className="shrink-0 rounded-lg border border-brand-200 p-1.5 text-brand-700 hover:bg-brand-50"
                        title="Copy to store…"
                        aria-label="Copy category to store"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingCategory(c)}
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      title="Edit category"
                      aria-label="Edit category"
                    >
                      ✎
                    </button>
                    <span className="shrink-0 text-gray-300">›</span>
                  </div>
                )
              })}
            </div>
          )}

          {!visibleItems.length ? (
            (openCategoryId || !categories.length) && (
              <EmptyState
                label={openCategoryId ? 'No items in this category yet.' : 'No shop training items yet for this store.'}
              />
            )
          ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {visibleItems.map((item) => {
            const { isDragging, isDropTarget, ...dragRowProps } = rowProps(item.id)
            return (
              // Jeff, 2026-09-29: "手機板的shop training database介面要好操作
              // 一點，都超出螢幕了" — title + (admin's) "Copy to store…" +
              // "Delete" used to sit forced onto one line (no wrap), so on a
              // phone the button cluster ran off the right edge of the
              // screen. flex-wrap on the row + min-w-0 on the title button
              // (so it can actually shrink/wrap instead of forcing the row
              // wide) lets the button cluster drop to its own line on a
              // narrow screen instead; ml-auto keeps it right-aligned either
              // way (single line on desktop, its own line on mobile).
              <div
                key={item.id}
                {...dragRowProps}
                className={`px-4 py-2.5 transition-colors ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'bg-brand-50' : ''}`}
              >
                <div className="flex items-center gap-1">
                  <DragHandle {...handleProps(item.id)} />
                  <div onClick={() => setEditing(item)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <ClampedText text={item.title} title="Item title" className="font-medium text-gray-800" />
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 pl-7">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {item.is_must_know && (
                      <span className="text-amber-500" title="Must Know Item">
                        ⭐
                      </span>
                    )}
                    {item.training_journey_phase && (
                      <span
                        className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700"
                        title="Training Journey phase"
                      >
                        {item.training_journey_phase === 4 ? 'Phase 4 (Master)' : `Phase ${item.training_journey_phase}`}
                      </span>
                    )}
                    {item.visible_to_training && <Badge color="green">Visible to Training</Badge>}
                    {item.copy_group_id && <Badge color="brand">🔗 Linked across stores</Badge>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setCopyingItem(item)}
                        className="rounded-lg border border-brand-200 p-1.5 text-brand-700 hover:bg-brand-50"
                        title="Copy to store…"
                        aria-label="Copy to store"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
                      </button>
                    )}
                    <button
                      type="button"
                      title="Delete"
                      aria-label="Delete"
                      onClick={() => remove(item.id)}
                      className="rounded-md px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
          )}
        </>
      )}

      {editing && (
        <EditModal
          item={editing}
          nextSortOrder={items.length}
          currentStoreId={currentStoreId}
          profileId={profile.id}
          profileName={`${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || profile.email}
          isAdmin={isAdmin}
          accessibleStores={accessibleStores}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {copyingItem && (
        <CopyToStoreModal
          item={copyingItem}
          currentStoreId={currentStoreId}
          accessibleStores={accessibleStores}
          categories={categories}
          onClose={() => setCopyingItem(null)}
          onCopied={() => {
            setCopyingItem(null)
            // Refreshes this store's own list so the source item's new
            // "🔗 Linked across stores" badge (set the first time an item is
            // copied) shows up immediately, without a manual page refresh.
            load()
          }}
        />
      )}

      {copyingCategory && (
        <CopyCategoryToStoreModal
          category={copyingCategory}
          categoryItems={items.filter((i) => i.category_id === copyingCategory.id)}
          currentStoreId={currentStoreId}
          accessibleStores={accessibleStores}
          onClose={() => setCopyingCategory(null)}
          onCopied={() => {
            setCopyingCategory(null)
            load()
          }}
        />
      )}

      {creatingCategory && (
        <CategoryModal
          category={null}
          currentStoreId={currentStoreId}
          nextSortOrder={categories.length}
          onClose={() => setCreatingCategory(false)}
          onSaved={() => {
            setCreatingCategory(false)
            load()
          }}
        />
      )}

      {editingCategory && (
        <CategoryModal
          category={editingCategory}
          currentStoreId={currentStoreId}
          itemCount={items.filter((i) => i.category_id === editingCategory.id).length}
          onClose={() => setEditingCategory(null)}
          onSaved={() => {
            setEditingCategory(null)
            load()
          }}
          onDeleted={() => {
            // If the category we just deleted was the one open, back out to
            // the top level — it no longer exists to show.
            setOpenCategoryId((prev) => (prev === editingCategory.id ? null : prev))
            setEditingCategory(null)
            load()
          }}
        />
      )}
    </div>
  )
}

// Jeff, 2026-10-02: attachments here used to have no size limit at all —
// same reasoning/figure as SimpleRichTextEditor.jsx's image cap (free-tier
// Storage quota; 5MB comfortably covers a phone photo or a typical PDF
// without the person needing to resize/compress first).
const MAX_FILE_BYTES = 5 * 1024 * 1024

function EditModal({
  item,
  nextSortOrder,
  currentStoreId,
  profileId,
  profileName,
  isAdmin,
  accessibleStores,
  categories,
  onClose,
  onSaved,
}) {
  const isNew = !item.id
  // Set once this item has ever been through "Copy to store…" (by itself or
  // by whichever copy it came from) — null for an item that's never been
  // copied anywhere, in which case there's nothing else to push an edit to.
  const copyGroupId = item.copy_group_id ?? null
  const [title, setTitle] = useState(item.title ?? '')
  // Jeff, 2026-10-26: "item編輯頁面title下面新增移至category" — null means no
  // category (shows at the top level, same as before categories existed).
  // Starts pre-selected when a new item is created from inside an open
  // category (ShopTrainingDatabasePage passes `{ category_id: openCategoryId }`
  // as `item` for "+ New Item" in that case) so it lands back in the same
  // category instead of needing a manual re-pick.
  const [categoryId, setCategoryId] = useState(item.category_id ?? null)
  const [content, setContent] = useState(item.content_html ?? '')
  const [visible, setVisible] = useState(item.visible_to_training ?? false)
  // Jeff, 2026-09-30 (migration 0082): same "Must-Know Items" concept as
  // Formula Database's flag (ItemEditModal.jsx) — which Shop Training
  // content is the store's official required-memorization set, used by
  // Study Log's new "Must-Know Items" tab/dropdown, Progress Chart/Study
  // Summary's Must-Know breakdown, and narrows the Formal Quiz manager-
  // approval "not yet memorized" check the same way it already does for
  // drinks (StaffStudyDetail.jsx). An unchecked item stays fully visible
  // and keeps its own Study Log "Memorized" self-tracking checkbox.
  const [mustKnow, setMustKnow] = useState(item.is_must_know ?? false)
  // Jeff, 2026-10-07: "shop training database裡的item新增assign to training
  // journey的選項，可以下拉選取phase，則item也會在training journey裡出現" —
  // same training_journey_phase column, same Phase 1-3 (must-know) / Phase 4
  // Master (non-must-know) split TrainingJourneySettingPage.jsx already
  // enforces for this store, just editable right here too now instead of
  // only on that separate tab. "如果勾選must-know item時，則必須選擇phase 1-3
  // 其中一個" — toggling Must Know on/off clears whichever side's phase no
  // longer applies (a stale Phase 4 surviving a must-know check, or vice
  // versa), and save() below blocks with no phase chosen while Must Know is
  // checked.
  const [trainingPhase, setTrainingPhase] = useState(item.training_journey_phase ?? null)
  // Attached files staff can download alongside the content — same
  // "upload immediately, only link it to the item at Save" pattern Formula
  // Database's videos use, since a brand-new item has no id yet for a
  // shop_training_item_files row to point at until it's actually inserted.
  const [files, setFiles] = useState([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const [pickingFile, setPickingFile] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    supabase
      .from('shop_training_item_files')
      .select('*')
      .eq('shop_training_item_id', item.id)
      .order('sort_order')
      .then(({ data }) => setFiles(data ?? []))
  }, [isNew, item.id])

  async function addFiles(fileList) {
    setUploadingFile(true)
    // Uploaded one at a time (not Promise.all) so a shared timestamp prefix
    // can't collide two files picked in the same click into the same path.
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        alert(`"${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB) — please use a file under ${MAX_FILE_BYTES / (1024 * 1024)}MB.`)
        continue
      }
      const path = `shop-training/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
      if (error) {
        alert(error.message)
      } else {
        setFiles((prev) => [...prev, { _key: Math.random(), display_name: file.name, file_path: path }])
      }
    }
    setUploadingFile(false)
  }
  function renameFile(key, displayName) {
    setFiles((prev) => prev.map((f) => ((f._key ?? f.id) === key ? { ...f, display_name: displayName } : f)))
  }
  function removeFile(key) {
    setFiles((prev) => prev.filter((f) => (f._key ?? f.id) !== key))
  }

  async function save() {
    if (mustKnow && !trainingPhase) {
      alert('Must-Know items need a Phase 1–3 Training Journey assignment — pick one below.')
      return
    }
    setSaving(true)
    let itemId = item.id
    if (isNew) {
      const { data, error } = await supabase
        .from('shop_training_items')
        .insert({
          title,
          content_html: content,
          visible_to_training: visible,
          is_must_know: mustKnow,
          training_journey_phase: trainingPhase,
          category_id: categoryId,
          sort_order: nextSortOrder,
          store_id: currentStoreId,
          created_by: profileId,
          created_by_name: profileName,
        })
        .select()
        .single()
      if (error) {
        alert(error.message)
        setSaving(false)
        return
      }
      itemId = data.id
    } else {
      await supabase
        .from('shop_training_items')
        .update({
          title,
          content_html: content,
          visible_to_training: visible,
          is_must_know: mustKnow,
          training_journey_phase: trainingPhase,
          category_id: categoryId,
          updated_by: profileId,
          updated_by_name: profileName,
        })
        .eq('id', item.id)
      await supabase.from('shop_training_item_files').delete().eq('shop_training_item_id', itemId)
    }
    const nonEmptyFiles = files.filter((f) => f.file_path)
    if (nonEmptyFiles.length) {
      await supabase.from('shop_training_item_files').insert(
        nonEmptyFiles.map((f, idx) => ({
          shop_training_item_id: itemId,
          display_name: f.display_name?.trim() || 'File',
          file_path: f.file_path,
          sort_order: idx,
          uploaded_by: profileId,
        }))
      )
    }
    setSaving(false)
    onSaved()
  }

  // Pushes this same title/content/flags/files to every row sharing this
  // item's copy_group_id (every store a copy of this item landed in, plus
  // the item it was itself copied from) — everything "Save" would write for
  // this one row, written to all of them in one go. Never touches store_id
  // or sort_order, so each store keeps its own position in its own list.
  // Also never touches category_id: categories are per-store rows, so this
  // item's category at THIS store has no meaning at another store (even one
  // with a same-named category — that's a different row, a different id).
  // Each linked copy keeps whatever category it's already filed under there.
  async function saveToMultiple() {
    if (!copyGroupId) return
    if (mustKnow && !trainingPhase) {
      alert('Must-Know items need a Phase 1–3 Training Journey assignment — pick one below.')
      return
    }
    const { data: group, error: groupError } = await supabase
      .from('shop_training_items')
      .select('id, store_id')
      .eq('copy_group_id', copyGroupId)
    if (groupError || !group?.length) {
      alert(groupError?.message || 'Could not find the linked copies.')
      return
    }
    const storeNames = group
      .map((row) => accessibleStores?.find((s) => s.id === row.store_id)?.name)
      .filter(Boolean)
    const storeList = storeNames.length === group.length ? ` (${storeNames.join(', ')})` : ''
    if (
      !confirm(
        `Save this content to all ${group.length} linked store cop${group.length === 1 ? 'y' : 'ies'}${storeList}? This overwrites the title, content, flags and attached files at every one of them — each store's own sort order is left as-is.`
      )
    ) {
      return
    }
    setSaving(true)
    const nonEmptyFiles = files.filter((f) => f.file_path)
    for (const row of group) {
      await supabase
        .from('shop_training_items')
        .update({
          title,
          content_html: content,
          visible_to_training: visible,
          is_must_know: mustKnow,
          training_journey_phase: trainingPhase,
          updated_by: profileId,
          updated_by_name: profileName,
        })
        .eq('id', row.id)
      await supabase.from('shop_training_item_files').delete().eq('shop_training_item_id', row.id)
      if (nonEmptyFiles.length) {
        await supabase.from('shop_training_item_files').insert(
          nonEmptyFiles.map((f, idx) => ({
            shop_training_item_id: row.id,
            display_name: f.display_name?.trim() || 'File',
            file_path: f.file_path,
            sort_order: idx,
            uploaded_by: profileId,
          }))
        )
      }
    }
    setSaving(false)
    onSaved()
  }

  return (
    <>
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? 'New Training Item' : 'Edit Training Item'}
      footer={
        <div className="flex items-center justify-end gap-2">
          {isAdmin && copyGroupId && (
            <Button
              variant="secondary"
              onClick={saveToMultiple}
              disabled={saving || !title || (mustKnow && !trainingPhase)}
            >
              {saving ? 'Saving…' : 'Save to Multiple Stores'}
            </Button>
          )}
          <Button onClick={save} disabled={saving || !title || (mustKnow && !trainingPhase)}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-gray-500">Move to Category</span>
          <select className="input" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
            <option value="">— No Category —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <SimpleRichTextEditor value={content} onChange={setContent} placeholder="Training content…" />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
          Visible to Training-role logins
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={mustKnow}
            onChange={(e) => {
              const checked = e.target.checked
              setMustKnow(checked)
              // Phase 1-3 is must-know-only, Phase 4 is non-must-know-only —
              // clear whichever side no longer applies rather than let a
              // stale value silently ride along to Save.
              setTrainingPhase((prev) => (checked ? (prev === 4 ? null : prev) : prev && prev <= 3 ? null : prev))
            }}
          />
          ⭐ Must Know Item
          <span className="text-xs font-normal text-gray-400">
            — required for the Formal Quiz memorization check (a non-must-know item stays optional to memorize)
          </span>
        </label>

        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-gray-500">Assign to Training Journey</span>
          <select
            className="input"
            value={trainingPhase ?? ''}
            onChange={(e) => setTrainingPhase(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Not in Training Journey —</option>
            {(mustKnow ? [1, 2, 3] : [4]).map((p) => (
              <option key={p} value={p}>
                {p === 4 ? 'Phase 4 (Master)' : `Phase ${p}`}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">
            {mustKnow
              ? 'Must-Know items need one of Phase 1–3 to show up in everyone\'s Training Journey — same assignment as the Training Journey Setting tab.'
              : "Non-must-know items can optionally join Phase 4 (Master)'s item pool instead — same Phase 4 picker as the Training Journey Setting tab."}
          </p>
        </label>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Attached files (optional)</span>
            <div className="flex items-center gap-3">
              {/* Jeff, 2026-10-02: "因為只有admin權限以上的人才能access file
                  repository" — shop_manager can edit Shop Training items but
                  not browse File Repository (admin_center.file_repository is
                  excluded from its default pages), so only admin/developer
                  get this option here; everyone keeps "+ Add file". */}
              {isAdmin && (
                <button type="button" onClick={() => setPickingFile(true)} className="text-xs text-brand-600 hover:underline">
                  + from file repository
                </button>
              )}
              <label className="cursor-pointer text-xs text-brand-600 hover:underline">
                {uploadingFile ? 'Uploading…' : '+ Add file'}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={uploadingFile}
                  onChange={(e) => e.target.files.length && addFiles(e.target.files)}
                />
              </label>
            </div>
          </div>
          <p className="mb-1 text-xs text-gray-400">
            Shown as downloadable links below the content on the staff-facing Shop Training page — a checklist,
            reference sheet, or any other file that's easier to hand over as-is than to type into the content above.
            Uploaded files are capped at 5MB each.
          </p>
          {files.length > 0 && (
            <div className="space-y-1.5">
              {files.map((f) => {
                const key = f._key ?? f.id
                return (
                  <div key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                    <input
                      className="input flex-1"
                      placeholder="Display name"
                      value={f.display_name}
                      onChange={(e) => renameFile(key, e.target.value)}
                    />
                    <button onClick={() => removeFile(key)} className="shrink-0 text-gray-400 hover:text-red-500">
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
    {pickingFile && (
      <FileRepositoryPicker
        accept="all"
        onSelect={(f) => {
          setFiles((prev) => [...prev, { _key: Math.random(), display_name: f.display_name, file_path: f.file_path }])
          setPickingFile(false)
        }}
        onClose={() => setPickingFile(false)}
      />
    )}
    </>
  )
}

// Finds (or creates) the category at `destStoreId` linked to `groupId`:
// reuses a category already in that group there if one exists, else links a
// same-named category it finds at that store (no destructive change — just
// setting its copy_group_id), else creates a brand-new one with that name.
// Returns the destination category's id, or null if creating it failed.
// Shared by CopyToStoreModal (a single item's category) and
// CopyCategoryToStoreModal (copying the whole category at once).
async function resolveLinkedCategoryAtStore(name, groupId, destStoreId) {
  const { data: linked } = await supabase
    .from('shop_training_categories')
    .select('id')
    .eq('store_id', destStoreId)
    .eq('copy_group_id', groupId)
    .limit(1)
  if (linked?.[0]) return linked[0].id

  const trimmed = name.trim()
  const { data: sameName } = await supabase
    .from('shop_training_categories')
    .select('id')
    .eq('store_id', destStoreId)
    .ilike('name', trimmed)
    .limit(1)
  if (sameName?.[0]) {
    await supabase.from('shop_training_categories').update({ copy_group_id: groupId }).eq('id', sameName[0].id)
    return sameName[0].id
  }

  const { count } = await supabase
    .from('shop_training_categories')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', destStoreId)
  const { data: newCategory, error } = await supabase
    .from('shop_training_categories')
    .insert({ name: trimmed, store_id: destStoreId, sort_order: count ?? 0, copy_group_id: groupId })
    .select()
    .single()
  return error || !newCategory ? null : newCategory.id
}

// Copies one item to one destination store, into `destCategoryId` (or
// uncategorized if null) — the same per-item/per-store step CopyToStoreModal
// always did, factored out so CopyCategoryToStoreModal can run it once per
// item when copying a whole category at once. Returns 'copied', 'overwritten',
// 'skipped' (the same-name overwrite confirm was declined) or 'failed'.
async function copyItemToStore(item, groupId, storeId, storeName, destCategoryId) {
  const title = item.title.trim()
  // Jeff, 2026-10-22: "如果有同名的item，先視窗提醒有同名item是否覆蓋，確認
  // 則覆蓋" — look for an item already sitting at this destination store
  // under the same name (case-insensitive) before adding a second one.
  // .limit(1) rather than .single()/.maybeSingle(), since a store could in
  // principle already have more than one same-named item (e.g. from before
  // this check existed) — overwriting just the first match is enough to
  // stop a brand-new duplicate from being created here.
  const { data: existingRows } = await supabase
    .from('shop_training_items')
    .select('id')
    .eq('store_id', storeId)
    .ilike('title', title)
    .limit(1)
  const existing = existingRows?.[0]

  const { data: sourceFiles } = await supabase
    .from('shop_training_item_files')
    .select('*')
    .eq('shop_training_item_id', item.id)
    .order('sort_order')

  if (existing) {
    if (
      !confirm(
        `${storeName} already has a training item named "${item.title}". Overwrite it with this copy? (Choosing Cancel leaves it untouched and skips this store.)`
      )
    ) {
      return 'skipped'
    }
    const { error } = await supabase
      .from('shop_training_items')
      .update({
        title: item.title,
        content_html: item.content_html,
        visible_to_training: item.visible_to_training,
        is_must_know: item.is_must_know,
        training_journey_phase: item.training_journey_phase,
        category_id: destCategoryId,
        copy_group_id: groupId,
      })
      .eq('id', existing.id)
    if (error) return 'failed'
    await supabase.from('shop_training_item_files').delete().eq('shop_training_item_id', existing.id)
    if (sourceFiles?.length) {
      await supabase.from('shop_training_item_files').insert(
        sourceFiles.map((f) => ({
          shop_training_item_id: existing.id,
          display_name: f.display_name,
          file_path: f.file_path,
          sort_order: f.sort_order,
        }))
      )
    }
    return 'overwritten'
  }

  const { count } = await supabase
    .from('shop_training_items')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
  const { data: newItem, error } = await supabase
    .from('shop_training_items')
    .insert({
      title: item.title,
      content_html: item.content_html,
      visible_to_training: item.visible_to_training,
      is_must_know: item.is_must_know,
      // Jeff, 2026-10-07: "copy to store也會將phase assign設定copy過去" — the
      // Training Journey phase assignment travels with the copy, same as
      // is_must_know right above it (the two always went together
      // conceptually — a phase without this would silently vanish at the
      // destination store, leaving the copy's Training Journey placement to
      // be redone by hand).
      training_journey_phase: item.training_journey_phase,
      category_id: destCategoryId,
      copy_group_id: groupId,
      sort_order: count ?? 0,
      store_id: storeId,
    })
    .select()
    .single()
  if (error || !newItem) return 'failed'
  if (sourceFiles?.length) {
    await supabase.from('shop_training_item_files').insert(
      sourceFiles.map((f) => ({
        shop_training_item_id: newItem.id,
        display_name: f.display_name,
        file_path: f.file_path,
        sort_order: f.sort_order,
      }))
    )
  }
  return 'copied'
}

// Admin-only: duplicates one item (title, content, "visible to training",
// and every attached file) straight into one or more other stores, each as
// its own brand-new row/id — the same as if that store's manager had
// created it themselves. Each copy can still be edited on its own
// afterwards, but it now shares a `copy_group_id` with the item it was
// copied from (and with every other copy made from that same item), so
// EditModal's "Save to Multiple Stores" button can find and update them
// all together later. If the item has a category, that category is
// resolved/linked at each destination store too (see
// `resolveLinkedCategoryAtStore` above) and the copy lands in it.
function CopyToStoreModal({ item, currentStoreId, accessibleStores, categories, onClose, onCopied }) {
  const targets = accessibleStores.filter((s) => s.id !== currentStoreId)
  const [selected, setSelected] = useState(new Set())
  const [copying, setCopying] = useState(false)
  const sourceCategory = item.category_id ? categories.find((c) => c.id === item.category_id) : null

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copy() {
    if (!selected.size) return
    if (
      !confirm(
        `Copy "${item.title}" to ${selected.size} store(s)? Each store gets its own copy you can still edit separately — but afterwards, "Save to Multiple Stores" on any of them (including this one) pushes an edit to every linked copy at once.${
          sourceCategory ? ` Its category "${sourceCategory.name}" is linked/created at each destination store too.` : ''
        }`
      )
    ) {
      return
    }
    setCopying(true)

    // Give the source item a group id (shared by every copy made from it)
    // the first time it's ever copied, so this copy — and any later one —
    // can all be found and updated together via "Save to Multiple Stores".
    let groupId = item.copy_group_id
    if (!groupId) {
      groupId = crypto.randomUUID()
      await supabase.from('shop_training_items').update({ copy_group_id: groupId }).eq('id', item.id)
    }

    // Jeff, 2026-10-26: "如果要將category也copy to other store and link
    // store要怎麼處理?" — give the item's category its own group id too (if
    // it doesn't already have one), the same way items get one above.
    let categoryGroupId = null
    if (sourceCategory) {
      categoryGroupId = sourceCategory.copy_group_id
      if (!categoryGroupId) {
        categoryGroupId = crypto.randomUUID()
        await supabase.from('shop_training_categories').update({ copy_group_id: categoryGroupId }).eq('id', sourceCategory.id)
      }
    }

    const counts = { copied: 0, overwritten: 0, skipped: 0, failed: 0 }
    for (const storeId of selected) {
      const storeName = accessibleStores.find((s) => s.id === storeId)?.name ?? 'that store'
      const destCategoryId = sourceCategory
        ? await resolveLinkedCategoryAtStore(sourceCategory.name, categoryGroupId, storeId)
        : null
      const result = await copyItemToStore(item, groupId, storeId, storeName, destCategoryId)
      counts[result] += 1
    }
    setCopying(false)
    onCopied()
    const parts = []
    if (counts.copied) parts.push(`copied to ${counts.copied} store(s)`)
    if (counts.overwritten) parts.push(`overwrote the same-named item at ${counts.overwritten} store(s)`)
    if (counts.skipped) parts.push(`left ${counts.skipped} store(s) unchanged`)
    if (counts.failed) parts.push(`${counts.failed} store(s) failed`)
    alert(parts.length ? `${parts.join(', ')}.` : 'Nothing was copied.')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy "${item.title}" to…`}
      footer={
        <Button onClick={copy} disabled={copying || !selected.size}>
          {copying ? 'Copying…' : `Copy to ${selected.size || ''} store(s)`}
        </Button>
      }
    >
      {!targets.length ? (
        <p className="text-sm text-gray-500">No other stores to copy to.</p>
      ) : (
        <div className="space-y-1.5">
          {targets.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Admin-only: copies a whole category — itself, linked/created at each
// destination store via `resolveLinkedCategoryAtStore` — AND every item
// currently in it, via the same `copyItemToStore` step CopyToStoreModal uses
// for a single item, run once per item per destination store (including the
// same same-name overwrite confirm, per item per store). Saves clicking
// "Copy to store…" on every item in the category one at a time.
function CopyCategoryToStoreModal({ category, categoryItems, currentStoreId, accessibleStores, onClose, onCopied }) {
  const targets = accessibleStores.filter((s) => s.id !== currentStoreId)
  const [selected, setSelected] = useState(new Set())
  const [copying, setCopying] = useState(false)

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function copy() {
    if (!selected.size) return
    if (
      !confirm(
        `Copy the category "${category.name}" and its ${categoryItems.length} item${categoryItems.length === 1 ? '' : 's'} to ${selected.size} store(s)? Each store gets a linked copy of the category and every item in it. Renaming "${category.name}" later updates every linked store's copy too.`
      )
    ) {
      return
    }
    setCopying(true)

    let groupId = category.copy_group_id
    if (!groupId) {
      groupId = crypto.randomUUID()
      await supabase.from('shop_training_categories').update({ copy_group_id: groupId }).eq('id', category.id)
    }

    let categoryFailCount = 0
    const itemCounts = { copied: 0, overwritten: 0, skipped: 0, failed: 0 }

    for (const storeId of selected) {
      const storeName = accessibleStores.find((s) => s.id === storeId)?.name ?? 'that store'
      const destCategoryId = await resolveLinkedCategoryAtStore(category.name, groupId, storeId)
      if (!destCategoryId) {
        categoryFailCount += 1
        continue
      }
      // Every item in the category also needs its OWN item-level
      // copy_group_id (separate from the category's), same as a single-item
      // copy via CopyToStoreModal — so "Save to Multiple Stores" on any one
      // of these items still finds just its own linked copies, not every
      // item in the category.
      for (const item of categoryItems) {
        let itemGroupId = item.copy_group_id
        if (!itemGroupId) {
          itemGroupId = crypto.randomUUID()
          await supabase.from('shop_training_items').update({ copy_group_id: itemGroupId }).eq('id', item.id)
        }
        const result = await copyItemToStore(item, itemGroupId, storeId, storeName, destCategoryId)
        itemCounts[result] += 1
      }
    }
    setCopying(false)
    onCopied()
    const parts = []
    if (categoryFailCount) parts.push(`the category itself failed to set up at ${categoryFailCount} store(s)`)
    if (itemCounts.copied) parts.push(`copied ${itemCounts.copied} item(s)`)
    if (itemCounts.overwritten) parts.push(`overwrote ${itemCounts.overwritten} same-named item(s)`)
    if (itemCounts.skipped) parts.push(`left ${itemCounts.skipped} item(s) unchanged`)
    if (itemCounts.failed) parts.push(`${itemCounts.failed} item(s) failed`)
    alert(parts.length ? `${parts.join(', ')}.` : 'Nothing was copied.')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy category "${category.name}" to…`}
      footer={
        <Button onClick={copy} disabled={copying || !selected.size}>
          {copying ? 'Copying…' : `Copy to ${selected.size || ''} store(s)`}
        </Button>
      }
    >
      {!targets.length ? (
        <p className="text-sm text-gray-500">No other stores to copy to.</p>
      ) : (
        <div className="space-y-1.5">
          {targets.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Create (category === null) or rename/delete (category === the row) one
// category. Renaming only ever writes the name here, on this one row — every
// item's "Move to Category" dropdown reads it fresh each time EditModal
// opens, so there's nothing else to go update. Deleting the category never
// deletes its items (the FK is ON DELETE SET NULL): they just fall back to
// "no category", same as if no one had ever filed them under it.
function CategoryModal({ category, currentStoreId, nextSortOrder, itemCount, onClose, onSaved, onDeleted }) {
  const isNew = !category
  const [name, setName] = useState(category?.name ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    // Jeff, 2026-10-26: "如果category跟裡面item都是link to other store，改的
    // 時候也要都改" — a linked category (copy_group_id set) renames every
    // row sharing that group id in one go, not just this one, so the name
    // can't drift out of sync across stores.
    const { error } = isNew
      ? await supabase.from('shop_training_categories').insert({
          name: trimmed,
          store_id: currentStoreId,
          sort_order: nextSortOrder,
        })
      : category.copy_group_id
        ? await supabase
            .from('shop_training_categories')
            .update({ name: trimmed })
            .eq('copy_group_id', category.copy_group_id)
        : await supabase.from('shop_training_categories').update({ name: trimmed }).eq('id', category.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    onSaved()
  }

  async function remove() {
    // Jeff, 2026-10-26: "刪除時裡面有內容會有警示視窗提醒並確認" — a category
    // with items in it gets a stronger warning naming the count (and makes
    // clear the items themselves are safe, just uncategorized afterwards);
    // an empty category just gets a plain confirm. Deleting only ever
    // removes THIS store's row — a linked category at another store is a
    // separate row and is left alone.
    const linkedNote = category.copy_group_id
      ? " (This only removes this store's copy — any linked copies at other stores are left as they are.)"
      : ''
    const warning = itemCount
      ? `"${category.name}" has ${itemCount} item${itemCount === 1 ? '' : 's'} in it. Deleting the category does NOT delete those items — they'll move back to having no category.${linkedNote} Delete "${category.name}"?`
      : `Delete the empty category "${category.name}"?${linkedNote}`
    if (!confirm(warning)) return
    setSaving(true)
    const { error } = await supabase.from('shop_training_categories').delete().eq('id', category.id)
    setSaving(false)
    if (error) {
      alert(error.message)
      return
    }
    onDeleted()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New Category' : 'Edit Category'}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {isNew ? (
            <span />
          ) : (
            <Button variant="danger" onClick={remove} disabled={saving}>
              Delete
            </Button>
          )}
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Category name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {!isNew && (
        <p className="mt-2 text-xs text-gray-400">
          Renaming updates every item's "Move to Category" dropdown automatically.
          {category.copy_group_id
            ? ' This category is linked across stores, so the new name also updates every linked copy there.'
            : ''}
        </p>
      )}
    </Modal>
  )
}
