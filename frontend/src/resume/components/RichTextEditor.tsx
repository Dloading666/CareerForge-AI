import { Tooltip } from '@arco-design/web-react'
import { IconBold, IconItalic, IconOrderedList, IconRefresh, IconUnderline, IconUnorderedList } from '@arco-design/web-react/icon'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { richTextToTextarea } from '../utils/content'

export type RichTextEditorProps = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minRows?: number
  onAiAssist?: () => void
  aiAssistLabel?: string
  ariaLabel?: string
  listOnly?: boolean
}

function toggleListSafely(editor: Editor, target: 'bulletList' | 'orderedList') {
  // If cursor is already in the target list, untoggle it.
  if (editor.isActive(target)) {
    editor.chain().focus().toggleList(target, 'listItem').run()
    return
  }
  // Otherwise lift out of any current list first so the conversion is a
  // clean swap (avoids nesting or mixed-list artefacts).
  const other = target === 'bulletList' ? 'orderedList' : 'bulletList'
  const chain = editor.chain().focus()
  if (editor.isActive(other)) chain.toggleList(other, 'listItem')
  chain.toggleList(target, 'listItem').run()
}

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
  className,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        className={`rich-text-toolbar-btn${className ? ' ' + className : ''}${active ? ' active' : ''}`}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        aria-label={title}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function EditorToolbar({ editor, onAiAssist, aiAssistLabel }: { editor: Editor; onAiAssist?: () => void; aiAssistLabel?: string }) {
  if (!editor) return null
  return (
    <div className="rich-text-toolbar">
      <div className="rich-text-toolbar-group">
        <ToolbarButton
          title="加粗 (Ctrl+B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <IconBold />
        </ToolbarButton>
        <ToolbarButton
          title="斜体 (Ctrl+I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <IconItalic />
        </ToolbarButton>
        <ToolbarButton
          title="下划线 (Ctrl+U)"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleMark('underline').run()}
        >
          <IconUnderline />
        </ToolbarButton>
        <ToolbarButton
          title="项目符号列表"
          active={editor.isActive('bulletList')}
          onClick={() => toggleListSafely(editor, 'bulletList')}
        >
          <IconUnorderedList />
        </ToolbarButton>
        <ToolbarButton
          title="编号列表"
          active={editor.isActive('orderedList')}
          onClick={() => toggleListSafely(editor, 'orderedList')}
        >
          <IconOrderedList />
        </ToolbarButton>
        <ToolbarButton
          title="清除格式"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <IconRefresh />
        </ToolbarButton>
      </div>
      {onAiAssist ? (
        <div className="rich-text-toolbar-group rich-text-toolbar-group--end">
          <ToolbarButton
            title={aiAssistLabel || 'AI 优化'}
            onClick={onAiAssist}
            className="rich-text-toolbar-btn--wide"
          >
            <span aria-hidden style={{ marginRight: 4 }}>✨</span>
            {aiAssistLabel || 'AI 优化'}
          </ToolbarButton>
        </div>
      ) : null}
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容...',
  minRows = 5,
  onAiAssist,
  aiAssistLabel,
  ariaLabel,
  listOnly = false,
}: RichTextEditorProps) {
  // We need to handle the case where the parent passes an empty/legacy value.
  // Tiptap requires explicit initial content; we hydrate from HTML.
  // 用 useState 惰性初始化而不是 useRef：初始内容只在挂载时取一次，
  // 放进 state 既不触发额外渲染（只读初始值），又避免在渲染期间访问 ref。
  const initialHtml = useState(() => value || '')[0]
  const isInternalUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
      }),
    ],
    content: initialHtml,
    onUpdate({ editor: ed }) {
      // 标记本次 onChange 由用户输入触发，供下方 effect 判断不要把值回塞（防循环）。
      isInternalUpdate.current = true
      const html = ed.getHTML()
      onChange(html === '<p></p>' ? '' : html)
    },
    editorProps: {
      attributes: {
        class: 'rich-text-editor-content',
        'data-min-rows': String(minRows),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(listOnly ? { 'data-list-only': 'true' } : {}),
      },
    },
  })

  // Sync external value -> editor when it changes from outside (e.g. AI replacement).
  useEffect(() => {
    if (!editor) return
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false
      return
    }
    const current = editor.getHTML()
    const normalized = value || ''
    if (current !== normalized) {
      editor.commands.setContent(normalized, false)
    }
  }, [value, editor])

  if (!editor) {
    return (
      <div className="rich-text-editor rich-text-editor--loading">
        <div className="rich-text-toolbar">
          <div className="rich-text-toolbar-group">
            <span style={{ color: '#9ca3af', fontSize: 12 }}>编辑器加载中…</span>
          </div>
        </div>
        <div className="rich-text-editor-content" style={{ minHeight: minRows * 22 }} />
      </div>
    )
  }

  return (
    <div className="rich-text-editor">
      <EditorToolbar editor={editor} onAiAssist={onAiAssist} aiAssistLabel={aiAssistLabel} />
      <div
        className="rich-text-editor-surface"
        onKeyDown={(e) => {
          // Enter on empty bullet should exit list, not bubble to form submit
          if (e.key === 'Enter' && !e.shiftKey && editor.isActive('listItem') && editor.isEmpty) {
            editor.chain().focus().liftListItem('listItem').run()
            e.preventDefault()
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

// Helper: convert HTML to plain text for AI prompts
export function htmlToPlainText(html: string): string {
  return richTextToTextarea(html)
}
