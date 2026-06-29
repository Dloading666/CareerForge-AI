import {
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Message,
  Modal,
  Radio,
  Select,
  Tag,
  Tabs,
  Typography,
  Upload,
} from '@arco-design/web-react'
import {
  IconArrowDown,
  IconArrowUp,
  IconBook,
  IconBug,
  IconCalendar,
  IconCamera,
  IconCheck,
  IconCode,
  IconCommon,
  IconDelete,
  IconEdit,
  IconFile,
  IconInfoCircle,
  IconLocation,
  IconPhone,
  IconPlus,
  IconRight,
  IconSafe,
  IconStar,
  IconTag,
  IconThunderbolt,
  IconTrophy,
  IconUser,
} from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../shared/auth'
import { apiRequest } from '../shared/api'
import { CalendarPage } from './CalendarPage'

// 简历事实源内部仍统一到月（YYYY-MM），页面给用户展示为更适合简历的 YYYY.MM。
const MONTH_FORMAT = 'YYYY.MM'
const MONTH_PICKER_FORMAT = 'YYYY.MM'
const RANGE_SEPARATOR = ' ~ '

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const s = normalizeMonth(value)
  if (!s || s === '至今' || s === 'present' || s === 'now') return undefined
  const d = new Date(`${s}-01T00:00:00`)
  return isNaN(d.getTime()) ? undefined : d
}

function normalizeMonth(value: string | null | undefined): string {
  if (!value) return ''
  const raw = value.trim()
  if (!raw || isPresentFlag(raw)) return raw
  const compact = raw.match(/^(\d{4})(\d{2})$/)
  if (compact) {
    const month = Number(compact[2])
    return month >= 1 && month <= 12 ? `${compact[1]}-${compact[2]}` : raw
  }
  const match = raw.match(/(\d{4})[.\-/年。．]\s*(\d{1,2})(?!\d)/)
  if (!match) return raw
  const month = Number(match[2])
  if (month < 1 || month > 12) return raw
  return `${match[1]}-${String(month).padStart(2, '0')}`
}

function normalizeMonthOrPresent(value: string | null | undefined): string {
  if (isPresentFlag(value)) return '至今'
  return normalizeMonth(value)
}

function normalizeDateRange(value: string | null | undefined): string {
  const [start, end] = splitDateRange(value)
  return joinDateRange(start, end)
}

function formatMonth(date: unknown): string {
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
  return d.getFullYear() + '-' + pad(d.getMonth() + 1)
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
  const matches = [...v.matchAll(/(?:\b(\d{4})(\d{2})\b|\b(\d{4})\s*[.\-/年。．]\s*(\d{1,2})(?!\d))/g)]
  const monthTokens = matches
    .map((match) => normalizeMonth(match[0]))
    .filter((token) => /^\d{4}-\d{2}$/.test(token))
  if (monthTokens.length >= 2) {
    return [monthTokens[0], monthTokens[1]]
  }
  if (monthTokens.length === 1) {
    return [monthTokens[0], isPresentFlag(v) ? '至今' : '']
  }
  const sepIdx = v.indexOf(RANGE_SEPARATOR)
  if (sepIdx === -1) return [normalizeMonth(v), '']
  return [normalizeMonth(v.slice(0, sepIdx).trim()), normalizeMonth(v.slice(sepIdx + RANGE_SEPARATOR.length).trim())]
}

function MonthPickerInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
}) {
  return (
    <DatePicker.MonthPicker
      format={MONTH_PICKER_FORMAT}
      value={toDate(value)}
      onChange={(_dateString, date) => onChange(formatMonth(date))}
      placeholder={placeholder}
      allowClear
      disabled={disabled}
      style={{ flex: 1, minWidth: 0 }}
    />
  )
}

function MonthRangeFields({
  start,
  end,
  onChange,
  allowPresent = false,
}: {
  start: string
  end: string
  onChange: (start: string, end: string) => void
  allowPresent?: boolean
}) {
  const endIsPresent = isPresentFlag(end)
  return (
    <div className="profile-date-range-inputs">
      <MonthPickerInput value={start} onChange={(next) => onChange(next, end)} placeholder="开始月份" />
      <span>至</span>
      <MonthPickerInput
        value={end}
        onChange={(next) => onChange(start, next)}
        placeholder="结束月份"
        disabled={endIsPresent}
      />
      {allowPresent && (
        <Checkbox checked={endIsPresent} onChange={(checked) => onChange(start, checked ? '至今' : '')}>
          至今
        </Checkbox>
      )}
    </div>
  )
}

// ---------- Types ----------

type Profile = {
  id: number
  account: string
  email: string
  name: string | null
  nickname: string | null
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

const genderLabel: Record<string, string> = { male: '男', female: '女', other: '其他' }

const jobStatusOptions = [
  { value: 'unemployed', label: '求职中' },
  { value: 'employed', label: '已就业，看新机会' },
  { value: 'considering', label: '观望中' },
  { value: 'not_looking', label: '暂不求职' },
]

const jobStatusLabel: Record<string, string> = Object.fromEntries(
  jobStatusOptions.map((o) => [o.value, o.label]),
)

function formatSavedTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return (
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  )
}

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

function parseSkillLine(line: string) {
  const separatorIndex = line.indexOf(' / ')
  if (separatorIndex === -1) {
    return { name: line.trim(), description: '' }
  }
  return {
    name: line.slice(0, separatorIndex).trim(),
    description: line.slice(separatorIndex + 3).trim(),
  }
}

// ---------- Reusable UI ----------

function MenuCard({
  icon,
  label,
  desc,
  onClick,
  accentColor,
}: {
  icon: React.ReactNode
  label: string
  desc: string
  onClick?: () => void
  accentColor: string
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '20px 28px',
        background: '#fff',
        borderRadius: 16,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        transition: 'all 0.2s ease',
        border: '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!onClick) return
        e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)'
        e.currentTarget.style.borderColor = accentColor + '20'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={(e) => {
        if (!onClick) return
        e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'
        e.currentTarget.style.borderColor = 'transparent'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: accentColor + '12',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 20,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-main)', lineHeight: '24px' }}>
          {label}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-subtle)', marginTop: 3, lineHeight: '20px' }}>
          {desc}
        </div>
      </div>
      {onClick && <IconRight style={{ fontSize: 18, color: '#c9cdd4' }} />}
    </div>
  )
}

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

