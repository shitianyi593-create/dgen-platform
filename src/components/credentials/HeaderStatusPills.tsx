import { useAuthStore } from '../../stores/authStore'
import { CREDENTIALS, STATUS_TEXT, type CredKey } from './schema'

interface HeaderStatusPillsProps {
  onPillClick: (key: CredKey) => void
}

export function HeaderStatusPills({ onPillClick }: HeaderStatusPillsProps) {
  const verifyState = useAuthStore((s) => s.verifyState)
  return (
    <div className="status-pill-cluster" role="group" aria-label="憑證狀態">
      {CREDENTIALS.map((def) => {
        const status = verifyState[def.key].status
        const fullLabelId = `${def.key}-full-label`
        const pillLabelId = `${def.key}-pill-label`
        return (
          <button
            key={def.key}
            type="button"
            className="status-pill"
            data-state={status}
            aria-labelledby={`${fullLabelId} ${pillLabelId}`}
            onClick={() => onPillClick(def.key)}
          >
            <span id={fullLabelId} className="sr-only">
              {def.label} {STATUS_TEXT[status]}
            </span>
            <span className="dot" />
            <span id={pillLabelId}>{def.pillLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
