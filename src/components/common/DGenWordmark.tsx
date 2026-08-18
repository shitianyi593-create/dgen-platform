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
        letterSpacing: 0,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        fontWeight: 700,
        textShadow: '0 0 18px rgba(79, 215, 255, 0.22)',
      }}
    >
      {BRAND.wordmark}
    </span>
  )
}
