import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import Button from '../../../components/ui/Button'
import { fetchMenuExportData, exportMenuAsPdf, exportMenuAsExcel } from '../../../lib/menuExport'

const SECTIONS = [
  { key: 'drink', label: 'Drink' },
  { key: 'tea', label: 'Tea' },
  { key: 'toppings', label: 'Toppings' },
  { key: 'others', label: 'Others' },
  { key: 'shop_training', label: 'Shop Training' },
]

export default function MenuExportPanel() {
  const [stores, setStores] = useState([])
  const [selected, setSelected] = useState(() => new Set(SECTIONS.map((s) => s.key)))
  const [storeId, setStoreId] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('stores')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setStores(data ?? []))
  }, [])

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function run(exportFn) {
    if (!selected.size) {
      setError('Pick at least one section to export.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const data = await fetchMenuExportData({ groups: [...selected], storeId })
      exportFn(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-brand-100 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-brand-700">Menu Export (PDF / Excel)</h2>
      <p className="mb-3 text-sm text-gray-500">
        Prints out the formula database as a compact sheet. "Export PDF" opens your browser's print dialog with
        minimal margins already set — choose "Save as PDF" there to get a file. "Export Excel" downloads an .xlsx
        directly (no colours/bold there — just the text).
      </p>

      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-gray-500">Sections</span>
        <div className="flex flex-wrap gap-3">
          {SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)} />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-gray-500">Store</span>
        <select className="input max-w-xs" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="all">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Only affects items restricted to specific stores in Edit Item — items visible everywhere are always
          included regardless of this choice.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => run(exportMenuAsPdf)} disabled={busy}>
          {busy ? 'Preparing…' : 'Export PDF'}
        </Button>
        <Button variant="secondary" onClick={() => run(exportMenuAsExcel)} disabled={busy}>
          {busy ? 'Preparing…' : 'Export Excel'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  )
}
