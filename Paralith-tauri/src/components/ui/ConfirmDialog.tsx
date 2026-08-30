import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmRequest {
  title: string
  body: ReactNode
  confirmLabel?: string
}

/**
 * Promise-based confirmation rendered with the application Modal.
 *
 * `window.confirm` blocks the webview and cannot be styled or keyboard-trapped like the rest of the
 * product, so flows that need an answer before continuing use this instead. Returns the dialog node
 * to render and an async `confirm` that resolves once the user answers or dismisses.
 */
export function useConfirm(): [ReactNode, (request: ConfirmRequest) => Promise<boolean>] {
  const [request, setRequest] = useState<ConfirmRequest>()
  const resolveRef = useRef<(value: boolean) => void>(undefined)

  const settle = useCallback((value: boolean) => {
    setRequest(undefined)
    resolveRef.current?.(value)
    resolveRef.current = undefined
  }, [])
  const confirm = useCallback((next: ConfirmRequest) => new Promise<boolean>((resolve) => {
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setRequest(next)
  }), [])

  const dialog = request ? <Modal title={request.title} onClose={() => settle(false)}>
    <div className="confirm-dialog">
      <div className="confirm-body">{request.body}</div>
      <div className="modal-actions"><Button variant="ghost" onClick={() => settle(false)}>Cancel</Button><Button variant="primary" onClick={() => settle(true)}>{request.confirmLabel ?? 'Continue'}</Button></div>
    </div>
  </Modal> : null

  return [dialog, confirm]
}
