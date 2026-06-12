const BLOCK_BREAK_TAGS = /<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|h5|h6)>/gi
const BREAK_TAGS = /<br\s*\/?>/gi
const LIST_ITEM_OPEN_TAG = /<li[^>]*>/gi
const HTML_TAGS = /<[^>]+>/g

// Tags we explicitly KEEP in inline-HTML mode (so bold/italic/code flow through to the resume preview).
// Anything not in this set is stripped (or escaped) to avoid XSS.
const ALLOWED_INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'code', 'br', 'span'])
const ALLOWED_ATTRS_PER_TAG: Record<string, string[]> = {
  span: ['style'],
  // b/i are accepted for legacy paste compatibility, normalised to strong/em below
}
const SAFE_STYLE_PROPS = new Set(['color', 'background-color', 'font-weight', 'font-style', 'text-decoration'])

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

/**
 * Whitelist-based HTML sanitizer for inline formatting.
 * Keeps <strong>/<em>/<u>/<code>/<br>/<span style="...">.
 * Strips scripts, event handlers, javascript: URLs, etc.
 * Returns safe HTML that can be passed to dangerouslySetInnerHTML.
 */
export function sanitizeInlineHtml(html: string): string {
  if (!html) return ''
  // Drop <script> and <style> blocks first (their content is the real danger)
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // Walk every tag and decide to keep/escape
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_full, slash, tag, attrs) => {
    const tagLower = tag.toLowerCase()
    if (!ALLOWED_INLINE_TAGS.has(tagLower)) {
      // Strip the entire tag, but keep inner text
      return ''
    }
    // For closing tags just emit </tag>
    if (slash) return '</' + tagLower + '>'
    // For opening tags, only keep allowed attrs
    const allowedAttrs = ALLOWED_ATTRS_PER_TAG[tagLower] ?? []
    const keptAttrs: string[] = []
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(attrs))) {
      const name = m[1].toLowerCase()
      const value = m[3] ?? m[4] ?? ''
      if (!allowedAttrs.includes(name)) continue
      if (tagLower === 'span' && name === 'style') {
        // Only allow safe CSS props, no url() / expression() / @import
        const safeDecls = value
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .filter((d) => {
            const colon = d.indexOf(':')
            if (colon < 0) return false
            const prop = d.slice(0, colon).trim().toLowerCase()
            if (!SAFE_STYLE_PROPS.has(prop)) return false
            const val = d.slice(colon + 1).trim().toLowerCase()
            if (val.includes('url(') || val.includes('expression(') || val.includes('import') || val.includes('@')) return false
            return true
          })
        if (safeDecls.length) {
          keptAttrs.push('style="' + safeDecls.join('; ') + '"')
        }
      } else {
        keptAttrs.push(name + '="' + value.replace(/"/g, '&quot;') + '"')
      }
    }
    return '<' + tagLower + (keptAttrs.length ? ' ' + keptAttrs.join(' ') : '') + '>'
  })

  // Normalise <b> -> <strong>, <i> -> <em>
  s = s.replace(/<(\/?)b(\s|>)/gi, '<$1strong$2').replace(/<(\/?)i(\s|>)/gi, '<$1em$2')

  // Strip any leftover javascript:/data: hrefs (defence in depth)
  s = s.replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]*)/gi, '')
  return s
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

/**
 * Same line-splitting as richTextToLines, but each line keeps inline
 * formatting (<strong>, <em>, <u>, <code>, <br>, <span style=...>)
 * and is sanitised for safe dangerouslySetInnerHTML rendering.
 *
 * Use this for the resume preview so Tiptap's bold/italic/etc. flow through.
 */
export function richTextToInlineHtml(content: string): string[] {
  if (!content) return []
  let html = decodeHtmlEntities(content)
  // Normalise block/list closers to <br>
  html = html.replace(BREAK_TAGS, '<br>')
  html = html.replace(LIST_ITEM_OPEN_TAG, '<br>')
  html = html.replace(BLOCK_BREAK_TAGS, '<br>')
  // Drop raw <p>/<ul>/<ol> openers (they have no styling we need)
  html = html.replace(/<\/?(?:p|ul|ol|div|section|article|h[1-6])[^>]*>/gi, '')

  // Sanitise first
  html = sanitizeInlineHtml(html)

  // Split on <br>
  return html
    .split(/<br\s*\/?>/gi)
    .map((line) => line.trim())
    .filter((line) => line.replace(/<[^>]+>/g, '').trim().length > 0)
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
