import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import StudyLogList from './StudyLogList'
import QuickQuizModal from './QuickQuizModal'
import Button from '../../../components/ui/Button'

export default function StudyLogPage() {
  const { profile } = useAuth()
  const [showQuiz, setShowQuiz] = useState(false)

  return (
    <div>
      <StudyLogList profileId={profile?.id} />
      <div className="mt-5 flex justify-center">
        <Button onClick={() => setShowQuiz(true)}>🧠 Quick Quiz</Button>
      </div>
      {showQuiz && <QuickQuizModal onClose={() => setShowQuiz(false)} />}
    </div>
  )
}
