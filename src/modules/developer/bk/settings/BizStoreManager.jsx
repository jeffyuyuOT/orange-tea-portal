import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { addSalesStore, deleteSalesStore, saveSalesStoreOrder, salesStoreDayCount, updateSalesStore } from '../bkSalesData'
import { Field, Notice, inputCls } from '../bkUi'

// 系統設置 > 營業 > 分店管理: the stores the 營業 tab shows (bk_sales_stores) —
// add, rename, delete and reorder (top to bottom = left to right on the 營業
// tab). Each store can be linked to one of BK's SF stores: a linked store takes
// its POS from that SF store's O.POST, and its Self O is the default for that SF store's
// Self order kiosk (SF can still be edited by hand; a mismatch shows a warning). An unlinked store types POS by hand. This list is separate
// from the SF / U帳 list (系統設置 > SF > 分店管理), and deleting here only
// removes the store's 營業 figures.
export default function BizStoreManager({ salesStores, sfStores, onChanged }) {
  const [editing, setEditing] = useState(null) // { id?, name, sfStoreId }
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(null) // { store, days, typed }
  const [error, setError] = useState('')

  const sfName = (id) => sfStores.find((s) => s.id === id)?.name
  const nameTaken = (name, exceptId) =>
    salesStores.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === name.trim().toLowerCase())
  // An SF store can feed only one 營業 store.
  const sfOptions = (exceptId) =>
    sfStores.filter((s) => !salesStores.some((b) => b.id !== exceptId && b.sf_store_id === s.id))

  function openAdd() {
    setFormError('')
    setEditing({ name: '', sfStoreId: '' })
  }

  async function save() {
    const name = editing.name.trim()
    if (!name) return setFormError('請輸入分店名稱。')
    if (nameTaken(name, editing.id)) return setFormError('已經有同名的分店。')
    try {
      if (editing.id) await updateSalesStore(editing.id, { name, sfStoreId: editing.sfStoreId })
      else await addSalesStore({ name, sfStoreId: editing.sfStoreId }, salesStores)
      setEditing(null)
      await onChanged?.()
    } catch (e) {
      setFormError(e.message)
    }
  }

  async function move(index, delta) {
    const target = index + delta
    if (target < 0 || target >= salesStores.length) return
    const ids = salesStores.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setError('')
    try {
      await saveSalesStoreOrder(ids)
      await onChanged?.()
    } catch (e) {
      setError(e.message)
    }
  }

  async function askDelete(store) {
    setError('')
    try {
      setDeleting({ store, days: await salesStoreDayCount(store.id), typed: '' })
    } catch (e) {
      setError(e.message)
    }
  }

  async function confirmDelete() {
    try {
      await deleteSalesStore(deleting.store.id)
      setDeleting(null)
      await onChanged?.()
    } catch (e) {
      setDeleting({ ...deleting, error: e.message })
    }
  }

  return (
    <div className="max-w-2xl space-y-3">
      <Notice kind="info">
        只有在這裡的分店才會出現在「鷹眼」分頁。順序由上到下 = 鷹眼分頁的分店分頁由左到右。連結消費展望分店後，POS 會直接讀消費展望的 O.POST，Self O 會是該消費展望分店 Self order kiosk 的預設值（消費展望可手動改，不一致會有警示）；不連結的話 POS 要手動輸入。
      </Notice>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-brand-900">鷹眼分店（{salesStores.length}）</h3>
        <Button onClick={openAdd}>＋ 新增分店</Button>
      </div>

      {salesStores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-8 text-center text-sm text-gray-500">
          還沒有任何鷹眼分店。請先新增一間，「鷹眼」分頁才會有資料可以輸入。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {salesStores.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="text-xs leading-none text-gray-400 hover:text-brand-600 disabled:opacity-30"
                  aria-label="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={i === salesStores.length - 1}
                  onClick={() => move(i, 1)}
                  className="text-xs leading-none text-gray-400 hover:text-brand-600 disabled:opacity-30"
                  aria-label="Move down"
                >
                  ▼
                </button>
              </div>
              <span className="font-medium text-gray-800">{s.name}</span>
              <span className="text-xs text-gray-400">
                {s.sf_store_id ? `連結消費展望：${sfName(s.sf_store_id) ?? '（已刪除）'}` : 'POS 手動輸入'}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFormError('')
                    setEditing({ id: s.id, name: s.name, sfStoreId: s.sf_store_id ?? '' })
                  }}
                >
                  編輯
                </Button>
                <Button variant="danger" onClick={() => askDelete(s)}>
                  刪除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? '編輯鷹眼分店' : '新增鷹眼分店'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={save}>儲存</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="分店名稱">
              <input
                className={`${inputCls} w-full`}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                autoFocus
              />
            </Field>
            <Field label="連結消費展望分店" hint="連結後 POS 讀消費展望的 O.POST，Self O 是該消費展望分店 Self order kiosk 的預設值">
              <select
                className={`${inputCls} w-full`}
                value={editing.sfStoreId}
                onChange={(e) => setEditing({ ...editing, sfStoreId: e.target.value })}
              >
                <option value="">不連結（POS 手動輸入）</option>
                {sfOptions(editing.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {formError && <Notice kind="error">{formError}</Notice>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`刪除鷹眼分店：${deleting?.store.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="danger" disabled={deleting?.typed.trim() !== deleting?.store.name.trim()} onClick={confirmDelete}>
              永久刪除
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="space-y-3 text-sm">
            {deleting.days > 0 ? (
              <Notice kind="error">
                刪除後，這間分店在「鷹眼」的 {deleting.days} 天資料（POS、CV、Self O、杯數）會永久消失、無法復原。
                {deleting.store.sf_store_id && '它連結的消費展望分店之後只剩消費展望自己存的 Self order kiosk 數字，不再有鷹眼的 Self O 可以預設。'}
              </Notice>
            ) : (
              <Notice kind="info">這間分店在「鷹眼」還沒有任何資料。</Notice>
            )}
            <Field label={`請輸入分店名稱「${deleting.store.name}」確認刪除`}>
              <input
                className={`${inputCls} w-full`}
                value={deleting.typed}
                onChange={(e) => setDeleting({ ...deleting, typed: e.target.value })}
              />
            </Field>
            {deleting.error && <Notice kind="error">{deleting.error}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  )
}
