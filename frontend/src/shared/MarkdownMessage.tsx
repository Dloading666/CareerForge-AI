import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// 代码块：带语言标签 + 一键复制按钮
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // 退化方案：execCommand
      const ta = document.createElement('textarea')
      ta.value = code
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* noop */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="md-code-block">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || 'code'}</span>
        <button type="button" className="md-code-copy" onClick={handleCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </div>
  )
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...rest }) {
          const text = String(children ?? '')
          const match = /language-(\w+)/.exec(className || '')
          const isBlock = Boolean(match) || text.includes('\n')
          if (!isBlock) {
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            )
          }
          return <CodeBlock code={text.replace(/\n$/, '')} lang={match?.[1]} />
        },
        // code 已经自带 <pre> 包裹，避免 ReactMarkdown 再套一层 <pre>
        pre({ children }) {
          return <>{children}</>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
