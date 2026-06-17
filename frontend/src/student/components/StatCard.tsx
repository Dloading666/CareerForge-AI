import type { ReactNode } from 'react'

export function StatCard({
  icon,
  label,
  value,
  unit,
  hint,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string | number
  unit?: string
  hint?: string
  tone?: 'default' | 'success' | 'warning' | 'info'
}) {
  const toneColor =
    tone === 'success' ? '#22C55E' : tone === 'warning' ? '#F59E0B' : tone === 'info' ? '#3B82F6' : '#7C4DFF'
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ background: 'rgba(' + hexToRgb(toneColor) + ', 0.12)', color: toneColor }}>
        {icon}
      </div>
      <div className="stat-card-body">
        <div className="stat-card-label">{label}</div>
        <div className="stat-card-value">
          <span className="stat-card-value-num" style={{ color: toneColor }}>{value}</span>
          {unit && <span className="stat-card-value-unit">{unit}</span>}
        </div>
        {hint && <div className="stat-card-hint">{hint}</div>}
      </div>
    </div>
  )
}

function hexToRgb(hex: string): string {
  const m = hex.replace('#', '').match(/[0-9a-fA-F]{2}/g)
  if (!m) return '124, 77, 255'
  return m.slice(0, 3).map((c) => parseInt(c, 16)).join(', ')
}
