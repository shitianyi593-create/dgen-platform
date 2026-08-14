import { BRAND } from '../../brand/config'

interface DGenWordmarkProps {
  compact?: boolean
}

export function DGenWordmark({ compact = false }: DGenWordmarkProps) {
  return (
    <span
      aria-label={BRAND.name}
      style={{
        color: 'inherit',
        display: 'inline-flex',
        alignItems: 'baseline',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: compact ? 15 : 18,
        letterSpacing: compact ? '-0.04em' : '-0.055em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        fontWeight: 650,
      }}
    >
      {BRAND.wordmark}
    </span>
  )
}
