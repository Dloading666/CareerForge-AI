function isPresent(value: string) {
  const text = value.trim().toLowerCase()
  return text === '至今' || text === 'present' || text === 'now'
}

function formatMonthToken(year: string, month: string) {
  const monthNumber = Number(month)
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return ''
  return `${year}.${String(monthNumber).padStart(2, '0')}`
}

function extractMonthTokens(value: string) {
  const tokens: string[] = []
  const pattern = /(?:\b(\d{4})(\d{2})\b|\b(\d{4})\s*[.\-/年。．]\s*(\d{1,2})(?!\d))/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const token = formatMonthToken(match[1] || match[3], match[2] || match[4])
    if (token) tokens.push(token)
  }
  return tokens
}

export function formatResumeMonth(value: string | null | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  if (isPresent(raw)) return '至今'
  const tokens = extractMonthTokens(raw)
  return tokens[0] ?? raw
}

export function formatResumeDateRange(start: string | null | undefined, end: string | null | undefined) {
  const startText = formatResumeMonth(start)
  const endText = formatResumeMonth(end)
  if (startText && endText) return `${startText}-${endText}`
  return startText || endText
}

export function formatResumeDateText(value: string | null | undefined) {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const tokens = extractMonthTokens(raw)
  const hasPresent = /(?:至今|present|now)/i.test(raw)
  if (tokens.length >= 2) return `${tokens[0]}-${tokens[1]}`
  if (tokens.length === 1 && hasPresent) return `${tokens[0]}-至今`
  if (tokens.length === 1) return tokens[0]
  return raw
}
