import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from './StudyLogList'
import TakeAQuizModal from './TakeAQuizModal'
import StudySummaryModal from './StudySummaryModal'
import QuizHistoryList from './QuizHistoryList'
import TrainingJourneyPage from './TrainingJourneyPage'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Jeff, 2026-10-02 (Training Journey spec, point 2): the old "Performance"
// tab (Quiz History / Progress chart / Study summary) is gone — Progress
// chart is removed entirely (superseded by the new Training Journey tab's
// own hours-based phase view), and Quiz History / Study Summary move to sit
// right next to the Take a Quiz button instead of behind a second tab, both
// opening as a popup on click rather than taking over the page. A new
// top-level "Training Journey" tab sits alongside the Study Log list itself.
// Jeff, 2026-10-19: "將training journey移到study log左邊" — Training
// Journey now sits first/leftmost, and (see the `tab` state's initial value
// below) is also what opens by default now, ahead of the plain Study Log
// checklist.
const TABS = [
  { key: 'training_journey', label: '🏆 Training Journey' },
  { key: 'study_log', label: 'Study Log' },
]

// Jeff, 2026-10-03: "原本新員工進度每20%考試的機制取消，因為現在有phase
// level up exam" — the old "every 20% of Must Know Item progress forces a
// Quick Quiz" check (StudyLogPage used to run it on mount and after every
// Study Log tick) is gone, along with its forced/non-dismissable mode in
// TakeAQuizModal.jsx. The new Training Journey phase system already gates
// progress the same way, properly: each phase's own Level-Up Exam, not a
// blanket Quick-Quiz-every-20%. Take a Quiz now always opens on its mode
// picker, dismissable, same as any voluntary quiz.
export default function StudyLogPage() {
  const { profile } = useAuth()
  const qualified = !!profile?.qualified
  const [tab, setTab] = useState('training_journey')
  const [showQuiz, setShowQuiz] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'training_journey' ? (
        <TrainingJourneyPage profileId={profile?.id} isSelf />
      ) : (
        <StudyLogList
          profileId={profile?.id}
          qualified={qualified}
          headerActions={
            <div className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 p-1">
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => setShowQuiz(true)}>
                📝 Take a Quiz
              </Button>
              <Button className="!px-3 !py-1.5 text-xs" variant="secondary" onClick={() => setShowHistory(true)}>
                🧾 Quiz History
              </Button>
              <Button className="!px-3 !py-1.5 text-xs" variant="secondary" onClick={() => setShowSummary(true)}>
                📊 Study Summary
              </Button>
            </div>
          }
        />
      )}

      {showQuiz && (
        <TakeAQuizModal
          onClose={() => setShowQuiz(false)}
          onCompleted={() => setShowQuiz(false)}
        />
      )}
      {showHistory && (
        <Modal open onClose={() => setShowHistory(false)} wide title="🧾 Quiz History">
          <QuizHistoryList profileId={profile?.id} />
        </Modal>
      )}
      {showSummary && <StudySummaryModal profileId={profile?.id} onClose={() => setShowSummary(false)} />}
    </div>
  )
}
