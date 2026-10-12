import { useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import { addStore, deleteStore, renameStore, storeDataCounts } from '../bkData'
import { Field, Notice, inputCls } from '../bkUi'

// 分店管理: the stores BK knows about. Only a store listed here shows up in
// Sales figure / U帳. This list is BK's own (bk_stores) — adding or deleting
// here never touches the portal's stores. Deleting removes that store's BK
// data (SF months, U帳 days, 收支, payment types, opening balance) for good,
// so it asks for the store's name before going ahead.
export default function StoreManager({ stores, onChanged }) {
  const [editing, setEditing] = useState(null) // { id?, name }
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(null) // { store, counts, typed }
  const [error, setError] = useState('')

  const nameTaken = (name, exceptId) =>
    stores.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === name.trim().toLowerCase())

  async function save() {
    const name = editing.name.trim()
    if (!name) return setFormError('請輸入分店名稱。')
    if (nameTaken(name, editing.id)) return setFormError('已經有同名的分店。')
    try {
      if (editing.id) await renameStore(editing.id, name)
      else await addStore(name, stores)
      setEditing(null)
      await onChanged?.()
    } catch (e) {
      setFormError(e.message)
    }
  }

  async function askDelete(store) {
    setError('')
    try {
      setDeleting({ store, counts: await storeDataCounts(store.id), typed: '' })
    } catch (e) {
      setError(e.message)
    }
  }

  async function confirmDelete() {
    try {
      await deleteStore(deleting.store.id)
      setDeleting(null)
      await onChanged?.()
    } catch (e) {
      setDeleting({ ...deleting, error: e.message })
    }
  }

  const hasData = deleting && deleting.counts.sfMonths + deleting.counts.cashDays + deleting.counts.entries > 0

  return (
    <div className="max-w-2xl space-y-3">
      <Notice kind="info">
        只有在這裡的分店才會出現在 BK 頁面（Sales figure 與 U帳）。這份名單只屬於 BK，新增或刪除不會影響 OT Portal 本身的分店。
      </Notice>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-brand-900">分店（{stores.length}）</h3>
        <Button
          onClick={() => {
            setFormError('')
            setEditing({ name: '' })
          }}
        >
          ＋ 新增分店
        </Button>
      </div>

      {stores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-8 text-center text-sm text-gray-500">
          還沒有任何分店。請先新增一間，BK 才會有資料可以輸入。
        </p>
      ) : (
        <ul className="space-y-1.5">
          {stores.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
              <span className="font-medium text-gray-800">{s.name}</span>
              <div className="ml-auto flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFormError('')
                    setEditing({ id: s.id, name: s.name })
                  }}
                >
                  改名
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
        title={editing?.id ? '分店改名' : '新增分店'}
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
            {!editing.id && <p className="text-xs text-gray-400">新增後會自動建立預設的 payment type（Cash、Total Eftpos 等），可到「Payment type」調整。</p>}
            {formError && <Notice kind="error">{formError}</Notice>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`刪除分店：${deleting?.store.name ?? ''}`}
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
            {hasData ? (
              <Notice kind="error">
                刪除後，這間分店在 BK 的所有資料會一併永久消失、無法復原：Sales figure {deleting.counts.sfMonths} 個月、U帳每日紀錄{' '}
                {deleting.counts.cashDays} 天、收支 {deleting.counts.entries} 筆，以及 payment type 設定與期初餘額。
              </Notice>
            ) : (
              <Notice kind="info">這間分店在 BK 還沒有任何資料（只會移除它的 payment type 設定）。</Notice>
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
