# 简历导入 + 优化流程改造 + 新用户引导 改造清单

> 目标：① 简历的唯一入口收敛到简历中心（支持 PDF/DOCX/JSON 导入），对话里不再上传简历 PDF；
> ② 简历优化 = 选择工作简历 + 粘贴 JD，全程不离开对话；
> ③ 新用户进站第一眼就知道「先补档案 → 再备简历 → 然后开聊」。

**全局约定**：同 `doc/agent-improvement-plan.md` 开头（迁移命名、tenant_id 隔离、信封、SSE 三处同步、env 配置、验证方式）。**不要改动 AI 面试官代码**（可以引用其抽取逻辑，不能修改 `/student/interviews/*`）。

---

## 板块 E：简历中心支持导入（PDF / DOCX / JSON）

### E0 技术决策（已定，不要偏离）

PDF 识别 = **文本抽取 + 普通 LLM 结构化输出**：
- 不写规则解析器（版式太杂，维护无底洞）；
- 不默认走多模态（贵、慢、依赖视觉模型）；
- 复用项目已有的文本抽取逻辑；抽取后用管理端「对学生开放」的模型做 JSON 结构化；
- 扫描件（抽取文本 < 200 字）一期直接报错：「PDF 似乎是扫描件，请上传文字版 PDF，或下载 JSON 模板填写后导入」；
- **解析只提取不创作**：prompt 写明「只提取原文信息，禁止补全、润色、编造；缺失字段留空」。

### E1 后端：抽取逻辑抽成共享 util

- 新建 `backend/app/student/file_text.py`，把 PDF/DOCX/TXT/MD → 纯文本的抽取逻辑收进去（参考 `agent_runtime._ensure_attachment_text` 和面试官 `/resume/extract` 的实现，**抽取公共部分，不动面试官端点**）。
- agent 附件路径改为调用该 util（行为不变，纯重构）。

### E2 后端：结构化解析服务

- 新函数 `parse_resume_text_to_data(db, identity, text: str) -> dict`（放 `resume_import_service.py` 或并入 resume_router 的 service 层）：
  - prompt：把简历文本转成简历编辑器的 `data_json` 结构——`basic / education / experience / projects / skills / selfEvaluationContent`，字段定义**直接照抄 `generate_resume_data` 工具的 input_schema**（保证和编辑器/update 工具兼容）；
  - 用 function calling 或 `response_format: json_object` 保证输出是合法 JSON；解析失败重试 1 次，再失败返回明确错误；
  - 模型选择：取管理端对学生开放的模型列表第一个；可加 env `RESUME_PARSE_MODEL_ID` 指定专用解析模型（按约定加 `config.py` + `.env.example`）；
  - 超时 60s。

### E3 后端：导入端点

- `POST /api/v1/student/resumes/import`（resume_router.py），multipart：`file`（必填，.pdf/.docx/.json）+ `title`（可选）。
- 流程：
  1. 校验数量上限（`_MAX_RESUMES = 6`，超了报「请先删除一份简历」）；
  2. 文件大小 ≤ 10MB，扩展名白名单；
  3. **.json 分支**：解析 → pydantic schema 校验（未知字段丢弃、各章节条数/字符长度上限）→ 直接建 `StudentResume`；
  4. **.pdf/.docx 分支**：E1 抽取文本 → 文本 < 200 字 → 报扫描件错误；否则 E2 解析 → 建 `StudentResume`；
  5. title 默认值：传入 title > 解析出的姓名+期望岗位 > 文件名（去扩展名）；template_id 默认 `classic`。
- 返回：`{resume_id, sections_summary: {education: 2, experience: 1, projects: 3, skills: true}}`，统一信封。

### E4 前端：简历中心导入入口

- `ResumeCenterPage.tsx` 在「新建简历」旁加「导入简历」按钮 → Modal：
  - 拖拽/点击选择文件（.pdf/.docx/.json）；
  - 上传中状态：「正在解析简历内容，约需 10-30 秒…」（按钮 loading，禁止重复提交）；
  - 成功 → `navigate(/student/resumes/{id})` 进编辑器，编辑器顶部显示一条可关闭 banner：「以下内容由 AI 从你上传的文件解析而来，请核对无误后保存」（用路由 state 或 query `?imported=1` 传递）；
  - 失败态：扫描件 / 超上限 / 解析失败，各自给明确文案；
  - Modal 内提供「下载 JSON 模板」链接（前端用示例 data_json 结构生成 Blob 下载，不用走后端）。
- 支持 query 参数 `?import=1` 自动打开导入 Modal（板块 F/G 的跳转入口要用）。

---

## 板块 F：简历优化流程改造（对话不再收简历 PDF）

### F1 前端：「简历优化」卡片重做

`AgentChatView.tsx` 的 `startResumeOptimization`：

- **删除** `fileInputRef.current?.click()` 的文件选择逻辑；
- 新逻辑：fetch `/api/v1/student/resumes` →
  - **0 份**：在空状态位置显示引导（或 Arco Modal.confirm）：「你还没有在线简历。先把简历上传到简历中心，AI 就能直接优化它」，确认按钮 → `navigate('/student/resumes?import=1')`；
  - **1 份**：自动绑定为工作简历（调用现有 `handleResumeChange`），输入框预填：「请优化这份简历。目标岗位 JD：\n（在这里粘贴 JD）」，聚焦输入框；
  - **多份**：打开工作区选择器 popover（复用 `ResumeSelector`，需要把「打开」动作提升为可从外部触发——加个 ref 或受控 visible prop），选中后同上预填。
