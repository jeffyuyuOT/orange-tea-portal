import { useCallback, useEffect, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Badge from '../../../../components/ui/Badge'
import Modal from '../../../../components/ui/Modal'
import StoreManager from './StoreManager'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { loadPaymentTypes, savePaymentType, savePaymentTypeOrder } from '../bkData'
import { Field, Notice, StoreTabs, inputCls } from '../bkUi'

const bySort = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)

// Payment type view of 資料維護: the Sales-figure columns of ONE store — order,
// add, rename, activate / deactivate. Cash and Total Eftpos are locked (can be
// moved, not renamed or switched off). Nothing is ever deleted: a deactivated
// column just stops showing on the SF sheet (unless a month still has data in it).
function PaymentTypePanel({ stores, sfStoreId, active, onChanged }) {
  const [pickedId, setStoreId] = useState(sfStoreId)
  // The picked store may have just been deleted in 分店管理 — fall back to the
  // first one that still exists instead of reading/seeding a store that is gone.
  const storeId = stores.some((s) => s.id === pickedId) ? pickedId : (stores[0]?.id ?? null)
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { id?, kind, name, parent_id, is_active }
  const [formError, setFormError] = useState('')

  useEffect(() => {
    if (active) setStoreId(sfStoreId)
  }, [active, sfStoreId])

  const reload = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    setError('')
    try {
      setTypes(await loadPaymentTypes(storeId))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    if (active) reload()
  }, [active, reload])

  const mains = types.filter((t) => t.kind === 'main').sort(bySort)
  const subsOf = (mainId) => types.filter((t) => t.kind === 'sub' && t.parent_id === mainId).sort(bySort)

  async function move(group, index, delta) {
    const target = index + delta
    if (target < 0 || target >= group.length) return
    const ids = group.map((t) => t.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setError('')
    try {
      await savePaymentTypeOrder(ids)
      await reload()
      onChanged?.()
    } catch (e) {
      setError(e.message)
    }
  }

  function openNew(kind) {
    setFormError('')
    // Cash is always O.CA − D, so it can't be a parent.
    const firstParent = mains.find((m) => m.name !== 'Cash')
    setEditing({ kind, name: '', parent_id: kind === 'sub' ? (firstParent?.id ?? '') : null, is_active: true })
  }
  function openEdit(t) {
    setFormError('')
    setEditing({ id: t.id, kind: t.kind, name: t.name, parent_id: t.parent_id, is_active: t.is_active })
  }

  async function save() {
    const name = editing.name.trim()
    if (!name) return setFormError('請輸入名稱。')
    if (editing.kind === 'sub' && !editing.parent_id) return setFormError('請選擇它屬於哪一個主 payment type。')
    if (types.some((t) => t.id !== editing.id && t.name.toLowerCase() === name.toLowerCase())) {
      return setFormError('這間分店已經有同名的 payment type。')
    }
    try {
      const group = editing.kind === 'main' ? mains : subsOf(editing.parent_id)
      await savePaymentType(storeId, {
        ...editing,
        name,
        sort_order: group.length ? Math.max(...group.map((t) => t.sort_order)) + 1 : 0,
      })
      setEditing(null)
      await reload()
      onChanged?.()
    } catch (e) {
      setFormError(e.message)
    }
  }

  const parentHasOwnColumn = (parentId) => parentId && subsOf(parentId).length === 0

  const renderRow = (t, group, index) => (
    <li key={t.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
      <div className="flex flex-col">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => move(group, index, -1)}
          className="text-xs leading-none text-gray-400 hover:text-brand-600 disabled:opacity-30"
          aria-label="Move left"
        >
          ▲
        </button>
        <button
          type="button"
          disabled={index === group.length - 1}
          onClick={() => move(group, index, 1)}
          className="text-xs leading-none text-gray-400 hover:text-brand-600 disabled:opacity-30"
          aria-label="Move right"
        >
          ▼
        </button>
      </div>
      <span className={`font-medium ${t.is_active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{t.name}</span>
      {t.is_locked && <Badge color="gray">鎖定</Badge>}
      {!t.is_active && <Badge color="red">已停用</Badge>}
      <Button variant="secondary" className="ml-auto" disabled={t.is_locked} onClick={() => openEdit(t)}>
        編輯
      </Button>
    </li>
  )

  return (
    <div className="space-y-4">
      <StoreTabs stores={stores} storeId={storeId} onChange={setStoreId} />
      <Notice kind="info">
        以下設定只套用在目前這間分店。順序由上到下 = SF 頁面由左到右。Cash 與 Total Eftpos 不能編輯，其餘可編輯 / 新增 / 停用。
      </Notice>
      {error && <Notice kind="error" onClose={() => setError('')}>{error}</Notice>}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-brand-900">主 Payment type</h3>
              <Button onClick={() => openNew('main')}>＋ 新增主 payment type</Button>
            </div>
            <ul className="space-y-1.5">
              {mains.map((t, i) => renderRow(t, mains, i))}
            </ul>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-brand-900">Sub Payment type</h3>
              <Button onClick={() => openNew('sub')}>＋ 新增 sub payment type</Button>
            </div>
            {mains.every((m) => subsOf(m.id).length === 0) && <p className="text-sm text-gray-400">還沒有 sub payment type。</p>}
            {mains
              .filter((m) => subsOf(m.id).length > 0)
              .map((m) => {
                const group = subsOf(m.id)
                return (
                  <div key={m.id} className="space-y-1.5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">under {m.name}</div>
                    <ul className="space-y-1.5">
                      {group.map((t, i) => renderRow(t, group, i))}
                    </ul>
                  </div>
                )
              })}
          </section>
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`${editing?.id ? '編輯' : '新增'}${editing?.kind === 'main' ? '主' : ' sub '} payment type`}
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
            <Field label="名稱">
              <input
                className={`${inputCls} w-full`}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                autoFocus
              />
            </Field>
            {editing.kind === 'sub' && (
              <Field label="屬於哪一個主 payment type">
                <select
                  className={`${inputCls} w-full`}
                  value={editing.parent_id ?? ''}
                  onChange={(e) => setEditing({ ...editing, parent_id: e.target.value })}
                >
                  {mains
                    .filter((m) => m.name !== 'Cash')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {editing.id && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_active}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                />
                啟用（取消勾選 = 不再顯示在 SF 頁面，已輸入的歷史資料保留）
              </label>
            )}
            {editing.kind === 'sub' && parentHasOwnColumn(editing.parent_id) && (
              <Notice kind="info">
                加入第一個 sub 後，這個主 payment type 會改為「由 sub 加總」，原本直接輸入在它自己欄位的金額將不再計入。
              </Notice>
            )}
            {formError && <Notice kind="error">{formError}</Notice>}
          </div>
        )}
      </Modal>
    </div>
  )
}

const VIEWS = [
  ['types', 'Payment type'],
  ['stores', '分店管理'],
]

// 資料維護: Payment type (per store) and 分店管理 (which stores BK has).
export default function SfMaintenance({ stores, sfStoreId, active, onChanged, onStoresChanged }) {
  const [view, setView] = useState('types')
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {VIEWS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${
              view === k ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'types' ? (
        stores.length === 0 ? (
          <Notice kind="info">還沒有分店，請先到「分店管理」新增。</Notice>
        ) : (
          <PaymentTypePanel stores={stores} sfStoreId={sfStoreId} active={active && view === 'types'} onChanged={onChanged} />
        )
      ) : (
        <StoreManager stores={stores} onChanged={onStoresChanged} />
      )}
    </div>
  )
}
