import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import LoadingSpinner, { EmptyState } from '../../../components/ui/LoadingSpinner'
import AttemptDetailModal from './AttemptDetailModal'

// Every quiz attempt for one person — when it was taken, score (e.g. "8 out
// of 10") — newest first; click a row for the full question-by-question
// breakdown. Shared between "My Dashboard > Study Log" (own history) and
// "Shop Management > Learning Tracker" (a manager viewing a staff member's
// history).
export default function QuizHistoryList({ profileId, refreshKey }) {
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [openAttempt, setOpenAttempt] = useState(null)

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    supabase
      .from('quiz_attempts')
      .select('*')
      .eq('profile_id', profileId)
      .order('taken_at', { ascending: false })
      .then(({ data }) => {
        setAttempts(data ?? [])
        setLoading(false)
      })
  }, [profileId, refreshKey])

  if (loading) return <LoadingSpinner />
  if (!attempts.length) return <EmptyState label="No quiz attempts yet." />

  return (
    <div>
      <div className="divide-y divide-brand-100 rounded-xl border border-brand-100 bg-white">
        {attempts.map((a) => (
          <button
            key={a.id}
            onClick={() => setOpenAttempt(a)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-brand-50"
          >
            <span className="text-sm text-gray-700">{new Date(a.taken_at).toLocaleString()}</span>
            <span className="text-sm font-medium text-brand-600">
              {a.correct_count} out of {a.total_questions}
            </span>
          </button>
        ))}
      </div>
      {openAttempt && <AttemptDetailModal attempt={openAttempt} onClose={() => setOpenAttempt(null)} />}
    </div>
  )
}
