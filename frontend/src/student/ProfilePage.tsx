import {
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Message,
  Radio,
  Select,
  Tag,
  Tabs,
  Typography,
} from '@arco-design/web-react'
import {
  IconArrowDown,
  IconArrowUp,
  IconBook,
  IconCamera,
  IconCheck,
  IconCode,
  IconCommon,
  IconDelete,
  IconPhone,
  IconPlus,
  IconSafe,
  IconStar,
  IconThunderbolt,
  IconTrophy,
  IconUser,
} from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../shared/auth'
import { apiRequest } from '../shared/api'
import { CalendarPage } from './CalendarPage'

// 日期字段统一精确到天（YYYY-MM-DD），所有相关输入都使用 DatePicker，
// DatePicker 自身不允许键盘输入，只能通过面板选择，避免用户手填格式不规范的日期。
const DAY_FORMAT = 'YYYY-MM-DD'
const RANGE_SEPARATOR = ' ~ '

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const s = value.trim()
  if (!s || s === '至今' || s === 'present' || s === 'now') return undefined
  const d = new Date(s)
  return isNaN(d.getTime()) ? undefined : d
}

function formatDay(date: unknown): string {
  if (!date) return ''
  let d: Date
  if (date instanceof Date) {
    d = date
  } else if (typeof date === 'string' || typeof date === 'number') {
    d = new Date(date)
  } else if (typeof date === 'object' && date !== null && 'toDate' in date && typeof (date as { toDate?: () => Date }).toDate === 'function') {
    d = (date as { toDate: () => Date }).toDate()
  } else {
    return ''
  }
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function isPresentFlag(value: string | null | undefined): boolean {
  if (!value) return false
  const v = value.trim()
  return v === '至今' || v === 'present' || v === 'now'
}

function joinDateRange(start: string, end: string): string {
  if (start && end) return start + RANGE_SEPARATOR + end
  return start || end
}

function splitDateRange(value: string | null | undefined): [string, string] {
  if (!value) return ['', '']
  const v = value.trim()
  if (!v) return ['', '']
  const sepIdx = v.indexOf(RANGE_SEPARATOR)
  if (sepIdx === -1) return [v, '']
  return [v.slice(0, sepIdx).trim(), v.slice(sepIdx + RANGE_SEPARATOR.length).trim()]
}

// ---------- Types ----------

type Profile = {
  id: number
  account: string
  email: string
  name: string | null
  gender: string | null
  age: number | null
  birth_date: string | null
  college: string | null
  major: string | null
  grade: string | null
  phone: string | null
  avatar_url: string | null
  resume_avatar_url: string | null
  banner_url: string | null
  signature: string | null
  personal_advantages: string | null
  job_search_status: string | null
  expected_position: string | null
  expected_salary: string | null
  expected_location: string | null
  email_verified_at: string | null
  created_at: string | null
}

type WorkExperience = {
  id: number | null
  company: string
  position: string
  start_date: string
  end_date: string
  description: string
}

type Project = {
  id: number | null
  name: string
  role: string
  start_date: string
  end_date: string
  link: string
  link_label: string
  description: string
}

type Education = {
  id: number | null
  school: string
  major: string
  degree: string
  duration: string
  gpa: string
  description: string
}

type Honor = {
  id: number | null
  title: string
  level: string
  award_date: string
  description: string
}

type Certification = {
  id: number | null
  name: string
  issuer: string
  issue_date: string
  expire_date: string
  description: string
}

const jobStatusOptions = [
  { value: 'unemployed', label: '求职中' },
  { value: 'employed', label: '已就业，看新机会' },
  { value: 'considering', label: '观望中' },
  { value: 'not_looking', label: '暂不求职' },
]

const emptyWorkExperience = (): WorkExperience => ({
  id: null,
  company: '',
  position: '',
  start_date: '',
  end_date: '',
  description: '',
})

const emptyProject = (): Project => ({
  id: null,
  name: '',
  role: '',
  start_date: '',
  end_date: '',
  link: '',
  link_label: '',
  description: '',
})

const emptyHonor = (): Honor => ({
  id: null,
  title: '',
  level: '',
  award_date: '',
  description: '',
})

const emptyCertification = (): Certification => ({
  id: null,
  name: '',
  issuer: '',
  issue_date: '',
  expire_date: '',
  description: '',
})

const emptyEducation = (): Education => ({
  id: null,
  school: '',
  major: '',
  degree: '',
  duration: '',
  gpa: '',
  description: '',
})

const SKILL_NAME_MAX = 256

function parseSkillLine(line: string) {
  const separatorIndex = line.indexOf(' / ')
  if (separatorIndex !== -1) {
    return {
      name: line.slice(0, separatorIndex).trim(),
      description: line.slice(separatorIndex + 3).trim(),
    }
  }
  const trimmed = line.trim()
  if (trimmed.length <= SKILL_NAME_MAX) {
    return { name: trimmed, description: '' }
  }
  return { name: trimmed.slice(0, SKILL_NAME_MAX), description: trimmed.slice(SKILL_NAME_MAX) }
}

// ---------- Reusable UI ----------

function FieldRow({
  label,
  required,
  children,
  span,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
  span?: number
}) {
  return (
    <div
      style={{
        gridColumn: span && span > 1 ? `span ${span}` : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text-subtle)', fontWeight: 500 }}>
        {label}
        {required && (
          <span style={{ color: '#f53f3f', marginLeft: 2 }}>*</span>
        )}
      </div>
      {children}
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '20px',
        textAlign: 'center',
        color: 'var(--text-subtle)',
        background: 'var(--surface-soft)',
        border: '1px dashed var(--surface-border)',
        borderRadius: 10,
        fontSize: 13,
      }}
    >
      {text}
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  hint,
  onAdd,
  addText = '新增',
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  onAdd: () => void
  addText?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--brand-blue)' }}>{icon}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-main)' }}>{title}</span>
        {hint && <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>· {hint}</span>}
      </div>
      <Button type="primary" size="small" icon={<IconPlus />} onClick={onAdd}>
        {addText}
      </Button>
    </div>
  )
}

