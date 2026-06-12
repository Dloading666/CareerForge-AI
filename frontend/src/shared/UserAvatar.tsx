import { IconUser } from '@arco-design/web-react/icon'

export function UserAvatar({ src, name, size = 36 }: { src?: string; name?: string; size?: number }) {
  const content = src ? (
    <img
      src={src}
      alt="avatar"
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  ) : (
    <span style={{ width: '100%', height: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#edf2ff', color: '#0b45d9', fontWeight: 600 }}>
      {name?.trim()?.[0] || <IconUser />}
    </span>
  )

  return (
    <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: '#edf2ff' }}>
      {content}
    </div>
  )
}
