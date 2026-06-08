filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Remove the Button element and its line breaks
old = """        <Button type='primary' icon={<IconPlus />} shape='round' size='large'
          onClick={() => { setEdit(null); form.resetFields(); setUseDify(false); setMsgs([]); setTab('basic'); setDrawer(true) }}
          style={{ fontWeight: 600, borderRadius: 8, height: 40, padding: '0 24px' }}>
          创建智能体
        </Button>
"""

content = content.replace(old, "")

# Also remove the flex container (simplify to just title block)
old_flex = """      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title heading={4} style={{ margin: 0, fontWeight: 700, color: '#1E1B4B' }}>智能体管理</Title>
          <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 0, display: 'block' }}>创建和管理智能体，支持内置模型与 Dify 平台接入</Text>
        </div>
"""

new_flex = """      <div style={{ marginBottom: 20 }}>
        <Title heading={4} style={{ margin: 0, fontWeight: 700, color: '#1E1B4B' }}>智能体管理</Title>
        <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 4, display: 'block' }}>创建和管理智能体，支持内置模型与 Dify 平台接入</Text>

"""

content = content.replace(old_flex, new_flex)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Button removed")