function MoveButtons({
  onUp,
  onDown,
  disableUp,
  disableDown,
}: {
  onUp: () => void
  onDown: () => void
  disableUp?: boolean
  disableDown?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <Button
        type="text"
        size="mini"
        icon={<IconArrowUp />}
        onClick={onUp}
        disabled={disableUp}
        title="上移"
      />
      <Button
        type="text"
        size="mini"
        icon={<IconArrowDown />}
        onClick={onDown}
        disabled={disableDown}
        title="下移"
      />
    </div>
  )
}

function CardShell({
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        border: '1px solid var(--surface-border)',
        borderRadius: 12,
        padding: 16,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Tag color="arcoblue" size="small">
          #{index + 1}
        </Tag>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MoveButtons
            onUp={onMoveUp}
            onDown={onMoveDown}
            disableUp={index === 0}
            disableDown={index === total - 1}
          />
          <Button
            type="text"
            size="mini"
            icon={<IconDelete />}
            onClick={onRemove}
            title="删除"
            status="danger"
          />
        </div>
      </div>
      {children}
    </div>
  )
}

function ListSection<T>({
  items,
  setItems,
  renderItem,
}: {
  items: T[]
  setItems: React.Dispatch<React.SetStateAction<T[]>>
  renderItem: (
    item: T,
    index: number,
    total: number,
    update: (next: T) => void,
    remove: () => void,
    move: (delta: -1 | 1) => void,
  ) => React.ReactNode
}) {
  const move = (idx: number, delta: -1 | 1) => {
    const next = idx + delta
    if (next < 0 || next >= items.length) return
    const arr = items.slice()
    const [it] = arr.splice(idx, 1)
    arr.splice(next, 0, it)
    setItems(arr)
  }
  const update = (idx: number, next: T) => {
    const arr = items.slice()
    arr[idx] = next
    setItems(arr)
  }
  const remove = (idx: number) => setItems(items.filter((_, i) => i !== idx))

  if (items.length === 0) {
    return <EmptyHint text="暂无内容，点击右上角新增开始添加" />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it, idx) =>
        renderItem(it, idx, items.length, (next) => update(idx, next), () => remove(idx), (d) => move(idx, d)),
      )}
    </div>
  )
}

// ---------- Page ----------

