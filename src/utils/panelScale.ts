/**
 * Helpers for the resizable side-panel font scaling.
 *
 * Each resizable panel exposes a `--panel-scale` CSS variable on its root
 * (e.g. style={{ '--panel-scale': computePanelScale(width, 320) }}).
 * Inline pixel font-sizes that should follow the resize use {@link scaledFs}
 * to expand into a calc() expression that picks up the variable.
 *
 * The scale itself is intentionally clamped to a narrow range so very narrow
 * panels keep readable text and very wide panels don't blow up the typography.
 */

const DEFAULT_MIN_SCALE = 0.88
const DEFAULT_MAX_SCALE = 1.18

/**
 * Map an actual panel width to a clamped scale ratio against its default
 * width. At default width the scale is exactly 1.
 */
export function computePanelScale(
  actualWidth: number,
  defaultWidth: number,
  minScale: number = DEFAULT_MIN_SCALE,
  maxScale: number = DEFAULT_MAX_SCALE,
): number {
  if (defaultWidth <= 0) return 1
  const raw = actualWidth / defaultWidth
  if (!Number.isFinite(raw)) return 1
  if (raw < minScale) return minScale
  if (raw > maxScale) return maxScale
  return raw
}

/**
 * Build a fontSize value that scales with the enclosing panel.
 *
 *   fontSize: scaledFs(13)
 *     → fontSize: 'calc(13px * var(--panel-scale, 1))'
 *
 * Falls back to 1 when no `--panel-scale` is in scope, so the helper is
 * safe to use in components that may render outside a resizable panel.
 */
export function scaledFs(px: number): string {
  return `calc(${px}px * var(--panel-scale, 1))`
}
