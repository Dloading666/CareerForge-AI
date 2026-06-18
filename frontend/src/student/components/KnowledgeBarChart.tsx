export type KnowledgeItem = {
  name: string
  mastery: number
  asked_count: number
  avg_score: number
}

export function KnowledgeBarChart({ items, max = 10 }: { items: KnowledgeItem[]; max?: number }) {
  const list = items.slice(0, max)
  if (list.length === 0) {
    return <div className="kn-empty">暂无知识点数据，完成面试后会自动生成</div>
  }
  return (
    <div className="kn-chart">
      {list.map((k, i) => {
        const pct = Math.max(0, Math.min(100, k.mastery))
        const color = pct >= 80 ? '#22C55E' : pct >= 60 ? '#3B82F6' : pct >= 40 ? '#F59E0B' : '#EF4444'
        return (
          <div key={k.name + '-' + i} className="kn-row">
            <div className="kn-row-label" title={k.name}>
              <span className="kn-row-name">{k.name}</span>
              <span className="kn-row-meta">被问 {k.asked_count} 次 · 均 {k.avg_score}</span>
            </div>
            <div className="kn-row-bar">
              <div
                className="kn-row-bar-fill"
                style={{ width: pct + '%', background: 'linear-gradient(90deg, ' + color + ' 0%, ' + color + 'AA 100%)' }}
              />
              <span className="kn-row-value" style={{ color }}>{Math.round(pct)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