export function ProfilePage({ activeTab = 'profile', onTabChange }: { activeTab?: string; onTabChange?: (tab: string) => void }) {
  const { session } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [feedbackDesc, setFeedbackDesc] = useState('')
  const [feedbackCategory, setFeedbackCategory] = useState('bug')
  const [feedbackFile, setFeedbackFile] = useState<File | null>(null)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [editTab, setEditTab] = useState<string>('basic')
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [pwdCode, setPwdCode] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdCountdown, setPwdCountdown] = useState(0)
  const [sendingPwdCode, setSendingPwdCode] = useState(false)
  const [resettingPwd, setResettingPwd] = useState(false)
  const [pwdCaptchaId, setPwdCaptchaId] = useState('')
  const [pwdCaptchaImage, setPwdCaptchaImage] = useState('')
  const [pwdCaptcha, setPwdCaptcha] = useState('')
  const [basicForm] = Form.useForm()
  const resumeFileInputRef = useRef<HTMLInputElement>(null)
  const hydratedProfileIdRef = useRef<number | null>(null)

  // Edit modal state
  const [advantageText, setAdvantageText] = useState('')
  const [jobStatus, setJobStatus] = useState<string | undefined>(undefined)
  const [expectedPosition, setExpectedPosition] = useState('')
  const [expectedSalary, setExpectedSalary] = useState('')
  const [expectedLocation, setExpectedLocation] = useState('')
  const [workExperiences, setWorkExperiences] = useState<WorkExperience[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [honors, setHonors] = useState<Honor[]>([])
  const [educations, setEducations] = useState<Education[]>([])
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [skillText, setSkillText] = useState<string>('')
  const [detailsReady, setDetailsReady] = useState(false)

  const fetchProfile = async () => {
    try {
      const res = await apiRequest<Profile>('/api/v1/student/profile', {
        headers: { Authorization: `Bearer ${session?.access}` },
      })
      setProfile(res)
    } catch {
      Message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }

  const submitFeedback = async () => {
    if (!feedbackDesc.trim()) {
      Message.warning('请填写问题描述')
      return
    }
    setSubmittingFeedback(true)
    try {
      const formData = new FormData()
      formData.append('description', feedbackDesc)
      formData.append('category', feedbackCategory)
      if (feedbackFile) formData.append('screenshot', feedbackFile)
      await apiRequest('/api/v1/student/feedback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access}` },
        body: formData,
      })
      Message.success('反馈提交成功，感谢！')
      setFeedbackDesc('')
      setFeedbackFile(null)
      setFeedbackCategory('bug')
    } catch {
      Message.error('提交失败，请重试')
    } finally {
      setSubmittingFeedback(false)
    }
  }

  useEffect(() => {
    // Initial profile hydration is intentionally driven by the mounted page.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openEdit = async (sourceProfile: Profile | null = profile) => {
    if (!sourceProfile) return
    basicForm.setFieldsValue({
      name: sourceProfile.name ?? '',
      gender: sourceProfile.gender ?? undefined,
      birth_date: toDate(sourceProfile.birth_date),
      phone: sourceProfile.phone ?? '',
      signature: sourceProfile.signature ?? '',
    })
    setAdvantageText(sourceProfile.personal_advantages ?? '')
    setJobStatus(sourceProfile.job_search_status ?? undefined)
    setExpectedPosition(sourceProfile.expected_position ?? '')
    setExpectedSalary(sourceProfile.expected_salary ?? '')
    setExpectedLocation(sourceProfile.expected_location ?? '')
    setLastSavedAt(null)
    setDetailsReady(false)
    try {
      const details = await apiRequest<{
        work_experiences?: WorkExperience[]
        projects?: Project[]
        educations?: Education[]
        honors?: Honor[]
        certifications?: Certification[]
        skills?: {
          name?: string | null
          level?: number | null
          description?: string | null
        }[]
      }>('/api/v1/student/profile/details', {
        headers: { Authorization: `Bearer ${session?.access}` },
      })
      setWorkExperiences(
        (details.work_experiences ?? []).map((it) => ({
          id: it.id ?? null,
          company: it.company ?? '',
          position: it.position ?? '',
          start_date: it.start_date ?? '',
          end_date: it.end_date ?? '',
          description: it.description ?? '',
        })),
      )
      setProjects(
        (details.projects ?? []).map((it) => ({
          id: it.id ?? null,
          name: it.name ?? '',
          role: it.role ?? '',
          start_date: it.start_date ?? '',
          end_date: it.end_date ?? '',
          link: it.link ?? '',
          link_label: it.link_label ?? '',
          description: it.description ?? '',
        })),
      )
      setHonors(
        (details.honors ?? []).map((it) => ({
          id: it.id ?? null,
          title: it.title ?? '',
          level: it.level ?? '',
          award_date: it.award_date ?? '',
          description: it.description ?? '',
        })),
      )
      setEducations(
        (details.educations ?? []).map((it) => ({
          id: it.id ?? null,
          school: it.school ?? '',
          major: it.major ?? '',
          degree: it.degree ?? '',
          duration: it.duration ?? '',
          gpa: it.gpa ?? '',
          description: it.description ?? '',
        })),
      )
      setCertifications(
        (details.certifications ?? []).map((it) => ({
          id: it.id ?? null,
          name: it.name ?? '',
          issuer: it.issuer ?? '',
          issue_date: it.issue_date ?? '',
          expire_date: it.expire_date ?? '',
          description: it.description ?? '',
        })),
      )
      setSkillText(
        (details.skills ?? [])
          .map((it) => {
            const name = (it.name ?? '').trim()
            const description = (it.description ?? '').trim()
            return description ? `${name} / ${description}` : name
          })
          .filter(Boolean)
          .join('\n'),
      )
      setDetailsReady(true)
    } catch {
      Message.error('档案经历加载失败，请稍后重试')
    }
    setEditTab('basic')
  }

  useEffect(() => {
    if (!profile || hydratedProfileIdRef.current === profile.id) return
    hydratedProfileIdRef.current = profile.id
    void openEdit(profile)
    // openEdit intentionally hydrates once for each mounted profile editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const handleSave = async () => {
    try {
      if (!detailsReady) {
        Message.error('档案尚未完整加载，为避免覆盖已有数据，请稍后重试')
        return
      }
      const values = await basicForm.validate()
      setSaving(true)
      const skillItems = skillText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const { name, description } = parseSkillLine(line)
          return {
          id: null,
          name,
          level: 3,
            description,
          }
        })
      await apiRequest('/api/v1/student/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access}`,
        },
        body: JSON.stringify({
          ...values,
          birth_date: formatDay(values.birth_date),
          personal_advantages: advantageText,
          job_search_status: jobStatus ?? null,
          expected_position: expectedPosition,
          expected_salary: expectedSalary,
          expected_location: expectedLocation,
        }),
      })
      await apiRequest('/api/v1/student/profile/details', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access}`,
        },
        body: JSON.stringify({
          work_experiences: workExperiences,
          projects: projects,
          honors: honors,
          educations: educations,
          certifications: certifications,
          skills: skillItems,
        }),
      })
      Message.success('保存成功')
      setLastSavedAt(new Date())
      void fetchProfile()
    } catch (e) {
      Message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ---- Hooks above any early returns (Rules of Hooks) ----
  const skillItemCount = useMemo(
    () =>
      skillText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length,
    [skillText],
  )

  useEffect(() => {
    if (pwdCountdown <= 0) return
    const t = window.setTimeout(() => setPwdCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [pwdCountdown])

  const loadPwdCaptcha = async () => {
    try {
      const data = await apiRequest<{ captcha_id: string; image: string }>('/api/v1/auth/captcha')
      setPwdCaptchaId(data.captcha_id)
      setPwdCaptchaImage(data.image)
      setPwdCaptcha('')
    } catch {
      // ignore, user can click image to retry
    }
  }

  // 在 modal 内切换到安全 tab 时自动加载图形验证码
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === 'security') void loadPwdCaptcha()
  }, [activeTab])

  const handleSendPwdCode = async () => {
    if (!profile?.email) return
    if (!pwdCaptcha.trim()) {
      Message.warning('请先完成图形验证码')
      return
    }
    setSendingPwdCode(true)
    try {
      const res = await apiRequest<{ cooldown_sec: number; debug_code?: string }>(
        '/api/v1/auth/student/email/send-code',
        {
          method: 'POST',
          body: JSON.stringify({
            email: profile.email,
            scene: 'reset',
            captcha_id: pwdCaptchaId,
            captcha_code: pwdCaptcha.trim(),
          }),
        },
      )
      setPwdCountdown(res.cooldown_sec || 60)
      if (res.debug_code) Message.info(`开发环境验证码：${res.debug_code}`)
      else Message.success('验证码已发送至邮箱，请查收')
    } catch (e) {
      Message.error(e instanceof Error ? e.message : '验证码发送失败')
      void loadPwdCaptcha()
    } finally {
      setSendingPwdCode(false)
    }
  }

  const handleResetPwd = async () => {
    if (!profile?.email) return
    if (!pwdCode.trim() || !pwdNew || !pwdConfirm) {
      Message.warning('请完整填写验证码和新密码')
      return
    }
    if (pwdNew !== pwdConfirm) {
      Message.warning('两次输入的密码不一致')
      return
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(pwdNew)) {
      Message.warning('密码至少 8 位，且需包含大写字母、小写字母和数字')
      return
    }
    setResettingPwd(true)
    try {
      await apiRequest('/api/v1/auth/student/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: profile.email,
          code: pwdCode.trim(),
          password: pwdNew,
          confirm_password: pwdConfirm,
        }),
      })
      Message.success('密码修改成功，下次登录请使用新密码')
      setPwdCode('')
      setPwdNew('')
      setPwdConfirm('')
      setPwdCountdown(0)
    } catch (e) {
      Message.error(e instanceof Error ? e.message : '密码修改失败')
    } finally {
      setResettingPwd(false)
    }
  }

  const uploadFile = async (
    file: File,
    endpoint: string,
    onSuccess: (url: string) => void,
    setUploadingFlag: (v: boolean) => void,
  ) => {
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      Message.error('仅支持 JPG、PNG、GIF、WebP')
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    try {
      setUploadingFlag(true)
      const res = await apiRequest<{
        avatar_url?: string
        resume_avatar_url?: string
        banner_url?: string
      }>(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access}` },
        body: fd,
      })
      const url = res.avatar_url || res.resume_avatar_url || res.banner_url
      if (url) onSuccess(url)
      Message.success('更新成功')
    } catch {
      Message.error('上传失败')
    } finally {
      setUploadingFlag(false)
    }
  }

  const handleResumeAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      Message.error('文件不能超过 2MB')
      return
    }
    uploadFile(
      file,
      '/api/v1/student/profile/resume-avatar',
      (url) => setProfile((current) => (
        current ? { ...current, resume_avatar_url: url } : current
      )),
      setUploading,
    )
    e.target.value = ''
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 300,
          color: 'var(--text-subtle)',
        }}
      >
        加载中...
      </div>
    )
  }

  const initials = (profile?.name || profile?.email || '?')[0].toUpperCase()

  return (
    <div className="profile-scroll" style={{ width: '100%', position: 'relative' }}>
      <div style={{ position: "relative", zIndex: 2, padding: 0 }}>

        {activeTab === 'profile' && (
          <div className="profile-edit-inline">
            <Tabs activeTab={editTab} onChange={setEditTab} type="rounded" size="small">
              <Tabs.TabPane key="basic" title={<span><IconUser /> 基本信息</span>}>
                <Form form={basicForm} layout="vertical" style={{ marginTop: 12 }}>
                  <div className="profile-resume-avatar">
                    <div className="profile-resume-avatar-preview">
                      {profile?.resume_avatar_url ? (
                        <img src={profile.resume_avatar_url} alt="简历头像" />
                      ) : (
                        <span>{initials}</span>
                      )}
                    </div>
                    <div className="profile-resume-avatar-copy">
                      <strong>简历头像</strong>
                      <span>仅用于简历模板展示，不影响账号头像</span>
                    </div>
                    <Button
                      icon={<IconCamera />}
                      loading={uploading}
                      onClick={() => resumeFileInputRef.current?.click()}
                    >
                      更换头像
                    </Button>
                    <input
                      ref={resumeFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      style={{ display: 'none' }}
                      onChange={handleResumeAvatarChange}
                    />
                  </div>
                  <div className="profile-form-grid">
                    <FieldRow label="姓名" required>
                      <Form.Item field="name" noStyle><Input placeholder="请输入姓名" allowClear /></Form.Item>
                    </FieldRow>
                    <FieldRow label="性别">
                      <Form.Item field="gender" noStyle>
                        <Radio.Group>
                          <Radio value="male">男</Radio><Radio value="female">女</Radio><Radio value="other">其他</Radio>
                        </Radio.Group>
                      </Form.Item>
                    </FieldRow>
                    <FieldRow label="出生日期">
                      <Form.Item field="birth_date" noStyle>
                        <DatePicker
                          format={DAY_FORMAT}
                          placeholder="请选择出生日期"
                          allowClear
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </FieldRow>
                    <FieldRow label="手机号">
                      <Form.Item field="phone" noStyle><Input placeholder="请输入手机号" allowClear prefix={<IconPhone />} /></Form.Item>
                    </FieldRow>
                  </div>
                  <Form.Item field="signature" label="个性签名" style={{ marginTop: 8 }}>
                    <Input.TextArea placeholder="写一句话介绍自己..." maxLength={200} showWordLimit rows={3} />
                  </Form.Item>
                </Form>
              </Tabs.TabPane>
              <Tabs.TabPane key="advantage" title={<span><IconStar /> 求职偏好</span>}>
                <div style={{ marginTop: 12 }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#4e5969', marginBottom: 6 }}>个人优势 / 自我评价</div>
                    <Input.TextArea
                      value={advantageText}
                      onChange={setAdvantageText}
                      placeholder="描述你的核心优势、工作方式和职业特点..."
                      rows={4}
                    />
                  </div>
                  <div className="profile-form-grid">
                    <FieldRow label="求职状态">
                      <Select value={jobStatus} onChange={setJobStatus} placeholder="选择状态" allowClear>
                        {jobStatusOptions.map((option) => (
                          <Select.Option key={option.value} value={option.value}>
                            {option.label}
                          </Select.Option>
                        ))}
                      </Select>
                    </FieldRow>
                    <FieldRow label="期望岗位"><Input value={expectedPosition} onChange={setExpectedPosition} placeholder="如：前端开发工程师" /></FieldRow>
                    <FieldRow label="期望薪资"><Input value={expectedSalary} onChange={setExpectedSalary} placeholder="如：15-20K" /></FieldRow>
                    <FieldRow label="期望城市"><Input value={expectedLocation} onChange={setExpectedLocation} placeholder="如：北京" /></FieldRow>
                  </div>
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane key="education" title={<span><IconBook /> 教育经历</span>}>
                <div style={{ marginTop: 12 }}>
                  <SectionHeader
                    icon={<IconBook />}
                    title="教育经历"
                    hint="作为简历生成的唯一教育事实来源"
                    onAdd={() => setEducations((items) => [...items, emptyEducation()])}
                    addText="新增教育经历"
                  />
                  <ListSection
                    items={educations}
                    setItems={setEducations}
                    renderItem={(item, idx, total, update, remove, move) => (
                      <CardShell
                        key={`inline-edu-${item.id ?? idx}`}
                        index={idx}
                        total={total}
                        onMoveUp={() => move(-1)}
                        onMoveDown={() => move(1)}
                        onRemove={remove}
                      >
                        <div className="profile-form-grid">
                          <FieldRow label="学校" required>
                            <Input
                              value={item.school}
                              onChange={(value) => update({ ...item, school: value })}
                              placeholder="如：重庆工程学院"
                            />
                          </FieldRow>
                          <FieldRow label="专业">
                            <Input
                              value={item.major}
                              onChange={(value) => update({ ...item, major: value })}
                              placeholder="如：软件工程"
                            />
                          </FieldRow>
                          <FieldRow label="学历 / 学位">
                            <Input
                              value={item.degree}
                              onChange={(value) => update({ ...item, degree: value })}
                              placeholder="如：本科"
                            />
                          </FieldRow>
                          <FieldRow label="起止日期">
                            {(() => {
                              const [startDate, endDate] = splitDateRange(item.duration)
                              return (
                                <div className="profile-date-range-inputs">
                                  <Input
                                    value={startDate}
                                    onChange={(value) =>
                                      update({ ...item, duration: joinDateRange(value, endDate) })
                                    }
                                    placeholder="开始 YYYY-MM"
                                    maxLength={7}
                                  />
                                  <span>至</span>
                                  <Input
                                    value={endDate}
                                    onChange={(value) =>
                                      update({ ...item, duration: joinDateRange(startDate, value) })
                                    }
                                    placeholder="结束 YYYY-MM"
                                    maxLength={7}
                                  />
                                </div>
                              )
                            })()}
                          </FieldRow>
                          <FieldRow label="GPA / 排名">
                            <Input
                              value={item.gpa}
                              onChange={(value) => update({ ...item, gpa: value })}
                              placeholder="如：3.8/4.0，专业前 5%"
                            />
                          </FieldRow>
                          <FieldRow label="在校经历与亮点" span={2}>
                            <Input.TextArea
                              value={item.description}
                              onChange={(value) => update({ ...item, description: value })}
                              placeholder="课程、奖项、学生工作或其他亮点，每行一条"
                              autoSize={{ minRows: 2, maxRows: 4 }}
                            />
                          </FieldRow>
                        </div>
                      </CardShell>
                    )}
                  />
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane key="experience" title={<span><IconCommon /> 工作经历</span>}>
                <div style={{ marginTop: 12 }}>
                  <SectionHeader
                    icon={<IconCommon />}
                    title="工作 / 实习经历"
                    hint="按时间倒序维护"
                    onAdd={() => setWorkExperiences((items) => [...items, emptyWorkExperience()])}
                    addText="新增经历"
                  />
                  <ListSection
                    items={workExperiences}
                    setItems={setWorkExperiences}
                    renderItem={(item, idx, total, update, remove, move) => (
                      <CardShell
                        key={`inline-work-${item.id ?? idx}`}
                        index={idx}
                        total={total}
                        onMoveUp={() => move(-1)}
                        onMoveDown={() => move(1)}
                        onRemove={remove}
                      >
                        <div className="profile-form-grid">
                          <FieldRow label="公司 / 实习单位" required>
                            <Input
                              value={item.company}
                              onChange={(value) => update({ ...item, company: value })}
                              placeholder="如：字节跳动"
                            />
                          </FieldRow>
                          <FieldRow label="岗位">
                            <Input
                              value={item.position}
                              onChange={(value) => update({ ...item, position: value })}
                              placeholder="如：前端开发实习生"
                            />
                          </FieldRow>
                          <FieldRow label="开始日期">
                            <DatePicker
                              format={DAY_FORMAT}
                              value={toDate(item.start_date)}
                              onChange={(_dateString, date) =>
                                update({ ...item, start_date: formatDay(date) })
                              }
                              placeholder="请选择开始日期"
                              allowClear
                              style={{ width: '100%' }}
                            />
                          </FieldRow>
                          <FieldRow label="结束日期">
                            <div className="profile-date-with-present">
                              <DatePicker
                                format={DAY_FORMAT}
                                value={toDate(item.end_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, end_date: formatDay(date) })
                                }
                                placeholder="请选择结束日期"
                                allowClear
                                disabled={isPresentFlag(item.end_date)}
                                style={{ flex: 1 }}
                              />
                              <Checkbox
                                checked={isPresentFlag(item.end_date)}
                                onChange={(checked) =>
                                  update({ ...item, end_date: checked ? '至今' : '' })
                                }
                              >
                                至今
                              </Checkbox>
                            </div>
                          </FieldRow>
                          <FieldRow label="工作内容与成果" span={2}>
                            <Input.TextArea
                              value={item.description}
                              onChange={(value) => update({ ...item, description: value })}
                              placeholder="职责、使用的技术与量化成果"
                              autoSize={{ minRows: 3, maxRows: 6 }}
                            />
                          </FieldRow>
                        </div>
                      </CardShell>
                    )}
                  />
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane key="projects" title={<span><IconCode /> 项目经历</span>}>
                <div style={{ marginTop: 12 }}>
                  <SectionHeader
                    icon={<IconCode />}
                    title="项目经历"
                    hint="课程、个人、比赛与实战项目"
                    onAdd={() => setProjects((items) => [...items, emptyProject()])}
                    addText="新增项目"
                  />
                  <ListSection
                    items={projects}
                    setItems={setProjects}
                    renderItem={(item, idx, total, update, remove, move) => (
                      <CardShell
                        key={`inline-project-${item.id ?? idx}`}
                        index={idx}
                        total={total}
                        onMoveUp={() => move(-1)}
                        onMoveDown={() => move(1)}
                        onRemove={remove}
                      >
                        <div className="profile-form-grid">
                          <FieldRow label="项目名称" required>
                            <Input
                              value={item.name}
                              onChange={(value) => update({ ...item, name: value })}
                              placeholder="如：校园智能问答助手"
                            />
                          </FieldRow>
                          <FieldRow label="担任角色">
                            <Input
                              value={item.role}
                              onChange={(value) => update({ ...item, role: value })}
                              placeholder="如：前端负责人"
                            />
                          </FieldRow>
                          <FieldRow label="开始日期">
                            <DatePicker
                              format={DAY_FORMAT}
                              value={toDate(item.start_date)}
                              onChange={(_dateString, date) =>
                                update({ ...item, start_date: formatDay(date) })
                              }
                              placeholder="请选择开始日期"
                              allowClear
                              style={{ width: '100%' }}
                            />
                          </FieldRow>
                          <FieldRow label="结束日期">
                            <div className="profile-date-with-present">
                              <DatePicker
                                format={DAY_FORMAT}
                                value={toDate(item.end_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, end_date: formatDay(date) })
                                }
                                placeholder="请选择结束日期"
                                allowClear
                                disabled={isPresentFlag(item.end_date)}
                                style={{ flex: 1 }}
                              />
                              <Checkbox
                                checked={isPresentFlag(item.end_date)}
                                onChange={(checked) =>
                                  update({ ...item, end_date: checked ? '至今' : '' })
                                }
                              >
                                至今
                              </Checkbox>
                            </div>
                          </FieldRow>
                          <FieldRow label="项目链接">
                            <Input
                              value={item.link}
                              onChange={(value) => update({ ...item, link: value })}
                              placeholder="如：https://project.demo"
                            />
                          </FieldRow>
                          <FieldRow label="链接文案">
                            <Input
                              value={item.link_label}
                              onChange={(value) => update({ ...item, link_label: value })}
                              placeholder="如：在线访问 / GitHub"
                            />
                          </FieldRow>
                          <FieldRow label="项目亮点" span={2}>
                            <Input.TextArea
                              value={item.description}
                              onChange={(value) => update({ ...item, description: value })}
                              placeholder="项目背景、个人贡献、技术栈与量化成果"
                              autoSize={{ minRows: 3, maxRows: 6 }}
                            />
                          </FieldRow>
                        </div>
                      </CardShell>
                    )}
                  />
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane
                key="skills"
                title={
                  <span>
                    <IconThunderbolt /> 专业技能
                    {skillItemCount > 0 && <Tag color="arcoblue" size="small">{skillItemCount}</Tag>}
                  </span>
                }
              >
                <div style={{ marginTop: 12 }}>
                  <FieldRow label="专业技能">
                    <Input.TextArea
                      value={skillText}
                      onChange={setSkillText}
                      placeholder={'每行一个技能，例如：\nReact / 熟悉 Hooks 与状态管理\nPython / 熟悉数据处理'}
                      autoSize={{ minRows: 8, maxRows: 16 }}
                      maxLength={2000}
                      showWordLimit
                    />
                  </FieldRow>
                </div>
              </Tabs.TabPane>
              <Tabs.TabPane key="credentials" title={<span><IconTrophy /> 荣誉与证书</span>}>
                <div className="profile-credential-sections">
                  <div>
                    <SectionHeader
                      icon={<IconTrophy />}
                      title="获得荣誉"
                      hint="奖学金、竞赛与称号"
                      onAdd={() => setHonors((items) => [...items, emptyHonor()])}
                      addText="新增荣誉"
                    />
                    <ListSection
                      items={honors}
                      setItems={setHonors}
                      renderItem={(item, idx, total, update, remove, move) => (
                        <CardShell
                          key={`inline-honor-${item.id ?? idx}`}
                          index={idx}
                          total={total}
                          onMoveUp={() => move(-1)}
                          onMoveDown={() => move(1)}
                          onRemove={remove}
                        >
                          <div className="profile-form-grid">
                            <FieldRow label="荣誉名称" required>
                              <Input value={item.title} onChange={(value) => update({ ...item, title: value })} />
                            </FieldRow>
                            <FieldRow label="级别 / 颁奖方">
                              <Input value={item.level} onChange={(value) => update({ ...item, level: value })} />
                            </FieldRow>
                            <FieldRow label="获奖日期">
                              <DatePicker
                                format={DAY_FORMAT}
                                value={toDate(item.award_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, award_date: formatDay(date) })
                                }
                                style={{ width: '100%' }}
                                allowClear
                              />
                            </FieldRow>
                            <FieldRow label="补充说明" span={2}>
                              <Input.TextArea
                                value={item.description}
                                onChange={(value) => update({ ...item, description: value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                              />
                            </FieldRow>
                          </div>
                        </CardShell>
                      )}
                    />
                  </div>
                  <div>
                    <SectionHeader
                      icon={<IconSafe />}
                      title="资格证书"
                      hint="职业资格与等级证书"
                      onAdd={() => setCertifications((items) => [...items, emptyCertification()])}
                      addText="新增证书"
                    />
                    <ListSection
                      items={certifications}
                      setItems={setCertifications}
                      renderItem={(item, idx, total, update, remove, move) => (
                        <CardShell
                          key={`inline-cert-${item.id ?? idx}`}
                          index={idx}
                          total={total}
                          onMoveUp={() => move(-1)}
                          onMoveDown={() => move(1)}
                          onRemove={remove}
                        >
                          <div className="profile-form-grid">
                            <FieldRow label="证书名称" required>
                              <Input value={item.name} onChange={(value) => update({ ...item, name: value })} />
                            </FieldRow>
                            <FieldRow label="颁发机构">
                              <Input value={item.issuer} onChange={(value) => update({ ...item, issuer: value })} />
                            </FieldRow>
                            <FieldRow label="获得日期">
                              <DatePicker
                                format={DAY_FORMAT}
                                value={toDate(item.issue_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, issue_date: formatDay(date) })
                                }
                                style={{ width: '100%' }}
                                allowClear
                              />
                            </FieldRow>
                            <FieldRow label="有效期至">
                              <DatePicker
                                format={DAY_FORMAT}
                                value={toDate(item.expire_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, expire_date: formatDay(date) })
                                }
                                style={{ width: '100%' }}
                                allowClear
                              />
                            </FieldRow>
                            <FieldRow label="补充说明" span={2}>
                              <Input.TextArea
                                value={item.description}
                                onChange={(value) => update({ ...item, description: value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                              />
                            </FieldRow>
                          </div>
                        </CardShell>
                      )}
                    />
                  </div>
                </div>
              </Tabs.TabPane>
            </Tabs>
            <div className="profile-edit-actions">
              {lastSavedAt && (
                <span className="profile-saved-status">
                  <IconCheck /> 已保存
                </span>
              )}
              <Button type="primary" loading={saving} onClick={handleSave} style={{ minWidth: 100 }}>
                {lastSavedAt ? '保存修改' : '保存'}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <CalendarPage onBack={() => onTabChange?.('profile')} />
        )}

        {activeTab === 'security' && (
          <div style={{ padding: '32px 36px' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600, color: '#1d2129' }}>修改登录密码</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480 }}>
              <Typography.Text type="secondary">
                通过绑定邮箱接收验证码，验证后即可设置新的登录密码。
              </Typography.Text>
              <Input size="large" value={profile?.email || ''} disabled prefix={<IconSafe />} />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Input
                  size="large"
                  placeholder="输入图形验证码"
                  value={pwdCaptcha}
                  onChange={setPwdCaptcha}
                  style={{ flex: 1 }}
                />
                <img
                  src={pwdCaptchaImage || undefined}
                  alt="图形验证码"
                  title="点击刷新"
                  onClick={() => void loadPwdCaptcha()}
                  style={{ height: 40, width: 112, borderRadius: 8, cursor: 'pointer', border: '1px solid #e5e6eb', objectFit: 'cover', flexShrink: 0, background: '#f5f7fc' }}
                />
              </div>
              <Input
                size="large"
                placeholder="输入邮箱验证码"
                value={pwdCode}
                onChange={setPwdCode}
                addAfter={
                  <Button type="text" size="small" loading={sendingPwdCode} disabled={pwdCountdown > 0} onClick={handleSendPwdCode}>
                    {pwdCountdown > 0 ? `${pwdCountdown}s` : '发送验证码'}
                  </Button>
                }
              />
              <Input.Password size="large" placeholder="输入新密码" value={pwdNew} onChange={setPwdNew} />
              <Input.Password size="large" placeholder="再次输入新密码" value={pwdConfirm} onChange={setPwdConfirm} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                密码至少 8 位，且需包含大写字母、小写字母和数字。
              </Typography.Text>
              <Button type="primary" size="large" loading={resettingPwd} onClick={handleResetPwd} style={{ width: 160, marginTop: 8 }}>
                确认修改
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'feedback' && (
          <div style={{ padding: '32px 36px' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600, color: '#1d2129' }}>意见反馈</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
              <Select value={feedbackCategory} onChange={setFeedbackCategory} size="large" placeholder="选择分类">
                <Select.Option value="bug">🐛 Bug 反馈</Select.Option>
                <Select.Option value="feature">💡 功能建议</Select.Option>
                <Select.Option value="other">📝 其他</Select.Option>
              </Select>
              <Input.TextArea
                value={feedbackDesc}
                onChange={setFeedbackDesc}
                placeholder="请描述你遇到的问题或建议..."
                rows={5}
                style={{ fontSize: 14, padding: '10px 14px' }}
              />
              <div>
                <Button size="default" onClick={() => document.querySelector<HTMLInputElement>('.feedback-file-input')?.click()}>
                  📎 上传截图
                </Button>
                <input className="feedback-file-input" type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => setFeedbackFile(e.target.files?.[0] || null)} />
                {feedbackFile && <span style={{ marginLeft: 8, fontSize: 13, color: '#86909c' }}>{feedbackFile.name}</span>}
              </div>
              <Button type="primary" size="large" loading={submittingFeedback} onClick={submitFeedback} style={{ width: 120 }}>
                提交
              </Button>
            </div>
          </div>
        )}


        {activeTab === 'about' && (
          <div style={{ padding: '40px 36px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
            <img className="global-rail-logo" src="/baidi.png" alt="CareerForge" style={{ width: 64, height: 64, margin: '0 auto 16px' }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#1d2129' }}>CareerForge AI</h3>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#86909c' }}>智能辅助简历制作、优化表达与岗位匹配</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', color: '#4e5969', fontSize: 14 }}>
              <span>注册于 {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('zh-CN') : '-'}</span>
              <span style={{ color: '#86909c', fontSize: 12 }}>版本 1.0.0</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
