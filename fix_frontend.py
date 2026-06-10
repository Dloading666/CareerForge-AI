with open(r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

old = """      const r = await apiRequest<{ success: boolean; message: string; diagnostics?: { path: string; status: number; message: string }[]; hint?: string }>("/api/v1/admin/agents/test-dify", {
          method: "POST",
          body: JSON.stringify({ api_base_url: vals.dify_api_base_url, api_key: vals.dify_api_key, app_id: vals.dify_app_id || "" }),
        })
        if (r.success) {
          setDifyTestResult("OK " + r.message)
        } else {
          const diag = r.diagnostics?.map(d => String(d.path) + ": " + d.status + " " + d.message).join(" | ") || ""
          setDifyTestResult("FAIL " + r.message + (diag ? " [" + diag + "]" : ""))
        }"""

new_code = """      const r = await apiRequest<any>("/api/v1/admin/agents/test-dify", {
          method: "POST",
          body: JSON.stringify({ api_base_url: vals.dify_api_base_url, api_key: vals.dify_api_key, app_id: vals.dify_app_id || "" }),
        })
        if (r.success) {
          setDifyTestResult("OK " + r.message)
        } else {
          const att = r.attempts?.map((d: any) => d.path + ":" + d.status + " " + d.message).join(" | ") || ""
          const st = r.steps?.map((s: any) => s.step + "=" + (s.ok ? "OK" : "FAIL") + (s.mode ? "(" + s.mode + ")" : "") + (s.inputs ? " inputs:" + s.inputs.join(",") : "")).join(" ") || ""
          setDifyTestResult("FAIL " + r.message + (st ? " [steps: " + st + "]" : "") + (att ? " [attempts: " + att + "]" : ""))
        }"""

if old in content:
    content = content.replace(old, new_code)
    with open(r"C:\Users\Administrator\Desktop\CareerForge-AI\frontend\src\admin\AgentManagementPage.tsx", "w", encoding="utf-8") as f:
        f.write(content)
    print("OK - frontend updated")
else:
    print("NOT FOUND - searching...")
    for i, line in enumerate(content.split("\n")):
        if "test-dify" in line:
            print(f"  Line {i+1}: {line.strip()[:120]}")
