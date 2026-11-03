import { useState } from 'react'
import { useAuth } from '../../../lib/AuthContext'
import { invokeFunction } from '../../../lib/invokeFunction'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

// Jeff, 2026-11-03: "staff information上方新增invite user，但這邊只能邀請該分店並且
// 是staff的員工，一樣邀請後跳出介面填姓名。要邀請manager以上的user還是要從user
// management邀請".
//
// Deliberately has no Role or Store choice: it always creates a plain Staff
// account on the store currently selected (top right). The invite-user Edge
// Function enforces the same limits server-side (mode "store_staff"), so this
// can't be used to create a manager or to add someone to another store even
// by calling the function directly.
export default function InviteStaffModal({ onClose, onInvited }) {
  const { currentStoreId, accessibleStores } = useAuth()
  const storeName = accessibleStores.find((s) => s.id === currentStoreId)?.name ?? 'this store'
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const cleanEmail = email.trim().toLowerCase()
    const { data, error: fnError } = await invokeFunction('invite-user', {
      mode: 'store_staff',
      email: cleanEmail,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      store_id: currentStoreId,
      redirectTo: `${window.location.origin}/set-password`,
    })
    setBusy(false)
    if (fnError || !data?.user_id) {
      setError(fnError || 'Invite failed.')
      return
    }
    onInvited(cleanEmail)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite staff"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-staff-form" disabled={busy || !email.trim() || !firstName.trim()}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </>
      }
    >
      <form id="invite-staff-form" onSubmit={submit}>
        <p className="mb-4 text-sm text-gray-600">
          Invites a new <span className="font-medium">Staff</span> member to <span className="font-medium">{storeName}</span>. To
          invite a manager or another role, use Admin Center &gt; User Management.
        </p>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Email</span>
          <input
            className="input"
            type="email"
            required
            autoFocus
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">First name</span>
            <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">Last name</span>
            <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </label>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          They get an email with a link to set their password. Like any new person, they start hidden from the roster
          until a manager adds them in Roster Staff Order.
        </p>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  )
}
