import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { mapToCreds, parseEnv } from './envImport'

const MAX_FILE_BYTES = 64 * 1024

/**
 * Hidden feature: while `active` is true, listen on `document` for a dropped
 * .env file and bulk-import its values into the auth store. Completely silent
 * by design — no toast, no overlay, no console logging. File is never
 * persisted (no upload, no IndexedDB) — only the parsed values flow into the
 * normal auth-store path.
 */
export function useEnvDrop(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer) return
      const hasFile = Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === 'file')
      if (!hasFile) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer) return
      const file = e.dataTransfer.files[0]
      if (!file) return
      e.preventDefault()
      if (file.size > MAX_FILE_BYTES) return
      let text: string
      try {
        text = await file.text()
      } catch {
        return
      }
      const parts = mapToCreds(parseEnv(text))
      if (!parts.inference && !parts.asset && !parts.tos) return
      useAuthStore.getState().applyImportedEnv(parts)
    }

    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [active])
}
