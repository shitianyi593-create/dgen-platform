import { create } from 'zustand'
import type { CredKey } from './schema'

interface UiState {
  /** Whether the credentials drawer is open. */
  drawerOpen: boolean
  /**
   * Which credential the user navigated FROM (e.g. clicked a status pill).
   * Drives the highlight/glow CSS class on the matching section. Set once at
   * open time, cleared on close. Distinct from `expandedSection` because the
   * user may then expand a different section manually inside the drawer.
   */
  drawerTarget: CredKey | null
  /**
   * Currently expanded accordion section. The user controls this by clicking
   * section headers — only one section can be expanded at a time.
   */
  expandedSection: CredKey | null
  openDrawer: (target?: CredKey) => void
  closeDrawer: () => void
  setExpandedSection: (key: CredKey | null) => void
}

export const useCredentialsUiStore = create<UiState>((set) => ({
  drawerOpen: false,
  drawerTarget: null,
  expandedSection: null,
  openDrawer: (target) => set({
    drawerOpen: true,
    drawerTarget: target ?? null,
    // If a target is requested, auto-expand that section.
    expandedSection: target ?? null,
  }),
  // Reset expandedSection on close so the drawer doesn't surprise the user
  // by remembering the last manual expand on the next open-without-target.
  closeDrawer: () => set({ drawerOpen: false, drawerTarget: null, expandedSection: null }),
  setExpandedSection: (key) => set({ expandedSection: key }),
}))
