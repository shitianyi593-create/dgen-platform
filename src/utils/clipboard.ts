import toast from 'react-hot-toast'

/**
 * Wrapper around the Clipboard API. Returns true on success, false when
 * the API is missing or the write throws (e.g. permission denied).
 *
 * Lives in its own module so tests can `vi.mock(...)` this file directly
 * instead of fighting jsdom's navigator object.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  return false
}

/**
 * copyToClipboard + 標準 toast 回饋（成功：「已複製<label>」；失敗：Clipboard
 * API 不可用）。VideoPreview / ImageHistory / ImagePreview 共用同一份文案。
 */
export async function copyWithToast(label: string, value: string | undefined): Promise<void> {
  if (!value) return
  const ok = await copyToClipboard(value)
  if (ok) toast.success(`已複製${label}`)
  else toast.error('複製失敗：瀏覽器不支援 Clipboard API')
}
