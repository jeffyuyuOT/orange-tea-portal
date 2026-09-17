import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import StaffStudyDetail from './StaffStudyDetail'

export default function LearningTrackerPage() {
  const { currentStoreId } = useAuth()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!currentStoreId) return
    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('primary_store_id', currentStoreId)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => {
        setStaff(data ?? [])
        setLoading(false)
      })
  }, [currentStoreId])

  if (selected) return <StaffStudyDetail staff={selected} onBack={() => setSelected(null)} />

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Learning Tracker</h1>
      <p className="mb-4 text-sm text-gray-500">Study log progress and quiz history for staff at this store.</p>

      {loading ? (
        <LoadingSpinner />
      ) : !staff.length ? (
        <EmptyState label="No staff at this store yet." />
      ) : (
        <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-brand-50"
            >
              <span className="font-medium text-gray-800">
                {s.first_name} {s.last_name}
              </span>
              <span className="text-gray-300">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
