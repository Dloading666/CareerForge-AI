import { Button, DatePicker, Form, Input, Message, Modal, Popconfirm, TimePicker, Typography } from '@arco-design/web-react'
import { IconLeft, IconRight, IconArrowLeft } from '@arco-design/web-react/icon'
import { useEffect, useState } from 'react'
import { apiRequest } from '../shared/api'

type Event = { id: number; title: string; description: string | null; event_date: string; event_time: string | null; color: string; created_at: string }

function ColorPicker({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return (
    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
      {COLORS.map(c => (
        <div key={c.value} onClick={() => onChange?.(c.value)} style={{cursor:'pointer',padding:'6px 12px',borderRadius:6,border: value===c.value ? `2px solid ${c.value}` : '2px solid transparent',background: c.value+'15',display:'flex',alignItems:'center',gap:6,transition:'border 0.15s'}}>
          <span style={{width:14,height:14,borderRadius:4,background:c.value,display:'inline-block'}}/>
          <span style={{fontSize:13,color:'#1d2129'}}>{c.label}</span>
        </div>
      ))}
    </div>
  )
}

const WEEKDAYS = ['一','二','三','四','五','六','日']
const COLORS = [{label:'蓝色',value:'#165dff'},{label:'绿色',value:'#00b42a'},{label:'橙色',value:'#ff7d00'},{label:'红色',value:'#f53f3f'},{label:'紫色',value:'#722ed1'}]

export function CalendarPage({ onBack }: { onBack?: () => void }) {
  const [events, setEvents] = useState<Event[]>([])
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingEvent, setEditingEvent] = useState<Event | null>(null)
  const [filterDate, setFilterDate] = useState<string | null>(null)
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  useEffect(() => {
    let cancelled = false
    apiRequest<Event[]>('/api/v1/student/events')
      .then((res) => { if (!cancelled) setEvents(res) })
      .catch((e) => { if (!cancelled) console.error(e) })
    return () => { cancelled = true }
  }, [year, month])

  const prevMonth = () => setCurrentDate(new Date(year, month - 1))
  const nextMonth = () => setCurrentDate(new Date(year, month + 1))
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = firstDay === 0 ? 6 : firstDay - 1

  const dateStr = (d: number) => year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
  const dayEvents = (d: number) => events.filter(e => e.event_date === dateStr(d))
  const displayEvents = filterDate
    ? events.filter(e => e.event_date === filterDate)
    : events.filter(e => e.event_date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))

  const openCreate = (d: number) => { setSelectedDate(new Date(year, month, d)); setEditingEvent(null); form.resetFields(); form.setFieldsValue({ event_date: dateStr(d), color: COLORS[0].value }); setModalVisible(true) }
  const openEdit = (evt: Event) => { setEditingEvent(evt); form.setFieldsValue({title:evt.title,description:evt.description??'',color:evt.color,event_date:evt.event_date,event_time:evt.event_time??''}); setModalVisible(true) }

  const handleSave = async () => {
    try {
      const values = await form.validate(); setLoading(true)
      const eventDate = values.event_date || (selectedDate ? dateStr(selectedDate.getDate()) : '')
      const body = { title: values.title, description: values.description || null, color: values.color || '#165dff',
        event_date: String(eventDate).slice(0, 10),
        event_time: values.event_time ? String(values.event_time).slice(0, 5) : null }
      if (editingEvent) {
        await apiRequest('/api/v1/student/events/' + editingEvent.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        Message.success('已更新')
      } else {
        await apiRequest('/api/v1/student/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        Message.success('已添加')
      }
      setModalVisible(false)
      apiRequest<Event[]>('/api/v1/student/events').then(setEvents).catch(() => {})
    } catch { Message.error('操作失败') } finally { setLoading(false) }
  }

  const handleDelete = async (id: number) => {
    try {
      await apiRequest('/api/v1/student/events/' + id, { method: 'DELETE' })
      Message.success('已删除')
      apiRequest<Event[]>('/api/v1/student/events').then(setEvents).catch(() => {})
    }
    catch { Message.error('删除失败') }
  }

  return (
    <div style={{ width: '100%', padding: '0 28px 40px', overflowY: 'auto', maxHeight: 'calc(100vh - 120px)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 48px 16px 0' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {onBack && <Button type="text" icon={<IconArrowLeft/>} onClick={onBack} style={{padding:0}}/>}
          <Typography.Title heading={5} style={{margin:0}}>日程管理</Typography.Title>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Button size="small" icon={<IconLeft/>} onClick={prevMonth}/>
          <Typography.Text style={{fontWeight:600,minWidth:60,textAlign:'center',fontSize:14}}>{year}年{month+1}月</Typography.Text>
          <Button size="small" icon={<IconRight/>} onClick={nextMonth}/>
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:14,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:'1px solid #f0f0f0'}}>
          {WEEKDAYS.map(w => <div key={w} style={{padding:'10px 0',textAlign:'center',fontSize:12,fontWeight:600,color:'var(--text-subtle)'}}>{w}</div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
          {Array.from({length:offset}).map((_,i) => <div key={'e'+i} style={{padding:2,minHeight:60}}/>)}
          {Array.from({length:daysInMonth}).map((_,i) => {
            const d=i+1; const evts=dayEvents(d); const today=new Date()
            const isToday=year===today.getFullYear()&&month===today.getMonth()&&d===today.getDate()
            return (
              <div key={d} onClick={()=>openCreate(d)} style={{padding:2,cursor:'pointer',minHeight:60,borderBottom:'1px solid #fafafa',borderRight:'1px solid #fafafa',transition:'background 0.15s'}}
                onMouseEnter={(e)=>{e.currentTarget.style.background='#f5f7ff'}} onMouseLeave={(e)=>{e.currentTarget.style.background='transparent'}}>
                <div style={{width:20,height:20,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:isToday?700:400,background:isToday?'#165dff':'transparent',color:isToday?'#fff':'var(--text-main)'}}>{d}</div>
                <div style={{display:'flex',flexDirection:'column',gap:1,marginTop:2}}>
                  {evts.slice(0,2).map(evt => (
                    <div key={evt.id} onClick={(e)=>{e.stopPropagation();openEdit(evt)}} style={{fontSize:10,padding:'1px 4px',borderRadius:3,background:evt.color+'18',color:evt.color,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:500}}>{evt.title}</div>
                  ))}
                  {evts.length>2 && <span style={{fontSize:12,color:'var(--text-subtle)',cursor:'pointer',textDecoration:'underline'}} onClick={(e)=>{e.stopPropagation();setFilterDate(dateStr(d))}}>...共{evts.length}个</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:20}}>
        <Typography.Title heading={5} style={{margin:0}}>{filterDate ? filterDate + ' 的日程' : '本月日程'}</Typography.Title>
        {filterDate && <Button size="small" onClick={()=>setFilterDate(null)}>显示全部</Button>}
      </div>
      {displayEvents.length===0 ? (
        <Typography.Text type="secondary" style={{fontSize:13}}>暂无日程，点击日历格子添加</Typography.Text>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:300,overflowY:'auto',paddingRight:4}}>
          {displayEvents.map(evt => (
            <div key={evt.id} onClick={()=>openEdit(evt)} style={{display:'flex',alignItems:'center',padding:'12px 16px',background:'#fff',borderRadius:10,boxShadow:'0 1px 3px rgba(0,0,0,0.04)',cursor:'pointer',borderLeft:'3px solid '+evt.color}}>
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:600}}>{evt.title}</div>
                <div style={{fontSize:13,color:'var(--text-subtle)',marginTop:3}}>{evt.event_date}{evt.event_time?' '+evt.event_time:''}{evt.description?' · '+evt.description:''}</div>
              </div>
              <Popconfirm title="确定删除？" onOk={()=>handleDelete(evt.id)}>
                <Button type="text" size="mini" style={{color:'#f53f3f'}} onClick={(e)=>e.stopPropagation()}>删除</Button>
              </Popconfirm>
            </div>
          ))}
        </div>
      )}

      <Modal title={editingEvent?'编辑日程':'添加日程'} visible={modalVisible} onCancel={()=>setModalVisible(false)} onOk={handleSave} confirmLoading={loading} okText="保存" cancelText="取消" unmountOnExit>
        <Form form={form} layout="vertical" style={{marginTop:16}}>
          <Form.Item label="标题" field="title" rules={[{required:true,message:'请输入标题'}]}><Input placeholder="如：面试、课程、会议"/></Form.Item>
          <Form.Item label="描述" field="description"><Input.TextArea placeholder="备注信息（可选）" autoSize={{minRows:2,maxRows:4}}/></Form.Item>
          <Form.Item label="颜色标记" field="color" rules={[{required:true,message:'请选择颜色'}]}>
            <ColorPicker />
          </Form.Item>
          <Form.Item label="日期" field="event_date" rules={[{required:true,message:'请选择日期'}]}>
            <DatePicker format="YYYY-MM-DD" placeholder="选择日期" />
          </Form.Item>
          <Form.Item label="时间" field="event_time">
            <TimePicker format="HH:mm" placeholder="选择时间（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}