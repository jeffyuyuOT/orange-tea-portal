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
      <StudyLogList
        profileId={profile?.id}
        headerActions={
          <>
            <Button className="!px-3 !py-1.5 text-xs" onClick={() => setShowQuiz(true)}>
              🧠 Quick Quiz
            </Button>
            <Button className="!px-3 !py-1.5 text-xs" variant="secondary" onClick={() => setShowFormalQuiz(true)}>
              📝 Formal Quiz
            </Button>
          </>
        }
      />
      {showQuiz && <QuickQuizModal onClose={() => setShowQuiz(false)} />}
      {showFormalQuiz && <FormalQuizModal onClose={() => setShowFormalQuiz(false)} />}
    </div>
  )
}
