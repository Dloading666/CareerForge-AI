import { useEffect, useState } from "react"

/**
 * Returns `value` debounced by `delayMs`. The output only updates after the
 * caller has stopped writing for `delayMs` — useful for search inputs that
 * drive expensive server requests.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}