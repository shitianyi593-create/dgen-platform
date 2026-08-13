import { useEffect, useRef, useState, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../../stores/authStore'
import { CREDENTIALS_BY_KEY, type CredKey } from './schema'

interface CredentialFormProps {
  credKey: CredKey
  autoFocus?: boolean
}

export function CredentialForm({ credKey, autoFocus = false }: CredentialFormProps) {
  const def = CREDENTIALS_BY_KEY[credKey]
  const verify = useAuthStore((s) => s.verifyState[credKey])
  const setField = useAuthStore((s) => s.setField)

  // Subscribe only to the slice this form actually needs. useShallow keeps
  // re-renders limited to changes within that slice (vs. the whole store).
  //
  // Read exactly the keys the schema declares — do NOT hand-list them here.
  // A hand-written list silently drifts from schema.ts, and the failure mode is
  // nasty: the missing key resolves to undefined → '' → the controlled input
  // overwrites every keystroke on re-render, so the field looks like it simply
  // refuses input. `textEndpoint` shipped that way and `videoEndpoint25`
  // inherited it. The Record<string,string> cast is what hid it from tsc.
  const fieldValues = useAuthStore(
    useShallow((s): Record<string, string> => {
      const source: Record<string, unknown> =
        credKey === 'inference'
          ? (s as unknown as Record<string, unknown>)
          : credKey === 'asset'
            ? (s.assetCreds as unknown as Record<string, unknown>)
            : (s.tosCreds as unknown as Record<string, unknown>)
      const values: Record<string, string> = {}
      for (const field of CREDENTIALS_BY_KEY[credKey].fields) {
        const raw = source[field.key]
        values[field.key] = typeof raw === 'string' ? raw : ''
      }
      return values
    }),
  )

  // Per-field reveal state for secret inputs. Local to this component instance:
  // closing and reopening the drawer (which unmounts/remounts the form) resets
  // the toggle to hidden, so a casual passerby won't see secrets that were
  // unmasked by a previous user.
  const [shownSecrets, setShownSecrets] = useState<Set<string>>(() => new Set())
  const toggleShown = (fieldKey: string) => {
    setShownSecrets((prev) => {
      const next = new Set(prev)
      if (next.has(fieldKey)) next.delete(fieldKey)
      else next.add(fieldKey)
      return next
    })
  }

  const firstInputRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (autoFocus) firstInputRef.current?.focus()
  }, [autoFocus])

  return (
    <div data-testid={`cred-form-${credKey}`}>
      {verify.status === 'warn' && (
        <div className="cred-err-banner" role="alert">{verify.message}</div>
      )}
      {def.fields.map((field, i) => {
        const id = `cred-${credKey}-${field.key}`
        const isSelect = 'kind' in field && field.kind === 'select'
        const value = fieldValues[field.key] ?? ''
        const isShown = field.secret && shownSecrets.has(field.key)
        return (
          <div key={field.key} className="cred-form-field">
            <label htmlFor={id} className="cred-form-label">{field.label}</label>
            {isSelect ? (
              <select
                id={id}
                ref={i === 0 ? (firstInputRef as RefObject<HTMLSelectElement>) : undefined}
                className="cred-form-input"
                value={value}
                onChange={(e) => setField(credKey, field.key, e.target.value)}
                autoComplete="off"
              >
                {/* Empty placeholder so a fresh form (value === '') shows
                    "請選擇" instead of silently picking the first option. */}
                {value === '' && <option value="" disabled>請選擇…</option>}
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <div className="cred-form-input-wrap">
                <input
                  id={id}
                  ref={i === 0 ? (firstInputRef as RefObject<HTMLInputElement>) : undefined}
                  className={`cred-form-input${field.secret ? ' has-toggle' : ''}`}
                  type={field.secret && !isShown ? 'password' : 'text'}
                  value={value}
                  onChange={(e) => setField(credKey, field.key, e.target.value)}
                  placeholder={'placeholder' in field ? field.placeholder : undefined}
                  spellCheck={false}
                  autoComplete="off"
                />
                {field.secret && (
                  <button
                    type="button"
                    className="cred-form-secret-toggle"
                    aria-label={isShown ? '隱藏' : '顯示'}
                    title={isShown ? '隱藏' : '顯示'}
                    onClick={() => toggleShown(field.key)}
                  >
                    {isShown ? (
                      // eye-off
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      // eye-on
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            )}
            {field.hint && (
              <div
                className="cred-form-field-hint"
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: 'var(--text-muted)',
                  whiteSpace: 'pre-line',
                }}
              >
                {field.hint}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
