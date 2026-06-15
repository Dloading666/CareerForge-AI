import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Typography } from '@arco-design/web-react'

const { Title, Paragraph } = Typography

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches uncaught render errors anywhere below it and renders a friendly
 * fallback instead of a blank page. Without this, a single thrown error in
 * any descendant unmounts the whole React tree.
 *
 * Currently logs to console only; route to Sentry once observability is added.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // TODO: forward to Sentry when error reporting is wired up.
    console.error('[ErrorBoundary] uncaught render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div
        style={{
          padding: 48,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          maxWidth: 720,
          margin: '80px auto',
        }}
      >
        <Title heading={2} style={{ marginBottom: 8 }}>
          页面出错了
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 24 }}>
          渲染过程中遇到了一个未处理的异常。可以尝试刷新页面，或把下面的错误信息反馈给管理员。
        </Paragraph>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            background: 'var(--color-fill-2, #f5f5f5)',
            border: '1px solid var(--color-border-2, #e5e6eb)',
            borderRadius: 6,
            padding: 16,
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--color-text-2, #4e5969)',
            overflow: 'auto',
            maxHeight: 320,
          }}
        >
          {String(this.state.error.stack || this.state.error.message || this.state.error)}
        </pre>
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <Button type="primary" onClick={this.handleReload}>
            刷新页面
          </Button>
          <Button onClick={this.handleReset}>尝试恢复</Button>
        </div>
      </div>
    )
  }
}