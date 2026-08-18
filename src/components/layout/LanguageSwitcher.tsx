import type { Locale } from '../../i18n/locales'
import { useI18n } from '../../i18n/useI18n'

const OPTIONS: Array<{ locale: Locale; short: string; labelKey: 'locale.switchToZhCN' | 'locale.switchToEnUS' }> = [
  { locale: 'zh-CN', short: '中', labelKey: 'locale.switchToZhCN' },
  { locale: 'en-US', short: 'EN', labelKey: 'locale.switchToEnUS' },
]

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div
      role="group"
      aria-label={t('locale.label')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        border: '1px solid var(--border)',
        borderRadius: 999,
        background: 'var(--bg-input)',
        color: 'var(--text-secondary)',
        flexShrink: 0,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {OPTIONS.map((option, index) => {
        const isActive = locale === option.locale
        return (
          <span key={option.locale} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {index > 0 && (
              <span aria-hidden="true" style={{ color: 'var(--text-muted)', padding: '0 2px' }}>
                /
              </span>
            )}
            <button
              type="button"
              aria-label={t(option.labelKey)}
              aria-pressed={isActive}
              onClick={() => setLocale(option.locale)}
              style={{
                border: 'none',
                borderRadius: 999,
                background: isActive ? 'var(--accent-bg)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: isActive ? 700 : 500,
                lineHeight: 1,
                minWidth: option.locale === 'zh-CN' ? 24 : 30,
                padding: '6px 8px',
                boxShadow: isActive ? '0 0 12px rgba(79,215,255,0.10)' : 'none',
              }}
            >
              {option.short}
            </button>
          </span>
        )
      })}
    </div>
  )
}
