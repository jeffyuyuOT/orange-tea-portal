import { useAuth } from '../../lib/AuthContext'

export default function StoreSwitcher() {
  const { accessibleStores, currentStoreId, setCurrentStoreId } = useAuth()

  if (accessibleStores.length <= 1) {
    return accessibleStores.length === 1 ? (
      <span className="text-sm font-medium text-brand-700">{accessibleStores[0].name}</span>
    ) : null
  }

  return (
    <select
      value={currentStoreId ?? ''}
      onChange={(e) => setCurrentStoreId(e.target.value)}
      className="rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-sm font-medium text-brand-800"
    >
      {accessibleStores.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}
