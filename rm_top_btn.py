filepath = r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AdminHomePage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Remove the top button and its condition
old = """            {activeNav !== 'master' && activeNav !== 'models' && (
              <Button icon={<IconPlus />} type="primary" onClick={() => openDrawer()} style={{ background: "linear-gradient(135deg, #165dff, #2c73ff)", border: "none", borderRadius: 8, boxShadow: "0 4px 14px rgba(22,93,255,0.3)", fontWeight: 500, padding: "0 20px" }}>
                {meta.action}
              </Button>
            )}"""

# Replace with nothing
content = content.replace(old, "")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)

print("Top button removed")
