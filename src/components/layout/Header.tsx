import { useLocation, useNavigate } from 'react-router-dom'
import { HeaderStatusPills } from '../credentials/HeaderStatusPills'
import { useCredentialsUiStore } from '../credentials/uiStore'
import { BRAND } from '../../brand/config'
import { DGenWordmark } from '../common/DGenWordmark'

// Only the implemented tabs are shown. 語音模型 is still in the roadmap
// (see README "後續開發") but not built yet — kept out of nav so users
// don't click into a placeholder.
const TABS = [
  { path: '/video', label: '影片生成' },
  { path: '/video-25', label: '影片生成 2.5' },
  { path: '/image', label: '圖片生成' },
  { path: '/chat', label: '文字生成' },
  { path: '/assets', label: '私有素材庫管理' },
]

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const openDrawer = useCredentialsUiStore((s) => s.openDrawer)

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
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
        style={{ display: 'flex', alignItems: 'center', color: 'var(--text-primary)' }}
      >
        <DGenWordmark />
      </div>

      {/* Tabs — nowrap + no-shrink so the CJK labels can't wrap inside the
          fixed 56px header band. The 5th tab (影片生成 2.5) narrowed the
          slack between the logo block and the status pills; without these
          the labels start wrapping around ~1100px viewport width. */}
      <nav style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {TABS.map(({ path, label }) => {
          const isActive = location.pathname === path
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

      {/* Right side: status pills + gear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <HeaderStatusPills onPillClick={openDrawer} />
        <button
          type="button"
          aria-label="開啟憑證設定"
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
          title="憑證設定 (⌘,)"
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
