import { Dropdown } from "@arco-design/web-react"
import { IconNotification } from "@arco-design/web-react/icon"
import { useEffect, useState } from "react"
import { apiRequest } from "../shared/api"

type StudentAnnouncement = {
  id: number
  title: string
  content: string
  announcement_type: "info" | "warning" | "success" | "error"
  priority: number
  start_time: string | null
  end_time: string | null
  created_at: string
}

const TYPE_COLORS: Record<string, string> = {
  info: "#165dff",
  warning: "#ff7d00",
  success: "#00b42a",
  error: "#f53f3f",
}

const TYPE_LABELS: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  success: "Success",
  error: "Error",
}

function getDismissed(): Set<number> {
  try {
    const raw = localStorage.getItem("zhipei-dismissed-announcements")
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set()
  } catch {
    return new Set()
  }
}

// ── Bell + Dropdown (for topbar) ──────────────

export function AnnouncementBellDropdown() {
  const [anns, setAnns] = useState<StudentAnnouncement[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(getDismissed)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiRequest<StudentAnnouncement[]>("/api/v1/student/announcements")
      .then((data) => { if (!cancelled) setAnns(data) })
      .catch(() => { /* silently ignore */ })
    return () => { cancelled = true }
  }, [])

  const dismiss = (id: number) => {
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      localStorage.setItem(
        "zhipei-dismissed-announcements",
        JSON.stringify([...next])
      )
      return next
    })
  }

  const unreadCount = anns.filter((a) => !dismissedIds.has(a.id)).length

  return (
    <Dropdown
      popupVisible={visible}
      onVisibleChange={setVisible}
      droplist={
        <div
          style={{
            width: 330,
            maxHeight: 420,
            overflow: "auto",
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 12,
              color: "var(--color-text-1)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <IconNotification style={{ marginRight: 6, fontSize: 16 }} />
            系统公告
          </div>
          {anns.length === 0 ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--color-text-3)",
                textAlign: "center",
                padding: 24,
              }}
            >
              No announcements
            </div>
          ) : (
            anns.map((a) => {
              const isDismissed = dismissedIds.has(a.id)
              return (
                <div
                  key={a.id}
                  style={{
                    padding: "10px 12px",
                    borderLeft: `3px solid ${TYPE_COLORS[a.announcement_type]}`,
                    marginBottom: 8,
                    borderRadius: 6,
                    background: isDismissed ? "#f9fafb" : "#f0fdf4",
                    opacity: isDismissed ? 0.7 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--color-text-1)",
                      }}
                    >
                      {a.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: TYPE_COLORS[a.announcement_type] + "18",
                        color: TYPE_COLORS[a.announcement_type],
                        fontWeight: 500,
                      }}
                    >
                      {TYPE_LABELS[a.announcement_type]}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: "var(--color-text-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    {a.content}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 6,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--color-text-4)" }}>
                      {isDismissed ? "Dismissed" : ""}
                    </span>
                    {!isDismissed && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          dismiss(a.id)
                        }}
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-3)",
                          cursor: "pointer",
                          textDecoration: "underline",
                        }}
                      >
                        Dismiss
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      }
      trigger="click"
      position="br"
    >
      <button
        type="button"
        style={{
          position: "relative",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 6,
          borderRadius: 8,
          color: "var(--color-text-2)",
          display: "flex",
          alignItems: "center",
          transition: "background 0.15s",
        }}
        aria-label="Announcements"
      >
        <IconNotification style={{ fontSize: 20 }} />
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: "#f53f3f",
              color: "#fff",
              fontSize: 10,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </Dropdown>
  )
}

// ── Light-green banner (for thread area) ──────

export function AnnouncementBanner() {
  const [anns, setAnns] = useState<StudentAnnouncement[]>([])
  const [dismissed, setDismissed] = useState<Set<number>>(getDismissed)

  useEffect(() => {
    let cancelled = false
    apiRequest<StudentAnnouncement[]>("/api/v1/student/announcements")
      .then((data) => { if (!cancelled) setAnns(data) })
      .catch(() => { /* silently ignore */ })
    return () => { cancelled = true }
  }, [])

  // sync with localStorage changes from the bell dropdown
  useEffect(() => {
    const onStorage = () => setDismissed(getDismissed())
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  const activeAnns = anns.filter((a) => !dismissed.has(a.id))
  if (activeAnns.length === 0) return null

  const dismissAll = () => {
    const next = new Set(dismissed)
    for (const a of activeAnns) next.add(a.id)
    localStorage.setItem("zhipei-dismissed-announcements", JSON.stringify([...next]))
    setDismissed(next)
  }

  const combinedText = activeAnns
    .map((a) => a.title + ": " + a.content)
    .join(" | ")

  return (
    <div
      style={{
        margin: "0 16px 8px",
        padding: "10px 16px",
        borderRadius: 8,
        background: "#f0fdf4",
        border: "1px solid #bbf7d0",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>
        {"\uD83D\uDCE2"}
      </span>
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "#166534",
          flex: 1,
        }}
      >
        {combinedText}
      </span>
      <button
        type="button"
        onClick={dismissAll}
        title="Dismiss all"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 16,
          color: "#166534",
          opacity: 0.5,
          padding: "0 4px",
          lineHeight: 1,
          borderRadius: 4,
        }}
      >
        {"\u00D7"}
      </button>
    </div>
  )
}
