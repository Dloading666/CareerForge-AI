content = """import { Button, Message, Popconfirm, Typography } from '@arco-design/web-react'
import { IconArrowLeft, IconDownload, IconDelete, IconUpload, IconFile } from '@arco-design/web-react/icon'
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
  const [dragOver, setDragOver] = useState(false)
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

  const doUpload = async (file: File) => {
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
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    doUpload(file)
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) doUpload(file)
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
        <input ref={fileRef} type="file" accept=".pdf" hidden onChange={handleFileSelect}/>
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#165dff' : '#e5e6eb'}`,
          borderRadius: 14,
          padding: '32px 24px',
          textAlign: 'center',
          background: dragOver ? '#f0f5ff' : '#fafbfc',
          transition: 'all 0.2s',
          cursor: 'pointer',
          marginBottom: 20,
        }}>
        {uploading ? (
          <div style={{color:'#165dff'}}>上传中...</div>
        ) : (
          <>
            <IconUpload style={{fontSize:36,color:dragOver?'#165dff':'#c9cdd4'}}/>
            <div style={{marginTop:8,fontSize:14,color:'var(--text-subtle)'}}>
              拖拽 PDF 文件到此处，或点击选择
            </div>
            <div style={{fontSize:12,color:'#c9cdd4',marginTop:4}}>
              仅支持 PDF 格式，最大 20MB
            </div>
          </>
        )}
      </div>

      {pdfFiles.length === 0 ? (
        <div style={{textAlign:'center',padding:'40px 0',color:'var(--text-subtle)'}}>
          暂无简历，上传后在此显示
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))',gap:16}}>
          {pdfFiles.map(att => (
            <div key={att.id} style={{
              background:'#fff',borderRadius:12,overflow:'hidden',
              boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
              transition:'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => {e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)'}}
              onMouseLeave={e => {e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)'}}>
              <div style={{
                height:200,display:'flex',flexDirection:'column',
                alignItems:'center',justifyContent:'center',
                background:'linear-gradient(135deg, #fff1f0 0%, #ffe7e5 100%)',
                cursor:'pointer',
              }} onClick={() => handleDownload(att)}>
                <IconFile style={{fontSize:56,color:'#f53f3f',opacity:0.8}}/>
                <div style={{
                  marginTop:12,background:'#f53f3f',color:'#fff',
                  padding:'4px 14px',borderRadius:20,
                  fontSize:12,fontWeight:600,
                }}>PDF 简历</div>
              </div>
              <div style={{padding:'14px 16px'}}>
                <div style={{
                  fontSize:14,fontWeight:600,overflow:'hidden',
                  textOverflow:'ellipsis',whiteSpace:'nowrap',
                  marginBottom:6,
                }}>
                  {att.original_name}
                </div>
                <div style={{fontSize:12,color:'var(--text-subtle)',marginBottom:10}}>
                  {(att.file_size/1024).toFixed(0)}KB · {att.created_at?.split('T')[0]}
                </div>
                <div style={{display:'flex',gap:8}}>
                  <Button type="outline" size="small" icon={<IconDownload/>}
                    style={{flex:1}} onClick={() => handleDownload(att)}>
                    下载
                  </Button>
                  <Popconfirm title="确定删除？" onOk={() => handleDelete(att.id)}>
                    <Button type="outline" size="small" icon={<IconDelete/>}
                      style={{color:'#f53f3f',borderColor:'#f53f3f'}}/>
                  </Popconfirm>
                </div>
              </div>
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
