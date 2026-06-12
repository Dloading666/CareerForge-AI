# CHANGELOG

## 2026-06-12 — 简历防造假三道防线 + 简历助手核心能力升级

### 简历防造假三道防线（fact guard）

#### 防线1：程度词阶梯检测
- 新增 `_ROLE_ESCALATION_LADDER` 常量（9 个中文角色动词，5 级阶梯）
- 新增 `_check_role_escalation()` 函数
- 拦截逻辑：从证据中提取每段经历的角色词等级，与生成内容比对，升级即拦截
- 调用点：`generate_resume_data` / `optimize_resume_data` / `update_resume_data` / `export_resume_pdf`
- 测试：4 个用例（升级拦截、同级通过、降级通过、跨级拦截）

#### 防线2：条目归属校验（shadow mode）
- 新增 `_check_item_attribution()` 函数
- 新增 `ITEM_ATTRIBUTION_SHADOW_MODE` 开关（当前为 `True`，只记日志不拦截）
- 按条目粒度校验 bullet 中的数字/技术词是否出现在对应经历的证据中
- 防止把项目 A 的数字安到项目 B 头上（张冠李戴）
- 测试：2 个用例（跨条目数字检测、同条目通过）

#### 防线3：JD GAP 铁律（prompt + fact guard 双保险）
- **Prompt 层**：在 `_harness_system_prompt` 行动准则后添加 4 条 JD 匹配铁律
  - GAP 项禁止写入简历正文
  - GAP 项只能出现在差距分析中
  - 用户坚持写入时需告知风险
  - 违反等同于简历造假
- **Fact Guard 层**：
  - `SessionEvidencePool` 新增 `gap_keywords` 字段和 `set_gap_keywords()` 方法
  - 新增 `_check_gap_violations()` 函数（大小写不敏感子串匹配）
  - `analyze_jd_match` 返回前自动提取 GAP 项存入 evidence_pool
  - 调用点：`generate_resume_data` / `optimize_resume_data` / `update_resume_data`
- 测试：3 个用例（GAP 拦截、非 GAP 通过、无关键词通过）

#### 集成测试
- 新增 `test_combined_defenses` 验证三道防线协同工作

---

### 简历助手核心能力升级

#### 分层上下文压缩（D2）
- 新增 `_estimate_message_tokens()` / `_context_budget()` / `_compress_context()`
- 参数：`_COMPRESS_THRESHOLD=0.70`，`_SAFETY_MARGIN=0.15`
- 超过 token 预算时自动触发滚动摘要压缩

#### 会话记忆（C1）
- `session.memory_json` 存储 constraints / facts / preferences
- 新增 `save_session_note` 工具，模型可主动写入记忆
- 记忆以 pinned 方式注入 system prompt，永不被截断挤掉
- 新增 `search_past_sessions` 工具（按关键词搜索历史会话）

#### 工作简历绑定（A2）
- `session.active_resume_id` 绑定当前工作简历
- `read_resume` 重构为两层：列表层（全部简历 id/标题/时间）+ 全文层（工作简历）
- 新增 `set_active_resume_id` 工具切换工作简历

#### 写前快照与撤销（B2）
- 新增 `student_resume_revision` 表（迁移 `20260612_0023`）
- `_snapshot_resume_revision()` 在 AI 修改前自动存快照（每份保留 20 条）
- `POST /student/resumes/{id}/revert` 撤销到指定版本

#### 版本检查防覆盖（A3）
- `update_resume_data` 支持 `base_updated_at` 参数
- 写前检查 `updated_at`，防止覆盖用户在编辑器中的手改

#### 档案完整度引导（G3）
- 档案缺项时注入 system prompt 提示模型引导学生补充
- 避免每次对话都注入，节省 token

#### 新增工具
- `save_session_note`：保存会话记忆
- `search_past_sessions`：搜索历史会话
- `propose_profile_update`：建议学生补充档案字段
- `set_active_resume_id`：切换工作简历

---

### 前端改动

#### 简历中心
- 简历列表 API 支持 `resume_id` + `title` + `updated_at` 返回
- 简历编辑器支持工作简历绑定

#### AgentChatView
- 时间线渲染优化（text/actions 段交错）
- 活动胶囊支持自定义 PNG 图标 + CSS 动画

#### 个人中心
- 重构为 Modal 弹窗（不再是路由页面）
- 档案完整度引导

---

### 迁移清单

| 迁移文件 | 说明 |
|---------|------|
| `20260612_0021_merge_jd_text_and_metrics.py` | 合并 JD 文本和指标字段 |
| `20260612_0022_session_active_resume_memory.py` | session 新增 active_resume_id + memory_json |
| `20260612_0023_resume_revision.py` | 新增 student_resume_revision 表 |
| `20260612_0024_session_summarized_until.py` | session 新增 summarized_until_message_id |
| `20260612_0025_profile_proposal.py` | 新增 profile_proposal 相关表 |
| `20260612_0026_expand_skill_name.py` | 扩展 skill_name 字段长度 |
