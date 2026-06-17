import { useId } from 'react'

export type RadarPoint = {
  key: string
  label: string
  value: number
}

export function RadarChart({
  points,
  size = 360,
  maxValue = 100,
  highlightKey,
}: {
  points: RadarPoint[]
  size?: number
  maxValue?: number
  highlightKey?: string
}) {
  const cx = size / 2
  const cy = size / 2
  const radius = (size / 2) * 0.7
  const n = points.length
  const fillId = useId()

  if (n === 0) {
    return <div className="radar-empty">暂无数据</div>
  }

  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n

  const gridLevels = [0.25, 0.5, 0.75, 1]

  const valueToCoord = (i: number, v: number) => {
    const r = (Math.max(0, Math.min(maxValue, v)) / maxValue) * radius
    return { x: cx + r * Math.cos(angle(i)), y: cy + r * Math.sin(angle(i)) }
  }

  const polygonPoints = points
    .map((p, i) => {
      const c = valueToCoord(i, p.value)
      return c.x + ',' + c.y
    })
    .join(' ')

  return (
    <div className="radar-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={'0 0 ' + size + ' ' + size}>
        <defs>
          <radialGradient id={fillId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7C4DFF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#2962FF" stopOpacity="0.18" />
          </radialGradient>
        </defs>
        {gridLevels.map((lv, li) => {
          const r = radius * lv
          const pts = points
            .map((_, i) => {
              return cx + r * Math.cos(angle(i)) + ',' + (cy + r * Math.sin(angle(i)))
            })
            .join(' ')
          return (
            <polygon
              key={li}
              points={pts}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          )
        })}
        {points.map((_, i) => {
          const x = cx + radius * Math.cos(angle(i))
          const y = cy + radius * Math.sin(angle(i))
          return (
            <line
              key={'axis-' + i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
          )
        })}
        <polygon
          points={polygonPoints}
          fill={'url(#' + fillId + ')'}
          stroke="#7C4DFF"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {points.map((p, i) => {
          const c = valueToCoord(i, p.value)
          const isHighlight = p.key === highlightKey
          return (
            <circle
              key={'pt-' + p.key}
              cx={c.x}
              cy={c.y}
              r={isHighlight ? 5 : 3.5}
              fill={isHighlight ? '#FFC53D' : '#7C4DFF'}
              stroke="#fff"
              strokeWidth="1.5"
            />
          )
        })}
        {points.map((p, i) => {
          const lx = cx + (radius + 22) * Math.cos(angle(i))
          const ly = cy + (radius + 22) * Math.sin(angle(i))
          return (
            <g key={'label-' + p.key}>
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.78)"
                fontSize="13"
                fontWeight="500"
              >
                {p.label}
              </text>
              <text
                x={lx}
                y={ly + 16}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={p.value >= 80 ? '#22C55E' : p.value >= 60 ? '#F59E0B' : '#EF4444'}
                fontSize="11"
                fontWeight="700"
              >
                {Math.round(p.value)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
