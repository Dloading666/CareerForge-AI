interface Props { value: number; onChange: (v: number) => void; disabled?: boolean }

export function ReasoningSlider({ value, onChange, disabled }: Props) {
  const intense = value >= 75

  return (
    <div className="reasoning-slider">
      <div className={`reasoning-slider-track${intense ? ' reasoning-slider-track--deep' : ''}`}>
        <div className="reasoning-slider-fill" style={{ '--slider-percent': `${value}%` } as React.CSSProperties} />
        {intense && (
          <div className="reasoning-slider-sparks">
            {Array.from({ length: 12 }).map((_, i) => <span key={i} className="reasoning-slider-spark" />)}
          </div>
        )}
        <input type="range" min="0" max="100" value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled} className="reasoning-slider-input"
        />
      </div>
      <div className="reasoning-slider-labels">
        <span className={value <= 12 ? 'active' : ''} onClick={() => onChange(0)}>快速</span>
        <span className={value > 12 && value <= 37 ? 'active' : ''} onClick={() => onChange(25)}>较浅</span>
        <span className={value > 37 && value <= 62 ? 'active' : ''} onClick={() => onChange(50)}>均衡</span>
        <span className={value > 62 && value <= 87 ? 'active' : ''} onClick={() => onChange(75)}>较深</span>
        <span className={value > 87 ? 'active' : ''} onClick={() => onChange(100)}>深度</span>
      </div>
    </div>
  )
}
