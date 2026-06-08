filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Fix the broken structure - the title div was removed but its closing tag was left behind
# Old: <div style={{ padding: '24px 28px'... }}>\n      </div>\n\n      <div style={{ display: 'grid'...
old = """    <div style={{ padding: '24px 28px', background: '#F8F9FB', minHeight: '100%' }}>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>"""

# New: remove the orphaned closing div
new = """    <div style={{ padding: '24px 28px', background: '#F8F9FB', minHeight: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>"""

content = content.replace(old, new)

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Structure fixed")
