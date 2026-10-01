import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Jeff, 2026-10-02: "能跳出小視窗提示clock in at幾點/clock out at幾點嗎，因為
// 現在只有status的直接轉換員工很容易會掃兩次，而且小視窗彈出沒有按掉前，沒
// 辦法再scan一次，以防停留太久scan兩次" — the result of a scan used to just
// be a quiet status flip (ClockInOutTab) or a toast that auto-dismissed
// itself after a few seconds (AppShell's header shortcut), neither of which
// stopped someone from immediately scanning again — easy to do by accident
// if they lingered in front of the camera a moment too long, or weren't
// sure the first scan actually registered. This is a real Modal instead
// (`dismissable={false}` — no ✕, no click-outside-to-close) that has to be
// closed with its own OK button before the caller's "Scan" button becomes
// clickable again; the caller is responsible for disabling that button
// while `feedback` is still set (see ClockInOutTab / AppShell) — this
// component only renders the popup itself, since both call sites need the
// exact same message/behavior for both a successful punch and a rejected
// scan (wrong store, expired code, etc. — those need dismissing before
// trying again too, not just a successful clock in/out).
export default function ClockFeedbackModal({ feedback, onClose }) {
  const isSuccess = feedback.type === 'success'
  return (
    <Modal
      open
      onClose={onClose}
      dismissable={false}
      title={isSuccess ? 'Recorded' : 'Not recorded'}
      footer={
        <Button onClick={onClose} className="!w-full !py-3 !text-base">
          OK
        </Button>
      }
    >
      {/* Jeff, 2026-10-02: "能大一點嗎，要跳出獨立視窗在螢幕中間的效果" — the
          original was just a title bar + one line of text, easy to mistake
          for a small toast rather than something that demands a tap to
          dismiss. A big icon + much larger message (same modal/backdrop
          mechanics, dismissable=false) makes it read as a real standalone
          popup rather than an inline status line. */}
      <div className="flex flex-col items-center gap-3 py-5 text-center">
        <span className="text-6xl leading-none" aria-hidden>
          {isSuccess ? '✅' : '⚠️'}
        </span>
        <p className={`text-2xl font-semibold ${isSuccess ? 'text-green-700' : 'text-red-600'}`}>{feedback.text}</p>
      </div>
    </Modal>
  )
}
