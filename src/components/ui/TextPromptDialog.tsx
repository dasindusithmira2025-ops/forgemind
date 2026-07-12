import { useState, type FormEvent } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface TextPromptDialogProps {
  title: string
  label: string
  initialValue?: string
  confirmLabel?: string
  onClose: () => void
  onConfirm: (value: string) => void
}

export function TextPromptDialog({ title, label, initialValue = '', confirmLabel = 'Save', onClose, onConfirm }: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (trimmed) onConfirm(trimmed)
  }
  return <Modal title={title} onClose={onClose}>
    <form className="prompt-form" onSubmit={submit}>
      <label><span>{label}</span><input data-autofocus value={value} onChange={(event) => setValue(event.target.value)} /></label>
      <div className="modal-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={!value.trim()}>{confirmLabel}</Button></div>
    </form>
  </Modal>
}
