const BLOCK_BREAK_TAGS = /<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6)>/gi
const BREAK_TAGS = /<br\s*\/?>/gi
const LIST_ITEM_OPEN_TAG = /<li[^>]*>/gi
const HTML_TAGS = /<[^>]+>/g

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export function richTextToLines(content: string) {
  if (!content) return []

  const normalized = decodeHtmlEntities(
    content
      .replace(BREAK_TAGS, '\n')
      .replace(LIST_ITEM_OPEN_TAG, '\n')
      .replace(BLOCK_BREAK_TAGS, '\n'),
  )

  return normalized
    .replace(HTML_TAGS, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function richTextToTextarea(content: string) {
  return richTextToLines(content).join('\n')
}

function escapeHtml(content: string) {
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function textareaToListHtml(content: string) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return ''
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
}

export function textareaToParagraphHtml(content: string) {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return ''
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}
