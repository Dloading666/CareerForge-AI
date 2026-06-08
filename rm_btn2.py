filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Remove IconPlus from import
content = content.replace("import { IconDelete, IconEdit, IconPlus, IconSend }", "import { IconDelete, IconEdit, IconSend }")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("IconPlus removed from import")
