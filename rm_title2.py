filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Remove Title from Typography destructure
content = content.replace("const { Text, Title } = Typography", "const { Text } = Typography")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Title import removed")
