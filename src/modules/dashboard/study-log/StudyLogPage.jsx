import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from './StudyLogList'
import QuickQuizModal from './QuickQuizModal'
import FormalQuizModal from './FormalQuizModal'
import Button from '../../../components/ui/Button'

export default function StudyLogPage() {
  const { profile } = useAuth()
  const [showQuiz, setShowQuiz] = useState(false)
  const [showFormalQuiz, setShowFormalQuiz] = useState(false)

  return (
    <div>
      <StudyLogList profileId={profile?.id} />
      <div className="mt-5 flex justify-center gap-3">
        <Button onClick={() => setShowQuiz(true)}>🧠 Quick Quiz</Button>
        <Button variant="secondary" onClick={() => setShowFormalQuiz(true)}>
          📝 Formal Quiz
        </Button>
      </div>
      {showQuiz && <QuickQuizModal onClose={() => setShowQuiz(false)} />}
      {showFormalQuiz && <FormalQuizModal onClose={() => setShowFormalQuiz(false)} />}
    </div>
  )
}
