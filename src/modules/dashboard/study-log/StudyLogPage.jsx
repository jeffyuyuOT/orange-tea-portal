import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from './StudyLogList'
import QuickQuizModal from './QuickQuizModal'
import FormalQuizModal from './FormalQuizModal'
import ProgressChartModal from './ProgressChartModal'
import StudySummaryModal from './StudySummaryModal'
import QuizHistoryList from './QuizHistoryList'
import Button from '../../../components/ui/Button'

// Second-level picker inside the "Performance" tab — Progress chart / Study
// summary open as the same modal popups they always have (ProgressChartModal
// / StudySummaryModal are shared with Shop Management > Learning Tracker's
// StaffStudyDetail.jsx, which also opens them as popups, so this keeps both
// call sites consistent instead of forking a second, inline-only version).
// Quiz History has no modal of its own — QuizHistoryList is already a plain
// list that opens AttemptDetailModal itself on row click — so it renders
// directly in the tab body and is the default view.
const PERFORMANCE_VIEWS = [
  { key: 'history', label: '🧾 Quiz History' },
  { key: 'chart', label: '📈 Progress chart' },
  { key: 'summary', label: '📊 Study summary' },
]

export default function StudyLogPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('log') // 'log' | 'performance'
  const [performanceView, setPerformanceView] = useState('history')
  const [showQuiz, setShowQuiz] = useState(false)
  const [showFormalQuiz, setShowFormalQuiz] = useState(false)

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg border border-brand-200 bg-brand-50 p-1">
        {[
          { key: 'log', label: 'Study Log' },
          { key: 'performance', label: 'Performance' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-brand-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'log' ? (
        <StudyLogList
          profileId={profile?.id}
          headerActions={
            <div className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 p-1">
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => setShowQuiz(true)}>
                🧠 Quick Quiz
              </Button>
              <Button className="!px-3 !py-1.5 text-xs" variant="secondary" onClick={() => setShowFormalQuiz(true)}>
                📝 Formal Quiz
              </Button>
            </div>
          }
        />
      ) : (
        <div>
          <div className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
            {PERFORMANCE_VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setPerformanceView(v.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  performanceView === v.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <QuizHistoryList profileId={profile?.id} />
        </div>
      )}

      {showQuiz && <QuickQuizModal onClose={() => setShowQuiz(false)} />}
      {showFormalQuiz && <FormalQuizModal onClose={() => setShowFormalQuiz(false)} />}
      {performanceView === 'chart' && tab === 'performance' && (
        <ProgressChartModal profileId={profile?.id} onClose={() => setPerformanceView('history')} />
      )}
      {performanceView === 'summary' && tab === 'performance' && (
        <StudySummaryModal profileId={profile?.id} onClose={() => setPerformanceView('history')} />
      )}
    </div>
  )
}
