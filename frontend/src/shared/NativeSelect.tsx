import { useRef, useState, useEffect } from 'react'

type Option = { value: string; label: string }

type NativeSelectProps = {
  value: string
  onChange: (val: string) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

/**
 * Lightweight custom dropdown that renders its popup via a portal-like
 * absolutely-positioned div.  Guaranteed to work regardless of parent
 * overflow / z-index because the popup is appended directly to <body>.
 */
export function NativeSelect({ value, onChange, options, placeholder, disabled, className }: NativeSelectProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})

  const selected = options.find((o) => o.value === value)

  // Position the popup relative to the trigger
  const positionPopup = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPopupStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 99999,
    })
  }

  const handleToggle = () => {
    if (disabled) return
    if (!open) positionPopup()
    setOpen((v) => !v)
  }

  const handleSelect = (val: string) => {
    onChange(val)
    setOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (popupRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on scroll (popup is fixed, so it would detach from trigger)
  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  return (
    <>
      <div
        ref={triggerRef}
        className={`native-select-trigger${disabled ? ' native-select-disabled' : ''}${className ? ` ${className}` : ''}`}
        onClick={handleToggle}
        role="combobox"
        aria-expanded={open}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle() }
          if (e.key === 'Escape') setOpen(false)
        }}
      >
        <span className={`native-select-value${!selected ? ' native-select-placeholder' : ''}`}>
          {selected ? selected.label : placeholder ?? '请选择'}
        </span>
        <svg className={`native-select-arrow${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && (
        <div ref={popupRef} className="native-select-popup" style={popupStyle}>
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`native-select-option${opt.value === value ? ' selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

type MultiSelectProps = {
  value: string[]
  onChange: (val: string[]) => void
  options: Option[]
  placeholder?: string
  disabled?: boolean
}

export function NativeMultiSelect({ value, onChange, options, placeholder, disabled }: MultiSelectProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label)

  const positionPopup = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPopupStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 99999,
    })
  }

  const handleToggle = () => {
    if (disabled) return
    if (!open) positionPopup()
    setOpen((v) => !v)
  }

  const handleToggleOption = (val: string) => {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val))
    } else {
      onChange([...value, val])
    }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (popupRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = () => setOpen(false)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [open])

  return (
    <>
      <div
        ref={triggerRef}
        className={`native-select-trigger native-multi-select-trigger${disabled ? ' native-select-disabled' : ''}`}
        onClick={handleToggle}
        role="combobox"
        aria-expanded={open}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle() }
          if (e.key === 'Escape') setOpen(false)
        }}
      >
        <div className="native-multi-select-tags">
          {selectedLabels.length === 0 && <span className="native-select-placeholder">{placeholder ?? '请选择'}</span>}
          {selectedLabels.map((label) => (
            <span key={label} className="native-multi-tag">{label}</span>
          ))}
        </div>
        <svg className={`native-select-arrow${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {open && (
        <div ref={popupRef} className="native-select-popup" style={popupStyle}>
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`native-select-option${value.includes(opt.value) ? ' selected' : ''}`}
              onClick={() => handleToggleOption(opt.value)}
            >
              <span className="native-select-check">{value.includes(opt.value) ? '✓' : ''}</span>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
