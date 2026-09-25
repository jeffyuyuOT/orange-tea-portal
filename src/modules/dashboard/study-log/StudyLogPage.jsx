import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from './StudyLogList'
import QuickQuizModal from './QuickQuizModal'
import FormalQuizModal from './FormalQuizModal'
import ProgressChartModal from './ProgressChartModal'
import StudySummaryModal from './StudySummaryModal'
import Button from '../../../components/ui/Button'

export default function StudyLogPage() {
  const { profile } = useAuth()
  const [showQuiz, setShowQuiz] = useState(false)
  const [showFormalQuiz, setShowFormalQuiz] = useState(false)
  const [showProgressChart, setShowProgressChart] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  return (
    <div>
      <StudyLogList
        profileId={profile?.id}
        headerActions={
          <>
            {/* Progress chart / Study summary get their own gray color
                block, separate from the orange Quick/Formal Quiz block to
                its right — two different kinds of action (review your
                stats vs. take a quiz), so Jeff asked for them to read as
                visually distinct groups rather than one row of buttons. */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1">
              <button
                onClick={() => setShowProgressChart(true)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:shadow-sm"
              >
                📈 Progress chart
              </button>
              <button
                onClick={() => setShowSummary(true)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-white hover:shadow-sm"
              >
                📊 Study summary
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 p-1">
              <Button className="!px-3 !py-1.5 text-xs" onClick={() => setShowQuiz(true)}>
                🧠 Quick Quiz
              </Button>
              <Button className="!px-3 !py-1.5 text-xs" variant="secondary" onClick={() => setShowFormalQuiz(true)}>
                📝 Formal Quiz
              </Button>
            </div>
          </>
        }
      />
      {showQuiz && <QuickQuizModal onClose={() => setShowQuiz(false)} />}
      {showFormalQuiz && <FormalQuizModal onClose={() => setShowFormalQuiz(false)} />}
      {showProgressChart && <ProgressChartModal profileId={profile?.id} onClose={() => setShowProgressChart(false)} />}
      {showSummary && <StudySummaryModal profileId={profile?.id} onClose={() => setShowSummary(false)} />}
    </div>
  )
}
