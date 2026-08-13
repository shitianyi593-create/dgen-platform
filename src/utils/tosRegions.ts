/**
 * Canonical list of BytePlus TOS regions exposed in the credentials UI.
 * The endpoint is always derivable from the region — see `regionToEndpoint`.
 *
 * Rendered as a native <select> in the form; the list is exhaustive
 * (us-east-1 is excluded — BytePlus TOS does not support that region).
 */
export const TOS_REGIONS = [
  'ap-southeast-1',
  'ap-southeast-3',
  'cn-beijing',
  'cn-shanghai',
  'cn-guangzhou',
  'cn-hongkong',
] as const

export type TosRegion = (typeof TOS_REGIONS)[number]

export const DEFAULT_REGION: TosRegion = 'ap-southeast-1'

/**
 * Derive the canonical TOS endpoint hostname from a region.
 * BytePlus pattern: `tos-{region}.bytepluses.com`.
 *
 * Returns '' for blank input — the caller decides whether that's an error.
 */
export function regionToEndpoint(region: string): string {
  const cleaned = region.trim().toLowerCase()
  if (!cleaned) return ''
  return `tos-${cleaned}.bytepluses.com`
}
