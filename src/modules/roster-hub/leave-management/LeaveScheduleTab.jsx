import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'

export default function LeaveScheduleTab() {
  const { currentStoreId } = useAuth()
  const [leaves, setLeaves] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentStoreId) return
    setLoading(true)
    supabase
      .from('leave_requests')
      .select('*, profiles(first_name,last_name)')
      .eq('store_id', currentStoreId)
      .eq('status', 'active')
      .order('start_at')
      .then(({ data }) => {
        setLeaves(data ?? [])
        setLoading(false)
      })
  }, [currentStoreId])

  if (loading) return <LoadingSpinner />
  if (!leaves.length) return <EmptyState label="No leave scheduled at this store." />

  return (
    <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
      {leaves.map((l) => (
        <div key={l.id} className="flex items-center justify-between px-4 py-2.5">
          <span className="font-medium text-gray-800">
            {l.profiles?.first_name} {l.profiles?.last_name}
          </span>
          <span className="text-sm text-gray-500">
            {new Date(l.start_at).toLocaleString()} – {new Date(l.end_at).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}
