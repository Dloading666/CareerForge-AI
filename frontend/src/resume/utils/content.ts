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
 * A single block of inline content for resume preview rendering.
 * - `paragraph`: free-flowing text line. Render with plain <div>/<p>.
 * - `bullet`:    bullet list item. Render as <ul><li>...</li></ul>.
 * - `ordered`:   numbered list item. Render as <ol><li>...</li></ol>.
 */
export type RichInlineBlock = {
  type: 'paragraph' | 'bullet' | 'ordered'
  lines: string[]
}

/**
 * Walk the raw Tiptap HTML and produce a sequence of inline blocks,
 * preserving bullet vs ordered list semantics so the preview can render
 * the right list type.
 */
export function richTextToInlineBlocks(content: string): RichInlineBlock[] {
  if (!content) return []
  const decoded = decodeHtmlEntities(content)
  const blocks: RichInlineBlock[] = []
  // We accumulate text + inline tags into `buf`, then decide on flush whether
  // it belongs to a list item or a paragraph line.
  let buf = ''
  let listMode: 'bullet' | 'ordered' | null = null
  let paraLines: string[] = []

  // Inline tags: preserved verbatim so sanitizeInlineHtml can keep the
  // strong/em/u/code/span markup that the user typed in the editor.
  const INLINE_ALWAYS = new Set([
    'strong', 'b', 'em', 'i', 'u', 's', 'code', 'span', 'a', 'sub', 'sup', 'mark',
  ])
  const BLOCK_CLOSE = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

  const sanitiseBuf = (): string => {
    const cleaned = sanitizeInlineHtml(buf).replace(/<br\s*\/?>$/i, '').trim()
    buf = ''
    return cleaned
  }

  const flushParaLine = () => {
    const html = sanitiseBuf()
    if (html.replace(/<[^>]+>/g, '').trim()) paraLines.push(html)
  }

  const closeParagraph = () => {
    flushParaLine()
    if (paraLines.length) {
      blocks.push({ type: 'paragraph', lines: [...paraLines] })
      paraLines = []
    }
  }

  const flushListItem = () => {
    if (!listMode) return
    const html = sanitiseBuf()
    if (html.replace(/<[^>]+>/g, '').trim()) {
      const last = blocks[blocks.length - 1]
      if (last && last.type === listMode) last.lines.push(html)
      else blocks.push({ type: listMode, lines: [html] })
    }
  }
  const closeList = () => {
    flushListItem()
    listMode = null
  }

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g
  let m: RegExpExecArray | null
  let lastIdx = 0
  while ((m = tagRe.exec(decoded)) !== null) {
    const between = decoded.slice(lastIdx, m.index)
    const slash = m[1]
    const tag = m[2].toLowerCase()
    const text = decodeHtmlEntities(between)
    if (text) buf += text
    if (INLINE_ALWAYS.has(tag)) buf += m[0]

    // --- list structure changes ---
    if (!slash && tag === 'ul') {
      closeParagraph()
      listMode = 'bullet'
    } else if (!slash && tag === 'ol') {
      closeParagraph()
      listMode = 'ordered'
    } else if (slash && (tag === 'ul' || tag === 'ol')) {
      closeList()
    } else if (listMode && slash && tag === 'li') {
      flushListItem()
    } else if (!listMode) {
      // --- paragraph-level changes (only meaningful outside a list) ---
      if (!slash && tag === 'br') {
        flushParaLine()
      } else if (slash && (tag === 'p' || BLOCK_CLOSE.has(tag))) {
        closeParagraph()
      } else if (!slash && tag === 'p' && (paraLines.length || buf.trim())) {
        // opening a new <p> when we already have content flushes the prior line
        flushParaLine()
      }
    }
    // <br> inside a list item stays inside the item (just append to buf)

    lastIdx = m.index + m[0].length
  }
  const tail = decoded.slice(lastIdx)
  if (tail) buf += decodeHtmlEntities(tail)
  closeList()
  closeParagraph()

  return blocks
}

export function richTextToInlineHtml(content: string): string[] {
  const blocks = richTextToInlineBlocks(content)
  const out: string[] = []
  for (const b of blocks) {
    for (const line of b.lines) out.push(line)
  }
  return out
}

/** Split a single paragraph block's lines out of mixed content. */
export function richTextToParagraphLines(content: string): string[] {
  const blocks = richTextToInlineBlocks(content)
  const out: string[] = []
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      for (const line of b.lines) out.push(line)
    }
  }
  return out
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
