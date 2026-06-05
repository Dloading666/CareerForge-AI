import { Form, Input, InputNumber, Message, Modal, Radio, Typography } from '@arco-design/web-react'
import { IconCalendar, IconCamera, IconEdit, IconUser, IconSafe, IconInfoCircle, IconRight, IconPhone, IconHome, IconBook } from '@arco-design/web-react/icon'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../shared/auth'
import { apiRequest } from '../shared/api'
import { CalendarPage } from './CalendarPage'

type Profile = {
  id: number; account: string; email: string; name: string | null
  gender: string | null; age: number | null; college: string | null
  major: string | null; grade: string | null; phone: string | null
  avatar_url: string | null; banner_url: string | null; signature: string | null
  email_verified_at: string | null; created_at: string | null
}

const genderLabel: Record<string, string> = { male: '男', female: '女', other: '其他' }

function MenuCard({ icon, label, desc, onClick, accentColor }: {
  icon: React.ReactNode; label: string; desc: string; onClick?: () => void; accentColor: string
}) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', padding: '20px 28px',
      background: '#fff', borderRadius: 16, cursor: onClick ? 'pointer' : 'default',
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)', transition: 'all 0.2s ease',
      border: '1px solid transparent',
    }}
      onMouseEnter={(e) => { if (!onClick) return; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.06)'; e.currentTarget.style.borderColor = accentColor + '20'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={(e) => { if (!onClick) return; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'translateY(0)' }}
    >
      <div style={{ width: 52, height: 52, borderRadius: 14, background: accentColor + '12', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 20, flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-main)', lineHeight: '24px' }}>{label}</div>
        <div style={{ fontSize: 14, color: 'var(--text-subtle)', marginTop: 3, lineHeight: '20px' }}>{desc}</div>
      </div>
      {onClick && <IconRight style={{ fontSize: 18, color: '#c9cdd4' }} />}
    </div>
  )
}

