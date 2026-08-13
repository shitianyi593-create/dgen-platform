import { useEffect } from 'react'
import { useCredentialsUiStore } from './uiStore'
import { CredentialSection } from './CredentialSection'
import { CREDENTIALS, type CredKey } from './schema'
import { useEnvDrop } from './useEnvDrop'

export function CredentialsDrawer() {
  const drawerOpen = useCredentialsUiStore((s) => s.drawerOpen)
  const drawerTarget = useCredentialsUiStore((s) => s.drawerTarget)
  const expandedSection = useCredentialsUiStore((s) => s.expandedSection)
  const closeDrawer = useCredentialsUiStore((s) => s.closeDrawer)
  const setExpandedSection = useCredentialsUiStore((s) => s.setExpandedSection)

  useEnvDrop(drawerOpen)

  // Esc key closes the drawer (registered globally so it works regardless of focus)
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, closeDrawer])

  const handleToggle = (key: CredKey) => {
    setExpandedSection(expandedSection === key ? null : key)
  }

  return (
    <>
      <div
        className={`cred-drawer-backdrop${drawerOpen ? ' open' : ''}`}
        onClick={closeDrawer}
        aria-hidden="true"
      />
      <aside
        className={`cred-drawer${drawerOpen ? ' open' : ''}`}
        role="dialog"
        aria-label="憑證設定"
        aria-modal="true"
        aria-hidden={!drawerOpen}
        // `inert` blocks Tab focus AND clicks on the closed (off-screen)
        // drawer. Render as undefined when drawer is open so the attribute
        // is absent (React stringifies booleans, and inert="false" is
        // truthy in the HTML spec).
        inert={!drawerOpen || undefined}
      >
        <div className="cred-drawer-h">
          <div>
            <div className="cred-drawer-title">憑證設定</div>
            <div className="cred-drawer-sub">可在任何頁面開啟 · ⌘,</div>
          </div>
          <button
            type="button"
            className="cred-drawer-close"
            aria-label="關閉憑證設定"
            onClick={closeDrawer}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="cred-drawer-body">
          {CREDENTIALS.map((def) => (
            <CredentialSection
              key={def.key}
              credKey={def.key}
              expanded={expandedSection === def.key}
              onToggle={handleToggle}
              target={drawerTarget === def.key}
            />
          ))}
        </div>
      </aside>
    </>
  )
}
