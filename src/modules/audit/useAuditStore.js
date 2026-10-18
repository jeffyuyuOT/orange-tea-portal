import { useEffect } from 'react'
import { useAuth } from '../../lib/AuthContext'

// Jeff, 2026-10-18: Audit is switched on per store in Store Management
// (stores.audit_enabled). Inside Audit the store switcher only lists those
// stores, so if the globally selected store isn't one of them this moves the
// selection to the first that is. `storeId` stays null until that settles
// (or forever, if nothing is enabled for this person).
export function useAuditStore() {
  const { accessibleStores, currentStoreId, setCurrentStoreId } = useAuth()
  const auditStores = accessibleStores.filter((s) => s.audit_enabled)
  const current = auditStores.find((s) => s.id === currentStoreId)
  const firstId = auditStores[0]?.id

  useEffect(() => {
    if (!current && firstId) setCurrentStoreId(firstId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, firstId])

  return { storeId: current?.id ?? null, storeName: current?.name ?? '', hasAuditStores: auditStores.length > 0 }
}
