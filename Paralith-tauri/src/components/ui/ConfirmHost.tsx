import { Button } from './Button'
import { Modal } from './Modal'
import { useConfirmStore } from './confirm'

/** Mounted once per window. Renders the head of the confirmation queue. See `./confirm.ts`. */
export function ConfirmHost() {
  const pending = useConfirmStore((state) => state.queue[0])
  const settle = useConfirmStore((state) => state.settle)
  if (!pending) return null

  const danger = pending.intent === 'danger'
  const close = () => settle(pending.id, false)

  return <Modal title={pending.title} onClose={close}>
    <div className="confirm-dialog">
      {pending.body && <p className="confirm-body">{pending.body}</p>}
      {pending.details && pending.details.length > 0 && <ul className="confirm-details">
        {pending.details.map((detail) => <li key={detail}>{detail}</li>)}
      </ul>}
      <div className="modal-actions">
        {/* A destructive dialog focuses Cancel: Enter must never be the key that destroys work. */}
        <Button variant="ghost" data-autofocus={danger ? '' : undefined} onClick={close}>
          {pending.cancelLabel ?? 'Cancel'}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          data-autofocus={danger ? undefined : ''}
          onClick={() => settle(pending.id, true)}
        >
          {pending.confirmLabel ?? 'Confirm'}
        </Button>
      </div>
    </div>
  </Modal>
}