- 卡片文案改为：「**简历优化**：选择一份在线简历 + 粘贴目标岗位 JD，AI 直接优化并保存」。
- composer 的附件上传按钮**保留**（还要传 JD 截图、作品集等），只是不再作为简历入口。

### F2 后端：system prompt 优化流程改写

`_harness_system_prompt`（agent_runtime.py）：

- 「简历优化」流程描述从「上传简历 PDF + JD」改为：「以**工作简历**为源（read_resume 获取全文）+ 用户提供的 JD，调用 optimize_resume_data 生成优化版」；
- 加一条：「用户要求优化但未绑定工作简历时：先调 read_resume 看列表——有简历就引导选择，一份都没有就引导『先到简历中心上传或创建简历』，不要让用户在对话里上传简历文件」；
- `optimize_resume_data` 工具 description 若提及「上传的简历」同步改掉；
- mimo 需验证：optimize 的事实校验以 evidence pool 为准，read_resume 的工作简历全文已进 evidence pool，「以在线简历为源做优化」应天然兼容——跑一遍确认事实闸门不误拦。

### F3 软引导：用户仍往对话里扔简历 PDF 时

- 不禁止附件，但 system prompt 加一条：「用户在对话中上传疑似简历的 PDF/DOCX 时：可以用 analyze_uploaded_file 读取并即时点评，但**不要**基于它调用 optimize/generate 生成新简历；同时告知用户把简历导入简历中心（路径：简历制作 → 导入简历），导入后选为工作简历即可持续优化」。
- （二期可选，先不做：`import_resume_from_attachment` 工具让 AI 直接帮用户把附件导入简历中心——体感最顺，但属写操作需配合确认，等 C2 确认卡机制一起做。）

---

## 板块 G：新用户引导（档案完善 + 首页指引）

### G1 后端：档案完整度接口

- `GET /api/v1/student/profile/completeness`（router.py）：
  ```json
  {
    "score": 60,
    "missing": ["experience_or_project", "skills"],
    "items": {
      "basic": true,          // 姓名已填
      "education": true,      // 教育经历 ≥1
      "experience_or_project": false,  // 工作经历或项目经历 ≥1
      "skills": false,        // 技能 ≥1
      "advantages": true      // 个人优势非空
    },
    "has_resume": false       // StudentResume count > 0
  }
  ```
- 判定逻辑写成独立 service 函数 `compute_profile_completeness(db, identity)`，G3 复用。score = 完成项 / 5 * 100。

### G2 前端：首页三步引导卡

`AgentChatView.tsx` 空状态（resume 分支，「你好，吴少然」那屏）：

- 在两张功能卡**上方**渲染「新手引导卡」，三步 checklist：
  1. **完善个人档案**（`items.basic && education && experience_or_project && skills` 全真则 ✅）→ 按钮「去完善」：打开个人中心 Modal 的 profile tab——`StudentHomePage` 把 `setProfileModalVisible/setProfileTab` 包成回调 prop（如 `onOpenProfile`）传给 `AgentChatView`；
  2. **准备一份简历**（`has_resume` 为真则 ✅）→ 按钮「去导入/创建」：`navigate('/student/resumes?import=1')`；
  3. **选择工作简历，开始对话**（`activeResumeId != null` 则 ✅）→ 按钮「选择」：触发工作区选择器打开（复用 F1 的外部触发能力）。
- 数据：进入空状态时请求一次 completeness（接口很轻）；三步全 ✅ 或用户点「不再显示」（localStorage `onboarding_dismissed`）后整卡隐藏；个人中心保存成功后清掉缓存让下次重查。
- 样式：浅色卡片 + 步骤序号 + 完成态打勾，别抢功能卡的视觉。

### G3 后端：AI 主动引导（让引导出现在对话里，而不只是 UI）

- `_build_initial_messages` 注入档案完整度（复用 G1 service）：
  - 缺项时追加一条 system：「学生档案目前缺少：项目经历、技能。涉及简历生成/优化时，先建议用户到『个人中心 → 个人资料』补充对应内容，**不要凭空编造**，也不要在对话里逐条追问代替档案填写。」
  - 档案完整则不注入（省 token）。
- system prompt 行动准则补一条：「档案信息不足以支撑生成时，一句话引导补档案 + 说明补哪几项，不要展开长篇问卷」。

---

## 实施批次与验收

| 批次 | 内容 | 效果 |
|------|------|------|
| 1 | E1-E4 + F1 + F2 | 导入闭环 + 优化新流程跑通 |
| 2 | G1 + G2 + G3 + F3 | 新用户引导成型 |

**统一验收**：`npm run build && npm run lint`、`alembic heads` 单头、干净 SQLite `upgrade head`（本批次无新表可省迁移）、以及四个剧本：

1. **新用户全流程**：空档案零简历进首页 → 三步引导卡可见 → 补档案（第 1 步变 ✅）→ 简历中心导入 PDF → 解析进编辑器核对保存（第 2 步 ✅）→ 回简历助手点「简历优化」→ 绑定简历（第 3 步 ✅，引导卡消失）→ 粘贴 JD → AI 优化 → 撤销可用；
2. **JSON 导入**：下载模板 → 填写 → 导入 → 编辑器内容正确；
3. **扫描件 PDF**：导入报友好错误，不产生空简历；
4. **对话里扔简历 PDF**：AI 读取点评但不生成新简历，引导去简历中心导入。

**已知风险**：E2 的 LLM 结构化质量取决于所配模型——验收时用两三份真实简历（单栏/双栏/中英混排）试导入，重点看经历的时间段和 bullet 是否串行；如果串得厉害，把抽取文本按页分块再合并解析（二期优化，先记录）。
