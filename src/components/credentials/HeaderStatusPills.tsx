import { useAuthStore } from '../../stores/authStore'
import { useI18n } from '../../i18n/useI18n'
import { CREDENTIALS, STATUS_TEXT_KEYS, type CredKey } from './schema'

interface HeaderStatusPillsProps {
  onPillClick: (key: CredKey) => void
}

export function HeaderStatusPills({ onPillClick }: HeaderStatusPillsProps) {
  const verifyState = useAuthStore((s) => s.verifyState)
  const { t } = useI18n()
  return (
    <div className="status-pill-cluster" role="group" aria-label={t('credentials.statusGroup')}>
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
              {t(def.labelKey)} {t(STATUS_TEXT_KEYS[status])}
            </span>
            <span className="dot" />
            <span id={pillLabelId}>{t(def.pillLabelKey)}</span>
          </button>
        )
      })}
    </div>
  )
}
