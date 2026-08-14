import { useLocation, useNavigate } from 'react-router-dom'
import { HeaderStatusPills } from '../credentials/HeaderStatusPills'
import { useCredentialsUiStore } from '../credentials/uiStore'
import { BRAND } from '../../brand/config'
import { DGenWordmark } from '../common/DGenWordmark'
import { useI18n } from '../../i18n/useI18n'
import type { MessageKey } from '../../i18n/locales'
import { LanguageSwitcher } from './LanguageSwitcher'

// Only the implemented tabs are shown. 語音模型 is still in the roadmap
// (see README "後續開發") but not built yet — kept out of nav so users
// don't click into a placeholder.
const TABS: Array<{ path: string; labelKey: MessageKey }> = [
  { path: '/video', labelKey: 'nav.video' },
  { path: '/video-25', labelKey: 'nav.video25' },
  { path: '/image', labelKey: 'nav.image' },
  { path: '/chat', labelKey: 'nav.chat' },
  { path: '/assets', labelKey: 'nav.assets' },
]

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const openDrawer = useCredentialsUiStore((s) => s.openDrawer)
  const { t } = useI18n()

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '0 24px',
        height: 56,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        flexShrink: 0,
      }}
    >
      {/* Brand */}
      <div
        aria-label={BRAND.title}
        style={{ display: 'flex', alignItems: 'center', color: 'var(--text-primary)', flexShrink: 0 }}
      >
        <DGenWordmark />
      </div>

      {/* Tabs — nowrap + no-shrink so the CJK labels can't wrap inside the
          fixed 56px header band. The 5th tab (影片生成 2.5) narrowed the
          slack between the logo block and the status pills; without these
          the labels start wrapping around ~1100px viewport width. */}
      <nav
        aria-label="Primary"
        style={{
          display: 'flex',
          gap: 4,
          flex: '1 1 auto',
          minWidth: 0,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {TABS.map(({ path, labelKey }) => {
          const isActive = location.pathname === path
          const label = t(labelKey)
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              style={{
                padding: '8px 16px',
                background: isActive ? 'var(--bg-input)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                border: isActive ? '1px solid var(--border)' : '1px solid transparent',
                borderRadius: 6,
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: isActive ? 500 : 400,
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          )
        })}
      </nav>

      {/* Right side: language switcher + status pills + gear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <LanguageSwitcher />
        <HeaderStatusPills onPillClick={openDrawer} />
        <button
          type="button"
          aria-label={t('credentials.openSettings')}
          onClick={() => openDrawer()}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: 4,
            display: 'grid',
            placeItems: 'center',
          }}
          title={`${t('credentials.title')} (⌘,)`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
