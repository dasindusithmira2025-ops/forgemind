import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './Button'

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-notice" role="alert"><AlertTriangle size={16} /><span>{message}</span>{onRetry && <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={onRetry}>Retry</Button>}</div>
}
