filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Restore Title import
content = content.replace("const { Text } = Typography", "const { Text, Title } = Typography")

# Restore IconPlus import
content = content.replace("import { IconDelete, IconEdit, IconSend }", "import { IconDelete, IconEdit, IconPlus, IconSend }")

# Add the create button back after the stats grid div (before the filter bar)
# Find the stats grid closing div and the filter bar
old = """      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>"""

new = """      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title heading={5} style={{ margin: 0, color: '#1F2937' }}>智能体列表</Title>
        <Button type='primary' icon={<IconPlus />} size='small'
          onClick={() => { setEdit(null); form.resetFields(); setUseDify(false); setMsgs([]); setTab('basic'); setDrawer(true) }}
          style={{ fontWeight: 500, borderRadius: 6 }}>
          新建智能体
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>"""

content = content.replace(old, new)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Button restored")
