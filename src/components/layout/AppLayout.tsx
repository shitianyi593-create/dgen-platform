import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Header from './Header'
import { CredentialsDrawer } from '../credentials/CredentialsDrawer'
import { useCredentialsUiStore } from '../credentials/uiStore'

export default function AppLayout() {
  // ⌘, / Ctrl+, → toggle drawer.
  // We read current state via useCredentialsUiStore.getState() inside the
  // handler instead of via React subscription so the effect can run once
  // and the listener never has to re-register.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ',' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const { drawerOpen, openDrawer, closeDrawer } = useCredentialsUiStore.getState()
        if (drawerOpen) closeDrawer()
        else openDrawer()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'relative',
        background:
          'linear-gradient(180deg, rgba(79, 215, 255, 0.04), rgba(8, 11, 18, 0) 22%), transparent',
      }}
    >
      <Header />
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <Outlet />
      </main>
      {/* Drawer mounts at root so its absolutely-positioned backdrop covers
          the whole app and is not clipped by main's overflow:hidden. */}
      <CredentialsDrawer />
    </div>
  )
}