export function ProfilePage({ onAvatarChange }: { onAvatarChange?: (url: string) => void }) {
  const { session } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [calendarView, setCalendarView] = useState(false)
  const [editVisible, setEditVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  const fetchProfile = async () => {
    try {
      const res = await apiRequest<Profile>('/api/v1/student/profile', { headers: { Authorization: `Bearer ${session?.access}` } })
      setProfile(res)
    } catch { Message.error('加载失败') } finally { setLoading(false) }
  }

  useEffect(() => { fetchProfile() }, [])

  const openEdit = () => {
    form.setFieldsValue({ name: profile?.name ?? '', gender: profile?.gender ?? undefined, age: profile?.age ?? undefined, college: profile?.college ?? '', major: profile?.major ?? '', grade: profile?.grade ?? '', phone: profile?.phone ?? '', signature: profile?.signature ?? '' })
    setEditVisible(true)
  }

  const handleSave = async () => {
    try { const values = await form.validate(); setSaving(true)
      await apiRequest('/api/v1/student/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access}` }, body: JSON.stringify(values) })
      Message.success('保存成功'); setEditVisible(false); fetchProfile()
    } catch { Message.error('保存失败') } finally { setSaving(false) }
  }

  const uploadFile = async (file: File, endpoint: string, onSuccess: (url: string) => void, fn: (v: boolean) => void) => {
    if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type)) { Message.error('仅支持 JPG、PNG、GIF、WebP'); return }
    const fd = new FormData(); fd.append('file', file)
    try { fn(true); const res = await apiRequest<{avatar_url?:string;banner_url?:string}>(endpoint, { method:'POST', headers:{Authorization:`Bearer ${session?.access}`}, body:fd }); const url=res.avatar_url||res.banner_url; if(url) onSuccess(url); Message.success('更新成功') }
    catch { Message.error('上传失败') } finally { fn(false) }
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 2*1024*1024) { Message.error('文件不能超过 2MB'); return }
    uploadFile(file, '/api/v1/student/profile/avatar', (url) => { setProfile(p => p ? {...p, avatar_url:url} : p); onAvatarChange?.(url) }, setUploading)
    e.target.value = ''
  }

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    if (file.size > 5*1024*1024) { Message.error('文件不能超过 5MB'); return }
    uploadFile(file, '/api/v1/student/profile/banner', (url) => { setProfile(p => p ? {...p, banner_url:url} : p) }, setUploadingBanner)
    e.target.value = ''
  }

  if (loading) return <div style={{display:'flex',justifyContent:'center',alignItems:'center',minHeight:300,color:'var(--text-subtle)'}}>加载中...</div>
  if (calendarView) return <CalendarPage onBack={() => setCalendarView(false)} />

  const avatarUrl = profile?.avatar_url || ''
  const initials = (profile?.name || profile?.email || '?')[0].toUpperCase()
  const subtitle = [profile?.gender && genderLabel[profile.gender], profile?.age && profile.age+'岁', profile?.college].filter(Boolean).join(' · ') || '完善资料，展示更好的自己'

  return (
    <div style={{ width: '100%', minHeight: '100vh', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, background: profile?.banner_url ? `url(${profile.banner_url}) center/cover no-repeat` : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', zIndex: 0 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 40%, rgba(255,255,255,0.95) 70%, #fff 100%)', zIndex: 1 }} />
      <div style={{ position: 'relative', zIndex: 2, padding: '0 28px 40px' }} >
      <div style={{ margin: '20px -28px 24px', padding: '40px 36px 32px', borderRadius: 0, position: 'relative', overflow: 'hidden' }}>
        {!profile?.banner_url && (<><div style={{position:'absolute',top:-50,right:-30,width:180,height:180,borderRadius:'50%',background:'rgba(255,255,255,0.06)'}}/><div style={{position:'absolute',bottom:-40,left:'40%',width:120,height:120,borderRadius:'50%',background:'rgba(255,255,255,0.04)'}}/></>)}
        <div onClick={() => bannerInputRef.current?.click()} style={{ position:'absolute',top:14,right:14,display:'flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:8,background:'rgba(0,0,0,0.25)',color:'#fff',fontSize:13,cursor:'pointer',backdropFilter:'blur(4px)',transition:'background 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)' }} onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.25)' }}>
          <IconEdit style={{fontSize:14}}/>{uploadingBanner ? '上传中...' : profile?.banner_url ? '更换封面' : '自定义封面'}
        </div>
        <input ref={bannerInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:'none'}} onChange={handleBannerChange}/>
        <div style={{position:'relative',display:'flex',alignItems:'center',gap:24}}>
          <div style={{position:'relative',cursor:'pointer',flexShrink:0}} onClick={() => fileInputRef.current?.click()}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" style={{width:100,height:100,borderRadius:'50%',objectFit:'cover',border:'3px solid rgba(255,255,255,0.4)',boxShadow:'0 4px 24px rgba(0,0,0,0.15)'}}/>
            ) : (
              <div style={{width:100,height:100,borderRadius:'50%',background:'rgba(255,255,255,0.2)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:38,fontWeight:700,border:'3px solid rgba(255,255,255,0.4)',boxShadow:'0 4px 24px rgba(0,0,0,0.15)'}}>{initials}</div>
            )}
            <div style={{position:'absolute',bottom:3,right:3,width:30,height:30,borderRadius:'50%',background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,0,0,0.15)'}}>
              <IconCamera style={{fontSize:15,color:'#165dff'}}/>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{display:'none'}} onChange={handleAvatarChange}/>
          <div style={{flex:1,minWidth:0}}>
            <Typography.Title heading={3} style={{margin:'0 0 8px',color:'#fff',fontSize:24,letterSpacing:'0.5px'}}>
              {profile?.name || '未设置姓名'}
              {uploading && <span style={{fontSize:13,opacity:0.7,marginLeft:8,fontWeight:400}}>上传中...</span>}
            </Typography.Title>
            <Typography.Paragraph style={{margin:'0 0 4px',color:'rgba(255,255,255,0.85)',fontSize:15,fontStyle:profile?.signature?'normal':'italic'}}>
              {profile?.signature || '设置一句个性签名吧'}
            </Typography.Paragraph>
            <Typography.Text style={{fontSize:14,color:'rgba(255,255,255,0.6)'}}>{subtitle}</Typography.Text>
          </div>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        <MenuCard icon={<IconUser style={{fontSize:26,color:'#165dff'}}/>} label="个人信息"
          desc={[profile?.name,profile?.gender&&genderLabel[profile.gender],profile?.age&&profile.age+'岁',profile?.college].filter(Boolean).join(' · ')||'完善你的个人信息'} accentColor="#165dff" onClick={openEdit}/>
        <MenuCard icon={<IconCalendar style={{fontSize:26,color:'#722ed1'}}/>} label="日程管理"
          desc="查看和管理日程安排" accentColor="#722ed1" onClick={() => setCalendarView(true)}/>
        <MenuCard icon={<IconSafe style={{fontSize:26,color:'#00b42a'}}/>} label="账号安全"
          desc={profile?.email_verified_at?'邮箱已认证':'邮箱未认证'} accentColor="#00b42a"/>
        <MenuCard icon={<IconInfoCircle style={{fontSize:26,color:'#ff7d00'}}/>} label="关于智培职联"
          desc={'注册于 '+(profile?.created_at?new Date(profile.created_at).toLocaleDateString('zh-CN'):'-')} accentColor="#ff7d00"/>
      </div>

      <Modal title="编辑个人信息" visible={editVisible} onCancel={()=>setEditVisible(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" unmountOnExit>
        <Form form={form} layout="vertical" style={{marginTop:16}}>
          <Form.Item label="姓名" field="name"><Input placeholder="请输入姓名"/></Form.Item>
          <Form.Item label="性别" field="gender"><Radio.Group><Radio value="male">男</Radio><Radio value="female">女</Radio><Radio value="other">其他</Radio></Radio.Group></Form.Item>
          <Form.Item label="年龄" field="age"><InputNumber placeholder="请输入年龄" min={1} max={150} style={{width:'100%'}}/></Form.Item>
          <Form.Item label="个性签名" field="signature"><Input.TextArea placeholder="写一句话介绍自己..." maxLength={200} showWordLimit autoSize={{minRows:2,maxRows:4}}/></Form.Item>
          <Form.Item label="学校" field="college"><Input placeholder="请输入学校名称" prefix={<IconHome/>}/></Form.Item>
          <Form.Item label="专业" field="major"><Input placeholder="请输入专业" prefix={<IconBook/>}/></Form.Item>
          <Form.Item label="年级" field="grade"><Input placeholder="如：2025级"/></Form.Item>
          <Form.Item label="手机号" field="phone"><Input placeholder="请输入手机号" prefix={<IconPhone/>}/></Form.Item>
        </Form>
      </Modal>
      </div>
    </div>
  )
}