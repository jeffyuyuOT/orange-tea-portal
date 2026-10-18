import { useEffect, useState } from 'react'
import Button from '../../../../components/ui/Button'
import Modal from '../../../../components/ui/Modal'
import LoadingSpinner from '../../../../components/ui/LoadingSpinner'
import { Notice } from '../bkUi'
import { buildReply } from './replyAccountant'

// 回復會計: the reply to the accountant, dated today, with every store's current
// COH from U帳 分店現金. Copy it and paste into the e-mail.
export default function ReplyAccountantModal({ open, onClose, stores }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setCopied(false)
    buildReply(stores)
      .then((t) => !cancelled && setText(t))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, stores])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="回復會計"
      footer={
        <>
          <Button variant="secondary" onClick={copy} disabled={loading || !text}>
            {copied ? '已複製 ✓' : '複製'}
          </Button>
          <Button onClick={onClose}>關閉</Button>
        </>
      }
    >
      {loading && <LoadingSpinner />}
      {error && <Notice kind="error">{error}</Notice>}
      {!loading && !error && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => (setText(e.target.value), setCopied(false))}
            rows={16}
            className="w-full rounded-lg border border-brand-200 p-3 font-mono text-sm"
          />
          <p className="text-xs text-gray-400">日期是今天；金額是各分店 U帳 分店現金目前的 COH（本月）。內容可以先改再複製。</p>
        </div>
      )}
    </Modal>
  )
}
