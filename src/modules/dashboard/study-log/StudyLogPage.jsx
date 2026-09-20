import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { useAuth } from '../../../lib/AuthContext'
import StudyTabs from './StudyTabs'
import QuickQuizModal from './QuickQuizModal'
import Button from '../../../components/ui/Button'

export default function StudyLogPage() {
  const { profile } = useAuth()
  const [showQuiz, setShowQuiz] = useState(false)
  const [forcedDue, setForcedDue] = useState(false)
  const [progressPercent, setProgressPercent] = useState(null)
  const [historyKey, setHistoryKey] = useState(0)

  // Every time the memorized-% (across all active formula items, senior
  // staff counting as 100%) crosses another 10% band since the last quiz
  // attempt, a Quick Quiz becomes mandatory before they can dismiss it.
  async function checkForcedQuiz() {
    if (!profile?.id) return
    const { data: activeItems } = await supabase.from('formula_items').select('id').eq('is_active', true)
    const activeIds = (activeItems ?? []).map((i) => i.id)
    if (!activeIds.length) return

    let memorizedCount
    if (profile.is_senior) {
      memorizedCount = activeIds.length
    } else {
      const { data: memorizedRows } = await supabase
        .from('study_progress')
        .select('formula_item_id')
        .eq('profile_id', profile.id)
        .eq('memorized', true)
        .in('formula_item_id', activeIds)
      memorizedCount = memorizedRows?.length ?? 0
    }
    const percent = Math.round((memorizedCount / activeIds.length) * 100)
    setProgressPercent(percent)

    const { data: lastAttempt } = await supabase
      .from('quiz_attempts')
      .select('progress_snapshot')
      .eq('profile_id', profile.id)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastMilestone = Math.floor((lastAttempt?.progress_snapshot ?? 0) / 10)
    const currentMilestone = Math.floor(percent / 10)
    setForcedDue(currentMilestone > lastMilestone && currentMilestone > 0)
  }

  useEffect(() => {
    checkForcedQuiz()
  }, [profile?.id, profile?.is_senior]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <StudyTabs
        profileId={profile?.id}
        senior={profile?.is_senior}
        onProgressChange={checkForcedQuiz}
        historyRefreshKey={historyKey}
        logExtra={
          <div className="mt-5 flex justify-center">
            <Button onClick={() => setShowQuiz(true)}>🧠 Quick Quiz</Button>
          </div>
        }
      />

      {(showQuiz || forcedDue) && (
        <QuickQuizModal
          forced={forcedDue}
          progressPercent={progressPercent}
          onClose={() => setShowQuiz(false)}
          onCompleted={() => {
            setShowQuiz(false)
            setForcedDue(false)
            setHistoryKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
