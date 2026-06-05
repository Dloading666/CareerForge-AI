import re

path = "frontend/src/student/ProfilePage.tsx"
with open(path, "r", encoding="utf-8") as f:
    c = f.read()

# 1. Add IconFile to imports (IconFile is already imported?)
# Check if IconFile is in imports
if "IconFile" not in c.split("import {")[1].split("}")[0]:
    c = c.replace(
        "IconCalendar, IconCamera, IconEdit, IconUser, IconSafe, IconInfoCircle, IconRight, IconPhone, IconHome, IconBook",
        "IconCalendar, IconCamera, IconEdit, IconUser, IconSafe, IconInfoCircle, IconRight, IconPhone, IconHome, IconBook, IconFile, IconImage, IconEye"
    )

# 2. Add state for resume view and attachments
c = c.replace(
    "const [calendarView, setCalendarView] = useState(false)",
    "const [calendarView, setCalendarView] = useState(false)\n  const [resumeView, setResumeView] = useState(false)\n  const [attachments, setAttachments] = useState<any[]>([])\n  const [previewUrl, setPreviewUrl] = useState<string | null>(null)"
)

# 3. Add fetchAttachments function after fetchProfile
fetch_attach = '''
  const fetchAttachments = async () => {
    try {
      const res = await apiRequest<any[]>('/api/v1/student/attachments')
      setAttachments(res)
    } catch {}
  }
'''
c = c.replace(
    "useEffect(() => { fetchProfile() }, [])",
    "useEffect(() => { fetchProfile(); fetchAttachments() }, [])"
)
# Insert the function before useEffect
c = c.replace("useEffect(() => { fetchProfile(); fetchAttachments() }, [])", fetch_attach + "\n  useEffect(() => { fetchProfile(); fetchAttachments() }, [])")

# 4. Add resume view handler after calendarView
c = c.replace(
    "if (calendarView) return <CalendarPage onBack={() => setCalendarView(false)} />",
    "if (calendarView) return <CalendarPage onBack={() => setCalendarView(false)} />\n  if (resumeView) return <ResumeGallery attachments={attachments} previewUrl={previewUrl} setPreviewUrl={setPreviewUrl} onBack={() => setResumeView(false)} fetchAttachments={fetchAttachments} />"
)

# 5. Add ResumeGallery component before MenuCard
resume_gallery = '''
function ResumeGallery({ attachments, previewUrl, setPreviewUrl, onBack, fetchAttachments }: {
  attachments: any[]; previewUrl: string | null; setPreviewUrl: (u: string | null) => void;
  onBack: () => void; fetchAttachments: () => void
}) {
  const imageExts = ['.png','.jpg','.jpeg','.gif','.webp','.bmp']
  const isImage = (ext: string) => imageExts.includes(ext.toLowerCase())
  const fileIcon = (ext: string) => {
    if (isImage(ext)) return <IconImage style={{fontSize:32,color:'#165dff'}}/>
    if (ext === '.pdf') return <span style={{fontSize:32,color:'#f53f3f',fontWeight:700}}>PDF</span>
    if (ext === '.doc'||ext === '.docx') return <span style={{fontSize:28,color:'#165dff',fontWeight:700}}>DOC</span>
    return <IconFile style={{fontSize:32,color:'#86909c'}}/>
  }
  return (
    <div style={{ width: '100%', padding: '0 28px 40px', overflowY:'auto', maxHeight:'calc(100vh - 120px)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'20px 0 16px' }}>
        <Button type="text" icon={<IconArrowLeft/>} onClick={onBack} style={{padding:0}}/>
        <Typography.Title heading={4} style={{margin:0}}>我的简历</Typography.Title>
        <Button size="small" onClick={fetchAttachments}>刷新</Button>
      </div>
      {attachments.length === 0 ? (
        <Typography.Text type="secondary" style={{fontSize:13}}>暂无提交的简历，在智能体对话中上传文件后可在此查看</Typography.Text>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:16}}>
          {attachments.map((att: any) => (
            <div key={att.id} style={{background:'#fff',borderRadius:12,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)',cursor:'pointer',transition:'transform 0.15s'}}
              onMouseEnter={(e:any)=>{e.currentTarget.style.transform='translateY(-2px)'}}
              onMouseLeave={(e:any)=>{e.currentTarget.style.transform='translateY(0)'}}
              onClick={() => {
                const url = '/data/agent_uploads/' + att.stored_path.split('agent_uploads/').pop()
                if (isImage(att.file_ext)) setPreviewUrl(url)
                else window.open(url, '_blank')
              }}>
              <div style={{height:140,display:'flex',alignItems:'center',justifyContent:'center',background:'#f7f8fa',borderBottom:'1px solid #f0f0f0'}}>
                {isImage(att.file_ext) ? (
                  <img src={'/data/agent_uploads/' + att.stored_path.split('agent_uploads/').pop()} alt={att.original_name}
                    style={{width:'100%',height:'100%',objectFit:'cover'}} />
                ) : fileIcon(att.file_ext)}
              </div>
              <div style={{padding:'10px 12px'}}>
                <div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{att.original_name}</div>
                <div style={{fontSize:11,color:'var(--text-subtle)',marginTop:2}}>
                  {att.file_ext?.toUpperCase()} · {(att.file_size/1024).toFixed(0)}KB · {att.created_at?.split('T')[0]}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {previewUrl && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={() => setPreviewUrl(null)}>
          <img src={previewUrl} alt="preview" style={{maxWidth:'90vw',maxHeight:'90vh',objectFit:'contain',borderRadius:8}} />
        </div>
      )}
    </div>
  )
}

'''
# Insert before function MenuCard
c = c.replace("function MenuCard({ icon, label, desc, onClick, accentColor }:", resume_gallery + "function MenuCard({ icon, label, desc, onClick, accentColor }:")

# 6. Add "我的简历" MenuCard after "日程管理"
resume_card = '''
        <MenuCard icon={<IconFile style={{fontSize:26,color:'#f53f3f'}}/>} label="我的简历"
          desc={"共 " + attachments.length + " 份上传文件"} accentColor="#f53f3f" onClick={() => { fetchAttachments(); setResumeView(true) }}/>
'''
c = c.replace(
    '''desc="查看和管理日程安排" accentColor="#722ed1" onClick={() => setCalendarView(true)}/>''',
    '''desc="查看和管理日程安排" accentColor="#722ed1" onClick={() => setCalendarView(true)}/>''' + "\n" + resume_card
)

with open(path, "w", encoding="utf-8") as f:
    f.write(c)
print("Done")
