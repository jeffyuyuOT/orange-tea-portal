import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import { useDragReorder, DragHandle } from '../../../lib/useDragReorder'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import { frequencyLabel, groupItems } from './maintenanceUtils'

const EMPTY = { id: null, name: '', frequency_months: 1, category: '', log_type: 'general' }
const LOG_TYPES = [
  { value: 'general', label: 'Log' },
  { value: 'manager', label: "Manager's Log" },
  { value: 'both', label: 'Both (shared)' },
]
const FREQ_PRESETS = [
  { value: 1, label: 'Monthly' },
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
]

// Jeff, 2026-10-26: the Maintenance Log's Setting tab — add / edit / delete
// services, set frequency + category, drag to reorder. Whatever is here (and
// its order) is exactly what the Log table shows; same-category items are
// shown together under the category name.
export default function MaintenanceSettingPage() {
  const { currentStoreId, accessibleStores, profile } = useAuth()
  // Copy to other store / Save to Multiple Stores: admin + developer only.
  const isAdmin = profile?.role === 'admin' || profile?.role === 'developer'
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? ''

  const [items, setItems] = useState(null) // null = loading
  const [form, setForm] = useState(null)
  const [copyingItem, setCopyingItem] = useState(null)
  const [copyTargets, setCopyTargets] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!currentStoreId) return
    const { data, error: err } = await supabase
      .from('maintenance_items')
      .select('*')
      .eq('store_id', currentStoreId)
      .order('sort_order')
    if (err) setError(err.message)
    setItems(data ?? [])
  }, [currentStoreId])

  useEffect(() => {
    setItems(null)
    setForm(null)
    setError('')
    setNotice('')
    load()
  }, [load])

  const generalRows = useMemo(() => groupItems((items ?? []).filter((i) => (i.log_type ?? 'general') !== 'manager')), [items])
  const managerRows = useMemo(() => groupItems((items ?? []).filter((i) => (i.log_type ?? 'general') !== 'general')), [items])
  const categories = useMemo(
    () => [...new Set((items ?? []).map((i) => (i.category ?? '').trim()).filter(Boolean))],
    [items]
  )
  // Drag works on the items in the order they are displayed (grouped), one
  // list per section — an item can't be dragged from Log into Manager's Log
  // (change "Appears in" when editing it instead).
  const generalShown = useMemo(() => generalRows.filter((r) => r.type === 'item').map((r) => r.item), [generalRows])
  const managerShown = useMemo(() => managerRows.filter((r) => r.type === 'item').map((r) => r.item), [managerRows])

  async function persistOrder(next) {
    // Reuse the same sort_order "slots" this section's items already occupy,
    // handing them out in the new order — so items that only live in the other
    // section (and a shared item's place there) aren't renumbered.
    const slots = next.map((n) => items.find((i) => i.id === n.id)?.sort_order ?? 0).sort((a, b) => a - b)
    for (let k = 1; k < slots.length; k++) if (slots[k] <= slots[k - 1]) slots[k] = slots[k - 1] + 1
    const ordered = next.map((n, i) => ({ ...n, sort_order: slots[i] }))
    setItems((cur) => [...cur.filter((i) => !ordered.some((n) => n.id === i.id)), ...ordered])
    const results = await Promise.all(ordered.map((it) => supabase.from('maintenance_items').update({ sort_order: it.sort_order }).eq('id', it.id)))
    const failed = results.find((r) => r.error)
    if (failed) setError(failed.error.message)
    await load()
  }
  const generalDrag = useDragReorder(generalShown, persistOrder)
  const managerDrag = useDragReorder(managerShown, persistOrder)

  async function save() {
    if (!form.name.trim()) return
    setError('')
    const fields = {
      name: form.name.trim(),
      frequency_months: Number(form.frequency_months),
      category: form.category.trim() || null,
      log_type: form.log_type,
    }
    const { error: err } = form.id
      ? await supabase.from('maintenance_items').update(fields).eq('id', form.id)
      : await supabase.from('maintenance_items').insert({
          ...fields,
          store_id: currentStoreId,
          sort_order: items.length ? Math.max(...items.map((i) => i.sort_order)) + 1 : 0,
        })
    if (err) return setError(err.message)
    setForm(null)
    await load()
  }

  async function remove(item) {
    if (!window.confirm(`Delete "${item.name}"? Its recorded dates will be deleted too.`)) return
    const { error: err } = await supabase.from('maintenance_items').delete().eq('id', item.id)
    if (err) return setError(err.message)
    await load()
  }

  const storeName_ = (id) => accessibleStores.find((s) => s.id === id)?.name ?? 'that store'

  // Copies one item to each chosen store and links the copies (shared
  // copy_group_id). A same-named item already at a destination is overwritten
  // (after one combined confirm) and joins the group instead of duplicating.
  async function copyToStores() {
    const item = copyingItem
    if (!item || !copyTargets.size) return
    setError('')
    const targets = [...copyTargets]
    const { data: existing, error: exErr } = await supabase
      .from('maintenance_items')
      .select('id, name, store_id, log_type')
      .in('store_id', targets)
    if (exErr) return setError(exErr.message)
    const key = item.name.trim().toLowerCase()
    const clash = new Map((existing ?? []).filter((r) => r.name.trim().toLowerCase() === key && (r.log_type ?? 'general') === (item.log_type ?? 'general')).map((r) => [r.store_id, r.id]))
    const clashNote = clash.size ? ` This will overwrite the item with the same name at: ${[...clash.keys()].map(storeName_).join(', ')}.` : ''
    if (
      !window.confirm(
        `Copy "${item.name}" to ${targets.length} store(s)? The copies stay linked — "Save to Multiple Stores" on any of them updates all.${clashNote}`
      )
    )
      return
    setBusy(true)
    const groupId = item.copy_group_id ?? crypto.randomUUID()
    if (!item.copy_group_id) {
      const { error: gErr } = await supabase.from('maintenance_items').update({ copy_group_id: groupId }).eq('id', item.id)
      if (gErr) {
        setBusy(false)
        return setError(gErr.message)
      }
    }
    const fields = { name: item.name, frequency_months: item.frequency_months, category: item.category, log_type: item.log_type ?? 'general', copy_group_id: groupId }
    let copied = 0
    let overwritten = 0
    let failed = 0
    for (const storeId of targets) {
      const existingId = clash.get(storeId)
      let res
      if (existingId) {
        res = await supabase.from('maintenance_items').update(fields).eq('id', existingId)
      } else {
        const { data: last } = await supabase
          .from('maintenance_items')
          .select('sort_order')
          .eq('store_id', storeId)
          .order('sort_order', { ascending: false })
          .limit(1)
        res = await supabase
          .from('maintenance_items')
          .insert({ ...fields, store_id: storeId, sort_order: last?.length ? last[0].sort_order + 1 : 0 })
      }
      if (res.error) failed += 1
      else if (existingId) overwritten += 1
      else copied += 1
    }
    setBusy(false)
    setCopyingItem(null)
    setCopyTargets(new Set())
    const parts = []
    if (copied) parts.push(`copied to ${copied} store(s)`)
    if (overwritten) parts.push(`overwrote the same-named item at ${overwritten} store(s)`)
    if (failed) parts.push(`${failed} store(s) failed`)
    setNotice(parts.length ? `${parts.join(', ')}.` : 'Nothing was copied.')
    await load()
  }

  // Writes this item's name / frequency / category to every linked copy
  // (never sort_order or store, so each store keeps its own order).
  async function saveToMultiple() {
    if (!form?.copy_group_id || !form.name.trim()) return
    const { data: group, error: gErr } = await supabase.from('maintenance_items').select('id, store_id, name, frequency_months, category, log_type').eq('copy_group_id', form.copy_group_id)
    if (gErr || !group?.length) return setError(gErr?.message || 'Could not find the linked copies.')
    const names = group.map((r) => storeName_(r.store_id)).join(', ')
    // Linked stores whose copy was changed on its own since linking (differs
    // from this item as last saved) — warn that the overwrite discards that.
    const self = group.find((r) => r.id === form.id)
    const norm = (v) => (v ?? '').toString().trim().toLowerCase()
    const diverged = self
      ? group
          .filter((r) => r.id !== self.id)
          .map((r) => {
            const f = []
            if (norm(r.name) !== norm(self.name)) f.push('name')
            if (r.frequency_months !== self.frequency_months) f.push('frequency')
            if (norm(r.category) !== norm(self.category)) f.push('category')
            if ((r.log_type ?? 'general') !== (self.log_type ?? 'general')) f.push('log / manager\'s log')
            return { r, f }
          })
          .filter((d) => d.f.length)
      : []
    const divergedNote = diverged.length
      ? `\n\n⚠ These stores have their own changes that will be overwritten:\n${diverged.map((d) => `• ${storeName_(d.r.store_id)} — ${d.f.join(', ')}`).join('\n')}`
      : ''
    if (!window.confirm(`Save to all ${group.length} linked store cop${group.length === 1 ? 'y' : 'ies'} (${names})? This overwrites the name, frequency, category and log type at every one of them.${divergedNote}`)) return
    setBusy(true)
    const fields = { name: form.name.trim(), frequency_months: Number(form.frequency_months), category: form.category.trim() || null, log_type: form.log_type }
    const { error: uErr } = await supabase.from('maintenance_items').update(fields).eq('copy_group_id', form.copy_group_id)
    setBusy(false)
    if (uErr) return setError(uErr.message)
    setForm(null)
    await load()
  }

  function renderSection(title, rows, drag, hint) {
    return (
      <div>
        <div className="mb-2 flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {hint && <span className="text-xs text-gray-400">{hint}</span>}
        </div>
        {!rows.length ? (
          <div className="rounded-xl border border-dashed border-brand-200 bg-white px-4 py-4 text-sm text-gray-400">No items.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-brand-100 bg-white">
            {rows.map((r) => {
              if (r.type === 'category') {
                return (
                  <div key={`cat-${r.name}`} className="border-b border-l-4 border-b-brand-200 border-l-brand-500 bg-brand-100 px-4 py-2 text-sm font-bold text-brand-800">
                    {r.name}
                  </div>
                )
              }
              const it = r.item
              const { isDragging, isDropTarget, ...rowEvents } = drag.rowProps(it.id)
              return (
                <div
                  key={it.id}
                  {...rowEvents}
                  className={`flex items-center gap-2 border-b border-brand-100 px-3 py-2.5 last:border-b-0 ${
                    isDragging ? 'opacity-40' : ''
                  } ${isDropTarget ? 'bg-brand-50' : ''}`}
                >
                  <DragHandle {...drag.handleProps(it.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{it.name}</span>
                      {it.log_type === 'both' && <Badge color="gray">Both logs</Badge>}
                      {it.copy_group_id && <Badge color="brand">🔗 Linked</Badge>}
                    </div>
                    <div className="text-xs text-gray-500">{frequencyLabel(it.frequency_months)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isAdmin && otherStores.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCopyTargets(new Set())
                          setCopyingItem(it)
                        }}
                        className="rounded-lg border border-brand-200 p-1.5 text-brand-700 hover:bg-brand-50"
                        title="Copy to other store…"
                        aria-label="Copy to other store"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg>
                      </button>
                    )}
                    <Button variant="secondary" onClick={() => setForm({ ...EMPTY, ...it, category: it.category ?? '', log_type: it.log_type ?? 'general' })}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => remove(it)}>
                      Delete
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (!currentStoreId) return <EmptyState label="Choose a store first." />

  const otherStores = accessibleStores.filter((s) => s.id !== currentStoreId)
  const toggleTarget = (id) =>
    setCopyTargets((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          Services tracked in the Maintenance Log for <span className="font-medium text-gray-800">{storeName}</span>. Drag ⠿ to reorder.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => setForm({ ...EMPTY })}>+ Add item</Button>
        </div>
      </div>
      <p className="mb-4 text-xs text-gray-400">Items with the same category are shown together under the category name. Leave category empty for a normal row.</p>
      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">{notice}</div>}
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {items === null ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <EmptyState label="No maintenance items yet. Add the first one." />
      ) : (
        <div className="space-y-6">
          {renderSection('Log', generalRows, generalDrag)}
          {renderSection("Manager's Log", managerRows, managerDrag, 'Only shop managers, admin and developer can see these.')}
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit item' : 'Add item'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            {isAdmin && form?.copy_group_id && (
              <Button variant="secondary" onClick={saveToMultiple} disabled={busy || !form.name.trim() || !(Number(form.frequency_months) >= 1)}>
                Save to Multiple Stores
              </Button>
            )}
            <Button onClick={save} disabled={!form?.name.trim() || !(Number(form?.frequency_months) >= 1)}>
              Save
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Service name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Appears in</label>
              <div className="flex gap-2">
                {LOG_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm({ ...form, log_type: t.value })}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      form.log_type === t.value ? 'border-brand-500 bg-brand-50 font-medium text-brand-700' : 'border-gray-200 text-gray-600 hover:border-brand-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {form.log_type === 'manager' && <p className="mt-1 text-xs text-gray-400">Only shop managers, admin and developer can see Manager&apos;s Log items.</p>}
              {form.log_type === 'both' && <p className="mt-1 text-xs text-gray-400">Shows in both Log and Manager&apos;s Log, sharing the same recorded dates. Staff only see it in Log.</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Frequency</label>
              <div className="flex flex-wrap items-center gap-2">
                {FREQ_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setForm({ ...form, frequency_months: p.value })}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      Number(form.frequency_months) === p.value
                        ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                        : 'border-gray-200 text-gray-600 hover:border-brand-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  or every
                  <input
                    type="number"
                    min={1}
                    max={120}
                    className="input !w-20"
                    value={form.frequency_months}
                    onChange={(e) => setForm({ ...form, frequency_months: e.target.value })}
                  />
                  months
                </span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Category (optional)</label>
              <input
                className="input"
                list="maintenance-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Hot Boiling Unit & Faucet Filter Exchange"
              />
              <datalist id="maintenance-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-gray-400">Items with the same category name are grouped together under that name.</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!copyingItem}
        onClose={() => setCopyingItem(null)}
        title={`Copy "${copyingItem?.name ?? ''}" to…`}
        footer={
          <Button onClick={copyToStores} disabled={busy || !copyTargets.size}>
            {busy ? 'Copying…' : `Copy to ${copyTargets.size || ''} store(s)`}
          </Button>
        }
      >
        <div className="space-y-1.5">
          {otherStores.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={copyTargets.has(s.id)} onChange={() => toggleTarget(s.id)} />
              {s.name}
            </label>
          ))}
          <p className="pt-1 text-xs text-gray-400">Copies the name, frequency and category (not recorded dates). Copies stay linked; a same-named item at a store is overwritten after you confirm.</p>
        </div>
      </Modal>
    </div>
  )
}
