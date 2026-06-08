filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Remove the title block (the div with Title and Text)
old = """      <div style={{ marginBottom: 20 }}>
        <Title heading={4} style={{ margin: 0, fontWeight: 700, color: '#1E1B4B' }}>智能体管理</Title>
        <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 4, display: 'block' }}>创建和管理智能体，支持内置模型与 Dify 平台接入</Text>

"""

# Replace with nothing (the AdminHomePage already has the header)
content = content.replace(old, "")

# Also remove unused imports if any
# Check if Title and Text are used elsewhere in this file
if "Title" not in content and "<Title" not in content:
    # Remove Title from destructured import
    content = content.replace("const { Text, Title } = Typography", "const { Text } = Typography")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Title removed")