export function ProfilePage({ onAvatarChange, activeTab = 'profile', onTabChange }: { onAvatarChange?: (url: string) => void; activeTab?: string; onTabChange?: (tab: string) => void }) {
  const { refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [calendarView, setCalendarView] = useState(false)
  const [feedbackVisible, setFeedbackVisible] = useState(false)
  const [feedbackDesc, setFeedbackDesc] = useState('')
  const [feedbackCategory, setFeedbackCategory] = useState('bug')
  const [feedbackFile, setFeedbackFile] = useState<File | null>(null)
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [editVisible, setEditVisible] = useState(false)
  const [editTab, setEditTab] = useState<string>('basic')
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [securityVisible, setSecurityVisible] = useState(false)
  const [pwdCode, setPwdCode] = useState('')
  const [pwdNew, setPwdNew] = useState('')
  const [pwdConfirm, setPwdConfirm] = useState('')
  const [pwdCountdown, setPwdCountdown] = useState(0)
  const [sendingPwdCode, setSendingPwdCode] = useState(false)
  const [resettingPwd, setResettingPwd] = useState(false)
  const [pwdCaptchaId, setPwdCaptchaId] = useState('')
  const [pwdCaptchaImage, setPwdCaptchaImage] = useState('')
  const [pwdCaptcha, setPwdCaptcha] = useState('')
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)
  const [changeEmailVisible, setChangeEmailVisible] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCountdown, setEmailCountdown] = useState(0)
  const [sendingEmailCode, setSendingEmailCode] = useState(false)
  const [changingEmail, setChangingEmail] = useState(false)
  const [acctCaptchaId, setAcctCaptchaId] = useState('')
  const [acctCaptchaImage, setAcctCaptchaImage] = useState('')
  const [acctCaptcha, setAcctCaptcha] = useState('')
  const [basicForm] = Form.useForm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resumeFileInputRef = useRef<HTMLInputElement>(null)
  const accountAvatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const lastAccountTabRef = useRef(false)
  const hydratedProfileIdRef = useRef<number | null>(null)
  const inModal = !!activeTab

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
      const res = await apiRequest<Profile>('/api/v1/student/profile')
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
        body: formData,
      })
      Message.success('反馈提交成功，感谢！')
      setFeedbackVisible(false)
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
      }>('/api/v1/student/profile/details')
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
    if (!inModal) setEditVisible(true)
  }

  useEffect(() => {
    if (!inModal || !profile || hydratedProfileIdRef.current === profile.id) return
    hydratedProfileIdRef.current = profile.id
    void openEdit(profile)
    // openEdit intentionally hydrates once for each mounted profile editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inModal, profile])

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
        body: JSON.stringify({
          ...values,
          birth_date: formatMonth(values.birth_date),
          personal_advantages: advantageText,
          job_search_status: jobStatus ?? null,
          expected_position: expectedPosition,
          expected_salary: expectedSalary,
          expected_location: expectedLocation,
        }),
      })
      // 基本信息（第一个 PUT）已成功。经历明细（第二个 PUT）单独捕获，
      // 失败时明确告知用户「部分成功」，避免用户误以为整体未保存而用旧数据覆盖。
      try {
        await apiRequest('/api/v1/student/profile/details', {
          method: 'PUT',
          body: JSON.stringify({
            work_experiences: workExperiences.map((item) => ({
              ...item,
              start_date: normalizeMonthOrPresent(item.start_date),
              end_date: normalizeMonthOrPresent(item.end_date),
            })),
            projects: projects.map((item) => ({
              ...item,
              start_date: normalizeMonthOrPresent(item.start_date),
              end_date: normalizeMonthOrPresent(item.end_date),
            })),
            honors: honors.map((item) => ({
              ...item,
              award_date: normalizeMonth(item.award_date),
            })),
            educations: educations.map((item) => ({
              ...item,
              duration: normalizeDateRange(item.duration),
            })),
            certifications: certifications.map((item) => ({
              ...item,
              issue_date: normalizeMonth(item.issue_date),
              expire_date: normalizeMonth(item.expire_date),
            })),
            skills: skillItems,
          }),
        })
      } catch {
        Message.warning('基本信息已保存，但经历明细保存失败，请重试保存')
        void fetchProfile()
        return
      }
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
  const jobStatusText = profile?.job_search_status ? jobStatusLabel[profile.job_search_status] : null
  const skillItemCount = useMemo(
    () =>
      skillText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length,
    [skillText],
  )
  const profileSummary = useMemo(() => {
    const parts: string[] = []
    if (profile?.expected_position) parts.push(`期望：${profile.expected_position}`)
    if (profile?.expected_salary) parts.push(`薪资：${profile.expected_salary}`)
    if (profile?.expected_location) parts.push(`地点：${profile.expected_location}`)
    if (jobStatusText) parts.push(jobStatusText)
    return parts.join(' · ')
  }, [profile, jobStatusText])

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
    if (inModal && activeTab === 'security') void loadPwdCaptcha()
  }, [inModal, activeTab])

  const openSecurity = () => {
    setPwdCode('')
    setPwdNew('')
    setPwdConfirm('')
    setPwdCountdown(0)
    setPwdCaptcha('')
    if (!inModal) setSecurityVisible(true)
    void loadPwdCaptcha()
  }

  const handleSendPwdCode = async () => {
    if (!profile?.email) return
    if (!pwdCaptcha.trim()) {
      Message.warning('请先完成图形验证码')
      return
    }
    setSendingPwdCode(true)
    try {
      const res = await apiRequest<{ cooldown_sec: number }>(
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
      Message.success('验证码已发送至邮箱，请查收')
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
      setSecurityVisible(false)
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

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      Message.error('文件不能超过 2MB')
      return
    }
    uploadFile(
      file,
      '/api/v1/student/profile/avatar',
      (url) => {
        setProfile((p) => (p ? { ...p, avatar_url: url } : p))
        onAvatarChange?.(url)
      },
      setUploading,
    )
    e.target.value = ''
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

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      Message.error('文件不能超过 5MB')
      return
    }
    uploadFile(
      file,
      '/api/v1/student/profile/banner',
      (url) => setProfile((p) => (p ? { ...p, banner_url: url } : p)),
      setUploadingBanner,
    )
    e.target.value = ''
  }


  const loadAcctCaptcha = async () => {
    try {
      const data = await apiRequest<{ captcha_id: string; image: string }>('/api/v1/auth/captcha')
      setAcctCaptchaId(data.captcha_id)
      setAcctCaptchaImage(data.image)
      setAcctCaptcha('')
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (emailCountdown <= 0) return
    const t = window.setTimeout(() => setEmailCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [emailCountdown])

  useEffect(() => {
    const isAccount = activeTab === 'account'
    // Only seed the draft on the transition into the account tab.
    // Depending on nicknameDraft would re-fire on every keystroke and
    // reset an intentionally-empty draft back to the saved value.
    if (isAccount && !lastAccountTabRef.current && profile) {
      setNicknameDraft(profile.nickname ?? '')
    }
    lastAccountTabRef.current = isAccount
  }, [activeTab, profile])

  const openChangeEmail = () => {
    setNewEmail('')
    setEmailCode('')
    setEmailCountdown(0)
    setAcctCaptcha('')
    setChangeEmailVisible(true)
    void loadAcctCaptcha()
  }

  const handleSaveNickname = async () => {
    const trimmed = nicknameDraft.trim()
    if (trimmed.length > 64) {
      Message.warning('昵称长度不能超过 64 个字符')
      return
    }
    if ((profile?.nickname ?? '') === trimmed) {
      Message.info('昵称未发生变化')
      return
    }
    setSavingNickname(true)
    try {
      await apiRequest('/api/v1/student/profile', {
        method: 'PUT',
        body: JSON.stringify({ nickname: trimmed || null }),
      })
      setProfile((p) => (p ? { ...p, nickname: trimmed || null } : p))
      void refreshProfile()
      Message.success('昵称保存成功')
    } catch (e) {
      Message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSavingNickname(false)
    }
  }

  const handleSendEmailCode = async () => {
    if (!newEmail.trim()) {
      Message.warning('请输入新邮箱')
      return
    }
    if (!acctCaptcha.trim()) {
      Message.warning('请先完成图形验证码')
      return
    }
    setSendingEmailCode(true)
    try {
      const res = await apiRequest<{ cooldown_sec: number }>(
        '/api/v1/auth/student/email/send-code',
        {
          method: 'POST',
          body: JSON.stringify({
            email: newEmail.trim(),
            scene: 'change_email',
            captcha_id: acctCaptchaId,
            captcha_code: acctCaptcha.trim(),
          }),
        },
      )
      setEmailCountdown(res.cooldown_sec || 60)
      Message.success('验证码已发送至新邮箱，请查收')
    } catch (e) {
      Message.error(e instanceof Error ? e.message : '验证码发送失败')
      void loadAcctCaptcha()
    } finally {
      setSendingEmailCode(false)
    }
  }

  const handleChangeEmail = async () => {
    if (!newEmail.trim() || !emailCode.trim()) {
      Message.warning('请填写新邮箱和验证码')
      return
    }
    setChangingEmail(true)
    try {
      await apiRequest('/api/v1/student/profile/email', {
        method: 'PUT',
        body: JSON.stringify({ new_email: newEmail.trim(), code: emailCode.trim() }),
      })
      setProfile((p) => (p ? { ...p, email: newEmail.trim(), email_verified_at: new Date().toISOString() } : p))
      void refreshProfile()
      Message.success('邮箱修改成功')
      setChangeEmailVisible(false)
    } catch (e) {
      Message.error(e instanceof Error ? e.message : '邮箱修改失败')
    } finally {
      setChangingEmail(false)
    }
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

  if (calendarView) return <CalendarPage onBack={() => setCalendarView(false)} />

  const avatarUrl = profile?.avatar_url || ''
  const initials = (profile?.name || profile?.email || '?')[0].toUpperCase()
  const subtitle =
    [
      profile?.gender && genderLabel[profile.gender],
      profile?.age && profile.age + '岁',
      profile?.college,
    ]
      .filter(Boolean)
      .join(' · ') || '完善资料，展示更好的自己'

  return (
    <div className="profile-scroll" style={{ width: '100%', position: 'relative' }}>
      {!inModal && (
      <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: profile?.banner_url
            ? `url(${profile.banner_url}) center/cover no-repeat`
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          zIndex: 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 40%, rgba(255,255,255,0.95) 70%, #fff 100%)',
          zIndex: 1,
        }}
      />
      </>
      )}
      <div style={{ position: 'relative', zIndex: 2, padding: inModal ? 0 : '0 28px 40px', ...(inModal ? { flex: 1, display: 'flex', flexDirection: 'column' } : {}) }}>
        {!inModal && (
        <div
          style={{
            margin: '20px -28px 24px',
            padding: '40px 36px 32px',
            borderRadius: 0,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {!profile?.banner_url && (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: -50,
                  right: -30,
                  width: 180,
                  height: 180,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.06)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: -40,
                  left: '40%',
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.04)',
                }}
              />
            </>
          )}
          <div
            onClick={() => bannerInputRef.current?.click()}
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              background: 'rgba(0,0,0,0.25)',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.25)'
            }}
          >
            <IconEdit style={{ fontSize: 14 }} />
            {uploadingBanner ? '上传中...' : profile?.banner_url ? '更换封面' : '自定义封面'}
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={handleBannerChange}
          />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 24 }}>
            <div
              style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}
              onClick={() => fileInputRef.current?.click()}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="avatar"
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '3px solid rgba(255,255,255,0.4)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 38,
                    fontWeight: 700,
                    border: '3px solid rgba(255,255,255,0.4)',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
                  }}
                >
                  {initials}
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  bottom: 3,
                  right: 3,
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}
              >
                <IconCamera style={{ fontSize: 15, color: '#165dff' }} />
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Title
                heading={3}
                style={{
                  margin: '0 0 8px',
                  color: '#fff',
                  fontSize: 24,
                  letterSpacing: '0.5px',
                }}
              >
                {profile?.name || '未设置姓名'}
                {uploading && (
                  <span style={{ fontSize: 13, opacity: 0.7, marginLeft: 8, fontWeight: 400 }}>
                    上传中...
                  </span>
                )}
              </Typography.Title>
              <Typography.Paragraph
                style={{
                  margin: '0 0 4px',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 15,
                  fontStyle: profile?.signature ? 'normal' : 'italic',
                }}
              >
                {profile?.signature || '设置一句个性签名吧'}
              </Typography.Paragraph>
              <Typography.Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)' }}>
                {subtitle}
              </Typography.Text>
              {profileSummary && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.85)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                  }}
                >
                  {profileSummary.split(' · ').map((p) => (
                    <span
                      key={p}
                      style={{
                        padding: '2px 10px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.18)',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        )}

        {!inModal && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <MenuCard
            icon={<IconUser style={{ fontSize: 26, color: '#165dff' }} />}
            label="个人中心 · 资料"
            desc={
              [
                profile?.name,
                profile?.gender && genderLabel[profile.gender],
                profile?.age && profile.age + '岁',
                profile?.college,
              ]
                .filter(Boolean)
                .join(' · ') || '完善个人优势、求职期望、经历、荣誉、证书与技能'
            }
            accentColor="#165dff"
            onClick={() => void openEdit()}
          />
          <MenuCard
            icon={<IconCalendar style={{ fontSize: 26, color: '#722ed1' }} />}
            label="日程管理"
            desc="查看和管理日程安排"
            accentColor="#722ed1"
            onClick={() => setCalendarView(true)}
          />
          <MenuCard
            icon={<IconFile style={{ fontSize: 26, color: '#f53f3f' }} />}
            label="我的简历"
            desc="进入简历中心编辑、导出与模板切换"
            accentColor="#f53f3f"
            onClick={() => navigate('/student/resumes')}
          />
          <MenuCard
            icon={<IconSafe style={{ fontSize: 26, color: '#00b42a' }} />}
            label="账号安全"
            desc={(profile?.email_verified_at ? '邮箱已认证' : '邮箱未认证') + ' · 修改登录密码'}
            accentColor="#00b42a"
            onClick={openSecurity}
          />
          <MenuCard
            icon={<IconBug style={{ fontSize: 26, color: '#f53f3f' }} />}
            label="意见反馈"
            desc="提交问题截图和描述，帮助我们改进"
            accentColor="#f53f3f"
            onClick={() => { if (!inModal) setFeedbackVisible(true) }}
          />
          <MenuCard
            icon={<IconInfoCircle style={{ fontSize: 26, color: '#ff7d00' }} />}
            label="关于 CareerForge"
            desc={'注册于 ' + (profile?.created_at ? new Date(profile.created_at).toLocaleDateString('zh-CN') : '-')}
            accentColor="#ff7d00"
          />
        </div>
        )}

        {inModal && activeTab === 'profile' && (
          <div className="profile-edit-inline">
            <div className="profile-edit-layout">
              <div className="profile-edit-nav">
                {[
                  { key: 'basic', icon: <IconUser />, label: '基本信息' },
                  { key: 'advantage', icon: <IconStar />, label: '求职偏好' },
                  { key: 'education', icon: <IconBook />, label: '教育经历' },
                  { key: 'experience', icon: <IconCommon />, label: '工作经历' },
                  { key: 'projects', icon: <IconCode />, label: '项目经历' },
                  { key: 'skills', icon: <IconThunderbolt />, label: '专业技能', badge: skillItemCount > 0 ? skillItemCount : undefined },
                  { key: 'credentials', icon: <IconTrophy />, label: '荣誉与证书' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`profile-edit-nav-item${editTab === item.key ? ' active' : ''}`}
                    onClick={() => setEditTab(item.key)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {'badge' in item && item.badge ? <span className="profile-edit-nav-badge">{item.badge}</span> : null}
                  </button>
                ))}
              </div>
              <div className="profile-edit-content">
                {editTab === 'basic' && (
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
                    <FieldRow label="出生月份">
                      <Form.Item field="birth_date" noStyle>
                        <DatePicker.MonthPicker
                          format={MONTH_FORMAT}
                          placeholder="请选择出生月份"
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
              )}
              {editTab === 'advantage' && (
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
              )}
              {editTab === 'education' && (
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
                          <FieldRow label="起止月份">
                            {(() => {
                              const [startDate, endDate] = splitDateRange(item.duration)
                              return (
                                <MonthRangeFields
                                  start={startDate}
                                  end={endDate}
                                  onChange={(start, end) =>
                                    update({ ...item, duration: joinDateRange(start, end) })
                                  }
                                />
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
              )}
              {editTab === 'experience' && (
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
                          <FieldRow label="开始月份">
                            <DatePicker.MonthPicker
                              format={MONTH_PICKER_FORMAT}
                              value={toDate(item.start_date)}
                              onChange={(_dateString, date) =>
                                update({ ...item, start_date: formatMonth(date) })
                              }
                              placeholder="请选择开始月份"
                              allowClear
                              style={{ width: '100%' }}
                            />
                          </FieldRow>
                          <FieldRow label="结束月份">
                            <div className="profile-date-with-present">
                              <DatePicker.MonthPicker
                                format={MONTH_PICKER_FORMAT}
                                value={toDate(item.end_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, end_date: formatMonth(date) })
                                }
                                placeholder="请选择结束月份"
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
              )}
              {editTab === 'projects' && (
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
                          <FieldRow label="开始月份">
                            <DatePicker.MonthPicker
                              format={MONTH_PICKER_FORMAT}
                              value={toDate(item.start_date)}
                              onChange={(_dateString, date) =>
                                update({ ...item, start_date: formatMonth(date) })
                              }
                              placeholder="请选择开始月份"
                              allowClear
                              style={{ width: '100%' }}
                            />
                          </FieldRow>
                          <FieldRow label="结束月份">
                            <div className="profile-date-with-present">
                              <DatePicker.MonthPicker
                                format={MONTH_PICKER_FORMAT}
                                value={toDate(item.end_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, end_date: formatMonth(date) })
                                }
                                placeholder="请选择结束月份"
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
              )}
              {editTab === 'skills' && (
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
              )}
              {editTab === 'credentials' && (
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
                            <FieldRow label="获奖月份">
                              <DatePicker.MonthPicker
                                format={MONTH_FORMAT}
                                value={toDate(item.award_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, award_date: formatMonth(date) })
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
                            <FieldRow label="获得月份">
                              <DatePicker.MonthPicker
                                format={MONTH_FORMAT}
                                value={toDate(item.issue_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, issue_date: formatMonth(date) })
                                }
                                style={{ width: '100%' }}
                                allowClear
                              />
                            </FieldRow>
                            <FieldRow label="有效期至">
                              <DatePicker.MonthPicker
                                format={MONTH_FORMAT}
                                value={toDate(item.expire_date)}
                                onChange={(_dateString, date) =>
                                  update({ ...item, expire_date: formatMonth(date) })
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
              )}
              </div>
            </div>
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

        {inModal && activeTab === 'calendar' && (
          <CalendarPage onBack={() => onTabChange?.('profile')} />
        )}

        {inModal && activeTab === 'security' && (
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

        {inModal && activeTab === 'feedback' && (
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

        {inModal && activeTab === 'account' && (
          <div className="profile-account-tab">
            <div className="profile-account-header">
              <h3 className="profile-account-title">账号管理</h3>
              <p className="profile-account-subtitle">管理你的账号身份、头像与登录邮箱。</p>
            </div>

            {/* Identity card */}
            <div className="profile-account-identity">
              <div
                className="profile-account-avatar profile-account-avatar--lg"
                onClick={() => accountAvatarInputRef.current?.click()}
                title="点击更换头像"
                role="button"
              >
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="账号头像" />
                ) : (
                  <span className="profile-account-avatar-fallback">
                    {(profile?.nickname || profile?.name || profile?.email || '?')[0].toUpperCase()}
                  </span>
                )}
                <div className="profile-account-avatar-overlay">
                  <IconCamera style={{ fontSize: 18 }} />
                </div>
                {uploading && <div className="profile-account-avatar-loading">上传中…</div>}
              </div>
              <input
                ref={accountAvatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
              <div className="profile-account-identity-body">
                <div className="profile-account-identity-name">
                  <span className="profile-account-name">
                    {profile?.nickname || profile?.name || '未设置昵称'}
                  </span>
                  <span className="profile-account-chip profile-account-chip--role">学生</span>
                  {profile?.email_verified_at ? (
                    <span className="profile-account-chip profile-account-chip--ok">已验证</span>
                  ) : (
                    <span className="profile-account-chip profile-account-chip--warn">未验证</span>
                  )}
                </div>
                <div className="profile-account-identity-meta">
                  <span>{profile?.email || '尚未绑定邮箱'}</span>
                </div>
                <div className="profile-account-identity-actions">
                  <Button size="small" type="secondary" icon={<IconCamera />} onClick={() => accountAvatarInputRef.current?.click()}>
                    更换头像
                  </Button>
                </div>
              </div>
            </div>

            {/* Settings list */}
            <div className="profile-account-settings">
              <div className="profile-account-row">
                <div className="profile-account-row-label">个人昵称</div>
                <div className="profile-account-row-content">
                  <Input
                    value={nicknameDraft}
                    onChange={setNicknameDraft}
                    placeholder="请输入个人昵称"
                    maxLength={64}
                    showWordLimit
                  />
                </div>
                <div className="profile-account-row-action">
                  <Button
                    type="primary"
                    loading={savingNickname}
                    disabled={(profile?.nickname ?? '') === nicknameDraft.trim()}
                    onClick={handleSaveNickname}
                  >
                    保存
                  </Button>
                </div>
              </div>

              <div className="profile-account-divider" />

              <div className="profile-account-row">
                <div className="profile-account-row-label">邮箱地址</div>
                <div className="profile-account-row-content">
                  <div className="profile-account-email-value">
                    <span>{profile?.email || '尚未绑定邮箱'}</span>
                    {profile?.email_verified_at ? (
                      <span className="profile-account-chip profile-account-chip--ok">已验证</span>
                    ) : (
                      <span className="profile-account-chip profile-account-chip--warn">未验证</span>
                    )}
                  </div>
                  <div className="profile-account-row-hint">
                    {profile?.email_verified_at
                      ? '邮箱已身份验证，修改后需重新验证。'
                      : '邮箱尚未验证，更换后可接收验证码。'}
                  </div>
                </div>
                <div className="profile-account-row-action">
                  <Button onClick={openChangeEmail}>更换</Button>
                </div>
              </div>
            </div>

            {/* Read-only account info */}
            <div className="profile-account-info">
              <div className="profile-account-info-label">账号信息</div>
              <div className="profile-account-info-list">
                <div className="profile-account-info-row">
                  <span className="profile-account-info-key">角色</span>
                  <span className="profile-account-info-val">学生</span>
                </div>
                <div className="profile-account-info-row">
                  <span className="profile-account-info-key">登录账号</span>
                  <span className="profile-account-info-val">{profile?.account || profile?.email || '-'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        {inModal && activeTab === 'about' && (
          <div style={{ padding: '40px 36px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
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
      <Modal
        title="账号管理 · 更换邮箱"
        visible={changeEmailVisible}
        onCancel={() => setChangeEmailVisible(false)}
        onOk={handleChangeEmail}
        confirmLoading={changingEmail}
        okText="确认修改"
        cancelText="取消"
        unmountOnExit
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          <Typography.Text type="secondary">
            通过新邮箱接收验证码，验证后将会把账号邮箱切换到新地址。
          </Typography.Text>
          <Input
            size="large"
            placeholder="请输入新邮箱地址"
            value={newEmail}
            onChange={setNewEmail}
            prefix={<IconSafe />}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Input
              size="large"
              placeholder="输入图形验证码"
              value={acctCaptcha}
              onChange={setAcctCaptcha}
              style={{ flex: 1 }}
            />
            <img
              src={acctCaptchaImage || undefined}
              alt="图形验证码"
              title="点击刷新"
              onClick={() => void loadAcctCaptcha()}
              style={{
                height: 40,
                width: 112,
                borderRadius: 8,
                cursor: 'pointer',
                border: '1px solid var(--surface-border)',
                objectFit: 'cover',
                flexShrink: 0,
                background: '#f5f7fc',
              }}
            />
          </div>
          <Input
            size="large"
            placeholder="输入邮箱验证码"
            value={emailCode}
            onChange={setEmailCode}
            addAfter={
              <Button
                type="text"
                size="small"
                loading={sendingEmailCode}
                disabled={emailCountdown > 0}
                onClick={handleSendEmailCode}
              >
                {emailCountdown > 0 ? `${emailCountdown}s` : '发送验证码'}
              </Button>
            }
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            验证码有效期 10 分钟，请在验证码到期前完成验证。
          </Typography.Text>
        </div>
      </Modal>

      <Modal
        title="账号安全 · 修改登录密码"
        visible={!inModal && securityVisible}
        onCancel={() => setSecurityVisible(false)}
        onOk={handleResetPwd}
        confirmLoading={resettingPwd}
        okText="确认修改"
        cancelText="取消"
        unmountOnExit
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
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
              style={{
                height: 40,
                width: 112,
                borderRadius: 8,
                cursor: 'pointer',
                border: '1px solid var(--surface-border)',
                objectFit: 'cover',
                flexShrink: 0,
                background: '#f5f7fc',
              }}
            />
          </div>
          <Input
            size="large"
            placeholder="输入邮箱验证码"
            value={pwdCode}
            onChange={setPwdCode}
            addAfter={
              <Button
                type="text"
                size="small"
                loading={sendingPwdCode}
                disabled={pwdCountdown > 0}
                onClick={handleSendPwdCode}
              >
                {pwdCountdown > 0 ? `${pwdCountdown}s` : '发送验证码'}
              </Button>
            }
          />
          <Input.Password size="large" placeholder="输入新密码" value={pwdNew} onChange={setPwdNew} />
          <Input.Password
            size="large"
            placeholder="再次输入新密码"
            value={pwdConfirm}
            onChange={setPwdConfirm}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            密码至少 8 位，且需包含大写字母、小写字母和数字。
          </Typography.Text>
        </div>
      </Modal>
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>编辑个人中心</span>
            {lastSavedAt && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 400,
                  color: '#00b42a',
                  background: 'rgba(0, 180, 42, 0.1)',
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                <IconCheck style={{ fontSize: 12 }} />
                <span>已保存 {formatSavedTime(lastSavedAt)}</span>
              </span>
            )}
          </div>
        }
        visible={!inModal && editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        unmountOnExit
        style={{ width: 880, maxWidth: '95vw' }}
      >
        <Tabs activeTab={editTab} onChange={setEditTab} type="rounded" size="small">
          <Tabs.TabPane
            key="basic"
            title={
              <span>
                <IconUser /> 基本信息
              </span>
            }
          >
            <Form form={basicForm} layout="vertical" style={{ marginTop: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <FieldRow label="姓名" required>
                  <Form.Item field="name" noStyle>
                    <Input placeholder="请输入姓名" allowClear />
                  </Form.Item>
                </FieldRow>
                <FieldRow label="性别">
                  <Form.Item field="gender" noStyle>
                    <Radio.Group>
                      <Radio value="male">男</Radio>
                      <Radio value="female">女</Radio>
                      <Radio value="other">其他</Radio>
                    </Radio.Group>
                  </Form.Item>
                </FieldRow>
                <FieldRow label="出生月份">
                  <Form.Item field="birth_date" noStyle>
                    <DatePicker.MonthPicker
                      format={MONTH_FORMAT}
                      placeholder="请选择出生月份"
                      allowClear
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                </FieldRow>
                <FieldRow label="手机号">
                  <Form.Item field="phone" noStyle>
                    <Input placeholder="请输入手机号" prefix={<IconPhone />} />
                  </Form.Item>
                </FieldRow>
                <FieldRow label="个性签名" span={2}>
                  <Form.Item field="signature" noStyle>
                    <Input.TextArea
                      placeholder="写一句话介绍自己..."
                      maxLength={200}
                      showWordLimit
                      autoSize={{ minRows: 2, maxRows: 4 }}
                    />
                  </Form.Item>
                </FieldRow>
              </div>
            </Form>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="job"
            title={
              <span>
                <IconStar /> 个人优势与求职期望
              </span>
            }
          >
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 12 }}
            >
              <FieldRow label="个人优势" required>
                <Input.TextArea
                  value={advantageText}
                  onChange={setAdvantageText}
                  placeholder="建议分点描述你的核心优势，例如：扎实的机器学习基础 / 多次国家级竞赛获奖 / 一年互联网大厂实习经验"
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  maxLength={1000}
                  showWordLimit
                />
              </FieldRow>
              <FieldRow label="求职状态">
                <Select
                  placeholder="请选择当前的求职状态"
                  value={jobStatus}
                  onChange={setJobStatus}
                  allowClear
                >
                  {jobStatusOptions.map((o) => (
                    <Select.Option key={o.value} value={o.value}>
                      {o.label}
                    </Select.Option>
                  ))}
                </Select>
              </FieldRow>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                <FieldRow label="期望工作岗位">
                  <Input
                    value={expectedPosition}
                    onChange={setExpectedPosition}
                    placeholder="如：NLP 算法工程师 / 前端开发"
                    prefix={<IconTag />}
                    allowClear
                  />
                </FieldRow>
                <FieldRow label="期望工作地点">
                  <Input
                    value={expectedLocation}
                    onChange={setExpectedLocation}
                    placeholder="如：北京、上海；多个用逗号分隔"
                    prefix={<IconLocation />}
                    allowClear
                  />
                </FieldRow>
                <FieldRow label="期望工作薪资" span={2}>
                  <Input
                    value={expectedSalary}
                    onChange={setExpectedSalary}
                    placeholder="如：15k-25k/月 · 14 薪；面议可填 面议"
                    allowClear
                  />
                </FieldRow>
              </div>
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="experience"
            title={
              <span>
                <IconCommon /> 工作 / 实习经历
              </span>
            }
          >
            <div style={{ marginTop: 12 }}>
              <SectionHeader
                icon={<IconCommon />}
                title="工作 / 实习经历"
                hint="支持多条，按时间倒序展示"
                onAdd={() => setWorkExperiences((arr) => [...arr, emptyWorkExperience()])}
              />
              <ListSection
                items={workExperiences}
                setItems={setWorkExperiences}
                renderItem={(item, idx, total, update, remove, move) => (
                  <CardShell
                    key={`work-${idx}`}
                    index={idx}
                    total={total}
                    onMoveUp={() => move(-1)}
                    onMoveDown={() => move(1)}
                    onRemove={remove}
                  >
                    <div
                      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
                    >
                      <FieldRow label="公司 / 实习单位" required>
                        <Input
                          value={item.company}
                          onChange={(v) => update({ ...item, company: v })}
                          placeholder="如：阿里巴巴 / 字节跳动"
                        />
                      </FieldRow>
                      <FieldRow label="岗位">
                        <Input
                          value={item.position}
                          onChange={(v) => update({ ...item, position: v })}
                          placeholder="如：后端开发实习生"
                        />
                      </FieldRow>
                      <FieldRow label="开始月份">
                        <DatePicker.MonthPicker
                          format={MONTH_PICKER_FORMAT}
                          value={toDate(item.start_date)}
                          onChange={(_dateString, date) =>
                            update({ ...item, start_date: formatMonth(date) })
                          }
                          placeholder="请选择开始月份"
                          allowClear
                          style={{ width: '100%' }}
                        />
                      </FieldRow>
                      <FieldRow label="结束月份">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <DatePicker.MonthPicker
                            format={MONTH_PICKER_FORMAT}
                            value={toDate(item.end_date)}
                            onChange={(_dateString, date) =>
                              update({ ...item, end_date: formatMonth(date) })
                            }
                            placeholder="请选择结束月份"
                            allowClear
                            disabled={isPresentFlag(item.end_date)}
                            style={{ flex: 1 }}
                          />
                          <Checkbox
                            checked={isPresentFlag(item.end_date)}
                            onChange={(checked) =>
                              update({
                                ...item,
                                end_date: checked ? '至今' : '',
                              })
                            }
                          >
                            至今
                          </Checkbox>
                        </div>
                      </FieldRow>
                      <FieldRow label="工作内容与成果" span={2}>
                        <Input.TextArea
                          value={item.description}
                          onChange={(v) => update({ ...item, description: v })}
                          placeholder="描述你承担的工作、用到的技术、量化取得的成果..."
                          autoSize={{ minRows: 3, maxRows: 6 }}
                          maxLength={1000}
                          showWordLimit
                        />
                      </FieldRow>
                    </div>
                  </CardShell>
                )}
              />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="projects"
            title={
              <span>
                <IconCode /> 项目经历
              </span>
            }
          >
            <div style={{ marginTop: 12 }}>
              <SectionHeader
                icon={<IconCode />}
                title="项目经历"
                hint="课程、个人、比赛项目都可记录"
                onAdd={() => setProjects((arr) => [...arr, emptyProject()])}
              />
              <ListSection
                items={projects}
                setItems={setProjects}
                renderItem={(item, idx, total, update, remove, move) => (
                  <CardShell
                    key={`project-${idx}`}
                    index={idx}
                    total={total}
                    onMoveUp={() => move(-1)}
                    onMoveDown={() => move(1)}
                    onRemove={remove}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="项目名称" required>
                        <Input
                          value={item.name}
                          onChange={(v) => update({ ...item, name: v })}
                          placeholder="如：基于 RAG 的校园问答助手"
                        />
                      </FieldRow>
                      <FieldRow label="担任角色">
                        <Input
                          value={item.role}
                          onChange={(v) => update({ ...item, role: v })}
                          placeholder="如：后端开发 / 项目负责人"
                        />
                      </FieldRow>
                      <FieldRow label="开始月份">
                        <DatePicker.MonthPicker
                          format={MONTH_PICKER_FORMAT}
                          value={toDate(item.start_date)}
                          onChange={(_dateString, date) =>
                            update({ ...item, start_date: formatMonth(date) })
                          }
                          placeholder="请选择开始月份"
                          allowClear
                          style={{ width: '100%' }}
                        />
                      </FieldRow>
                      <FieldRow label="结束月份">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <DatePicker.MonthPicker
                            format={MONTH_PICKER_FORMAT}
                            value={toDate(item.end_date)}
                            onChange={(_dateString, date) =>
                              update({ ...item, end_date: formatMonth(date) })
                            }
                            placeholder="请选择结束月份"
                            allowClear
                            disabled={isPresentFlag(item.end_date)}
                            style={{ flex: 1 }}
                          />
                          <Checkbox
                            checked={isPresentFlag(item.end_date)}
                            onChange={(checked) =>
                              update({
                                ...item,
                                end_date: checked ? '至今' : '',
                              })
                            }
                          >
                            至今
                          </Checkbox>
                        </div>
                      </FieldRow>
                      <FieldRow label="项目亮点" span={2}>
                        <Input.TextArea
                          value={item.description}
                          onChange={(v) => update({ ...item, description: v })}
                          placeholder="项目背景、你的贡献、技术栈、量化成果..."
                          autoSize={{ minRows: 3, maxRows: 6 }}
                          maxLength={1000}
                          showWordLimit
                        />
                      </FieldRow>
                    </div>
                  </CardShell>
                )}
              />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="education"
            title={
              <span>
                <IconBook /> 教育经历
              </span>
            }
          >
            <div style={{ marginTop: 12 }}>
              <SectionHeader
                icon={<IconBook />}
                title="教育经历"
                hint="本科及以上的教育背景"
                onAdd={() => setEducations((arr) => [...arr, emptyEducation()])}
                addText="新增教育经历"
              />
              <ListSection
                items={educations}
                setItems={setEducations}
                renderItem={(item, idx, total, update, remove, move) => (
                  <CardShell
                    key={`edu-${idx}`}
                    index={idx}
                    total={total}
                    onMoveUp={() => move(-1)}
                    onMoveDown={() => move(1)}
                    onRemove={remove}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="学校" required>
                        <Input
                          value={item.school}
                          onChange={(v) => update({ ...item, school: v })}
                          placeholder="如：北京邮电大学"
                        />
                      </FieldRow>
                      <FieldRow label="专业">
                        <Input
                          value={item.major}
                          onChange={(v) => update({ ...item, major: v })}
                          placeholder="如：计算机科学与技术"
                        />
                      </FieldRow>
                      <FieldRow label="学历 / 学位">
                        <Input
                          value={item.degree}
                          onChange={(v) => update({ ...item, degree: v })}
                          placeholder="如：本科 / 硕士"
                        />
                      </FieldRow>
                      <FieldRow label="起止月份">
                        {(() => {
                          const [startStr, endStr] = splitDateRange(item.duration)
                          return (
                            <MonthRangeFields
                              start={startStr}
                              end={endStr}
                              allowPresent
                              onChange={(start, end) =>
                                update({ ...item, duration: joinDateRange(start, end) })
                              }
                            />
                          )
                        })()}
                      </FieldRow>
                      <FieldRow label="GPA / 排名 / 亮点" span={2}>
                        <Input.TextArea
                          value={item.description}
                          onChange={(v) => update({ ...item, description: v })}
                          placeholder="如 GPA 3.8/4.0，专业前 5%；或代表性课程与亮点"
                          autoSize={{ minRows: 2, maxRows: 4 }}
                        />
                      </FieldRow>
                    </div>
                  </CardShell>
                )}
              />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="honors"
            title={
              <span>
                <IconTrophy /> 获得荣誉
              </span>
            }
          >
            <div style={{ marginTop: 12 }}>
              <SectionHeader
                icon={<IconTrophy />}
                title="获得荣誉"
                hint="奖学金、竞赛、称号等"
                onAdd={() => setHonors((arr) => [...arr, emptyHonor()])}
              />
              <ListSection
                items={honors}
                setItems={setHonors}
                renderItem={(item, idx, total, update, remove, move) => (
                  <CardShell
                    key={`honor-${idx}`}
                    index={idx}
                    total={total}
                    onMoveUp={() => move(-1)}
                    onMoveDown={() => move(1)}
                    onRemove={remove}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="荣誉名称" required>
                        <Input
                          value={item.title}
                          onChange={(v) => update({ ...item, title: v })}
                          placeholder="如：国家奖学金"
                        />
                      </FieldRow>
                      <FieldRow label="级别 / 颁奖方">
                        <Input
                          value={item.level}
                          onChange={(v) => update({ ...item, level: v })}
                          placeholder="如：国家级 / 校级 / ACM 区域赛"
                        />
                      </FieldRow>
                      <FieldRow label="获奖月份">
                        <DatePicker.MonthPicker
                          format={MONTH_FORMAT}
                          value={toDate(item.award_date)}
                          onChange={(_dateString, date) =>
                            update({ ...item, award_date: formatMonth(date) })
                          }
                          placeholder="请选择获奖月份"
                          allowClear
                          style={{ width: '100%' }}
                        />
                      </FieldRow>
                      <FieldRow label="备注" span={2}>
                        <Input.TextArea
                          value={item.description}
                          onChange={(v) => update({ ...item, description: v })}
                          placeholder="团队 / 项目 / 排名等补充说明"
                          allowClear
                          autoSize={{ minRows: 2, maxRows: 4 }}
                        />
                      </FieldRow>
                    </div>
                  </CardShell>
                )}
              />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane
            key="cert"
            title={
              <span>
                <IconSafe /> 资格证书
              </span>
            }
          >
            <div style={{ marginTop: 12 }}>
              <SectionHeader
                icon={<IconSafe />}
                title="资格证书"
                hint="职业资格、等级证书等"
                onAdd={() => setCertifications((arr) => [...arr, emptyCertification()])}
              />
              <ListSection
                items={certifications}
                setItems={setCertifications}
                renderItem={(item, idx, total, update, remove, move) => (
                  <CardShell
                    key={`cert-${idx}`}
                    index={idx}
                    total={total}
                    onMoveUp={() => move(-1)}
                    onMoveDown={() => move(1)}
                    onRemove={remove}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <FieldRow label="证书名称" required>
                        <Input
                          value={item.name}
                          onChange={(v) => update({ ...item, name: v })}
                          placeholder="如：软件设计师 / PMP"
                        />
                      </FieldRow>
                      <FieldRow label="颁发机构">
                        <Input
                          value={item.issuer}
                          onChange={(v) => update({ ...item, issuer: v })}
                          placeholder="如：工信部 / PMI"
                        />
                      </FieldRow>
                      <FieldRow label="获得月份">
                        <DatePicker.MonthPicker
                          format={MONTH_FORMAT}
                          value={toDate(item.issue_date)}
                          onChange={(_dateString, date) =>
                            update({ ...item, issue_date: formatMonth(date) })
                          }
                          placeholder="请选择获得月份"
                          allowClear
                          style={{ width: '100%' }}
                        />
                      </FieldRow>
                      <FieldRow label="有效期至">
                        <DatePicker.MonthPicker
                          format={MONTH_FORMAT}
                          value={toDate(item.expire_date)}
                          onChange={(_dateString, date) =>
                            update({ ...item, expire_date: formatMonth(date) })
                          }
                          placeholder="请选择有效期至；长期有效可不填"
                          allowClear
                          style={{ width: '100%' }}
                        />
                      </FieldRow>
                      <FieldRow label="备注" span={2}>
                        <Input.TextArea
                          value={item.description}
                          onChange={(v) => update({ ...item, description: v })}
                          placeholder="证书编号、考试方向等补充"
                          allowClear
                          autoSize={{ minRows: 2, maxRows: 4 }}
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
                {skillItemCount > 0 && (
                  <Tag color="arcoblue" size="small" style={{ marginLeft: 6 }}>
                    {skillItemCount}
                  </Tag>
                )}
              </span>
            }
          >
            <div style={{ marginTop: 12 }}>
              <FieldRow label="专业技能" required>
                <Input.TextArea
                  value={skillText}
                  onChange={setSkillText}
                  placeholder={'每行填写一个专业技能，例如：' + '\n' + 'Python / 熟练使用 3 年' + '\n' + 'React / 熟悉 Hooks 与状态管理' + '\n' + 'Figma / 可独立完成交互原型'}
                  autoSize={{ minRows: 6, maxRows: 14 }}
                  maxLength={2000}
                  showWordLimit
                />
              </FieldRow>
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: 'var(--text-subtle)',
                }}
              >
                <IconInfoCircle style={{ fontSize: 13 }} />
                <span>
                  共 {skillItemCount} 项技能，保存后按换行自动拆分为多条记录；如需调整顺序请重新整理行序。
                </span>
              </div>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Modal>
      <Modal
        title="意见反馈"
        visible={feedbackVisible}
        onCancel={() => {
          setFeedbackVisible(false)
          setFeedbackFile(null)
          setFeedbackDesc('')
        }}
        onOk={submitFeedback}
        confirmLoading={submittingFeedback}
        okText="提交"
        cancelText="取消"
        unmountOnExit
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
          <Typography.Text type="secondary">
            遇到问题或Bug？请详细描述问题并上传截图，我们会尽快修复。
          </Typography.Text>
          <Form.Item label="问题类型">
            <Select
              value={feedbackCategory}
              onChange={setFeedbackCategory}
              style={{ width: '100%' }}
            >
              <Select.Option value="bug">Bug反馈</Select.Option>
              <Select.Option value="feature">功能建议</Select.Option>
              <Select.Option value="other">其他</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="问题描述" required>
            <Input.TextArea
              value={feedbackDesc}
              onChange={setFeedbackDesc}
              placeholder="请详细描述遇到的问题..."
              maxLength={1000}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item label="截图（可选）">
            <Upload
              accept="image/*"
              limit={1}
              autoUpload={false}
              onChange={(files) => setFeedbackFile(files[0]?.originFile || null)}
              tip="支持 PNG / JPG，单张不超过 10MB"
            />
          </Form.Item>
        </div>
      </Modal>
    </div>
  )
}
