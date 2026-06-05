content = """import { Button, Message, Popconfirm, Typography } from '@arco-design/web-react'
import { IconArrowLeft, IconFile, IconDownload, IconDelete, IconUpload } from '@arco-design/web-react/icon'
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../shared/api'

type Attachment = {
  id: number; original_name: string; content_type: string; file_ext: string
  file_size: number; stored_path: string; status: string; created_at: string
}

function getUrl(storedPath: string) {
  const idx = storedPath.indexOf('agent_uploads/')
  return '/data/' + (idx >= 0 ? storedPath.slice(idx) : storedPath.split('/').pop())
}

export function ResumeGallery({ onBack }: { onBack?: () => void }) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchAttachments = async () => {
    setLoading(true)
    try {
      const res = await apiRequest<Attachment[]>('/api/v1/student/attachments')
      setAttachments(res)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { fetchAttachments() }, [])

  const pdfFiles = attachments.filter(a => a.file_ext === 'pdf')

  const handleDownload = (att: Attachment) => {
    const a = document.createElement('a')
    a.href = getUrl(att.stored_path)
    a.download = att.original_name
    a.click()
  }

  const handleDelete = async (id: number) => {
    try {
      await apiRequest('/api/v1/student/attachments/' + id, { method: 'DELETE' })
      Message.success('已删除')
      fetchAttachments()
    } catch { Message.error('删除失败') }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      Message.error('只支持 PDF 格式')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      Message.error('文件不能超过 20MB')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await apiRequest('/api/v1/student/attachments/upload', { method: 'POST', body: fd })
      Message.success('上传成功')
      fetchAttachments()
    } catch { Message.error('上传失败') } finally { setUploading(false) }
    e.target.value = ''
  }

  return (
    <div style={{ width: '100%', padding: '0 28px 40px', overflowY:'auto', maxHeight:'calc(100vh - 120px)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'20px 0 16px' }}>
        {onBack && <Button type="text" icon={<IconArrowLeft/>} onClick={onBack} style={{padding:0}}/>}
        <Typography.Title heading={4} style={{margin:0}}>我的简历</Typography.Title>
        <div style={{flex:1}}/>
        <Button size="small" onClick={fetchAttachments} loading={loading}>刷新</Button>
        <Button type="primary" size="small" icon={<IconUpload/>} loading={uploading}
          onClick={() => fileRef.current?.click()}>
          上传简历
        </Button>
        <input ref={fileRef} type="file" accept=".pdf" hidden onChange={handleUpload}/>
      </div>
      {pdfFiles.length === 0 ? (
        <div style={{textAlign:'center',padding:'60px 0'}}>
          <IconFile style={{fontSize:48,color:'#c9cdd4'}}/>
          <Typography.Paragraph style={{color:'var(--text-subtle)',marginTop:12}}>
            暂无简历<br/>点击「上传简历」添加 PDF 文件
          </Typography.Paragraph>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {pdfFiles.map(att => (
            <div key={att.id} style={{
              display:'flex',alignItems:'center',padding:'16px 20px',
              background:'#fff',borderRadius:12,
              boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
              transition:'transform 0.15s',
            }}>
              <div style={{
                width:48,height:48,borderRadius:10,background:'#fff1f0',
                display:'flex',alignItems:'center',justifyContent:'center',
                marginRight:16,flexShrink:0
              }}>
                <span style={{fontSize:20,color:'#f53f3f',fontWeight:700}}>PDF</span>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {att.original_name}
                </div>
                <div style={{fontSize:12,color:'var(--text-subtle)',marginTop:2}}>
                  {(att.file_size/1024).toFixed(0)}KB · {att.created_at?.split('T')[0]}
                </div>
              </div>
              <Button type="text" size="small" icon={<IconDownload/>} onClick={() => handleDownload(att)}>
                下载
              </Button>
              <Popconfirm title="确定删除该简历？" onOk={() => handleDelete(att.id)}>
                <Button type="text" size="small" icon={<IconDelete/>} style={{color:'#f53f3f'}}>
                  删除
                </Button>
              </Popconfirm>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
"""
path = "frontend/src/student/ResumeGallery.tsx"
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Updated")
