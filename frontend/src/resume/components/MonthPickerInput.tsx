import { DatePicker } from '@arco-design/web-react'

// 简历编辑器复用的月份选择器。
// 显示格式 YYYY.MM（点号），存储格式 YYYY-MM（连字符，与后端归一化约定一致）。
// 之所以分离显示与存储：纯文本 Input 上套格式化会破坏输入体验（光标跳动），
// 用受控的 MonthPicker 让 value=Date、显示与存储各走各的。

const MONTH_PICKER_FORMAT = 'YYYY.MM'

/** 把存储的 "YYYY-MM" / "YYYY.MM" / "YYYY年MM" 解析成 Date（给选择器）。 */
function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const raw = value.trim()
  if (!raw || raw === '至今' || raw === 'present' || raw === 'now') return undefined
  const compact = raw.match(/^(\d{4})(\d{2})$/)
  if (compact) {
    const month = Number(compact[2])
    return month >= 1 && month <= 12 ? new Date(Number(compact[1]), month - 1, 1) : undefined
  }
  const match = raw.match(/(\d{4})[.\-/年。．]\s*(\d{1,2})(?!\d)/)
  if (!match) return undefined
  const month = Number(match[2])
  if (month < 1 || month > 12) return undefined
  const d = new Date(Number(match[1]), month - 1, 1)
  return isNaN(d.getTime()) ? undefined : d
}

/** 把选择器选中的 Date 转成 "YYYY-MM" 存储。 */
function formatMonth(date: unknown): string {
  if (!date) return ''
  let d: Date
  if (date instanceof Date) {
    d = date
  } else if (typeof date === 'string' || typeof date === 'number') {
    d = new Date(date)
  } else if (typeof date === 'object' && date !== null && 'toDate' in date && typeof (date as { toDate?: () => Date }).toDate === 'function') {
    d = (date as { toDate: () => Date }).toDate()
  } else {
    return ''
  }
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function MonthPickerInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <DatePicker.MonthPicker
      format={MONTH_PICKER_FORMAT}
      value={toDate(value)}
      onChange={(_dateString, date) => onChange(formatMonth(date))}
      placeholder={placeholder}
      allowClear
      disabled={disabled}
      style={{ flex: 1, minWidth: 0 }}
    />
  )
}
