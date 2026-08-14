import { useAuthStore, PENDING_TEST_MSG } from '../../stores/authStore'
import { useI18n } from '../../i18n/useI18n'
import { CREDENTIALS_BY_KEY, STATUS_TEXT_KEYS, type CredKey } from './schema'
import { CredentialForm } from './CredentialForm'

interface CredentialSectionProps {
  credKey: CredKey
  expanded: boolean
  onToggle: (key: CredKey) => void
  target?: boolean
}

export function CredentialSection({
  credKey, expanded, onToggle, target = false,
}: CredentialSectionProps) {
  const def = CREDENTIALS_BY_KEY[credKey]
  const verify = useAuthStore((s) => s.verifyState[credKey])
  const runVerify = useAuthStore((s) => s.verify)
  const { t } = useI18n()

  const pendingTest = expanded && verify.message === PENDING_TEST_MSG

  return (
    <section
      className={[
        'cred-section',
        expanded ? 'expanded' : '',
        target ? 'target' : '',
      ].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="cred-section-h"
        aria-expanded={expanded}
        onClick={() => onToggle(credKey)}
      >
        <svg className="cred-chev" width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <div className="cred-meta">
          <div className="cred-meta-title">{t(def.labelKey)}</div>
          <div className="cred-meta-hint">{t(def.hintKey)}</div>
        </div>
        <span className="cred-pill" data-state={verify.status}>
          {t(STATUS_TEXT_KEYS[verify.status])}
        </span>
      </button>
      {expanded && (
        <div className="cred-section-body">
          <CredentialForm credKey={credKey} autoFocus={target} />
          <div className="cred-section-actions">
            {credKey === 'inference' ? (
              // Inference uses live local format validation; no manual test button needed.
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {verify.status === 'ok' ? verify.message : t('credentials.liveValidation')}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={pendingTest}
                  onClick={() => { void runVerify(credKey) }}
                >
                  {pendingTest ? PENDING_TEST_MSG : t('credentials.testConnection')}
                </button>
                {verify.status === 'ok' && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{verify.message}</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
