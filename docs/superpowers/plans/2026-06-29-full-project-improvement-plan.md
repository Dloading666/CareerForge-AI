# CareerForge-AI 全项目深度改进实施计划

> 扫描日期：2026-06-29  
> 执行方式：按任务顺序实施；每个任务先补保护性测试，再修改，再跑该任务验收，最后单独提交。  
> 本文采用仓库现有 `docs/superpowers/plans/` 的 Superpowers 风格。当前环境没有名为 `superpower` 的可调用 Skill，因此不虚构调用记录，以同样的“具体文件、具体步骤、具体验证、独立提交”标准落地。

## 1. 目标

在不改变“一个管理端 + 一个学生端”产品形态的前提下，把项目从“主要功能可用”提升到“可稳定上线、问题可追踪、用户操作不易丢、后续迭代不易回归”的状态。

最终应达到：

- 学生登录、简历助手、简历编辑、AI 面试、管理端核心链路都有自动验证。
- 网络闪断、登录过期、重复点击、切换会话、撤销修改等高频边界情况不再产生错觉或丢内容。
- 上传文件、第三方依赖、生产配置和模型密钥具备明确安全边界。
- 数据库变更只走正式迁移，后台运行、历史消息、临时文件都有清理策略。
- 前后端质量检查一条命令完成，合并前自动拦截明显问题。
- 超大文件在保护性测试覆盖后逐步拆分，不以“大重写”方式冒险。

## 2. 已确认的产品事实与本计划边界

1. 当前产品是**一个管理员 + 学生用户端**，不是跨校平台。现有 `tenant_id` 字段保留为历史兼容和未来预留，本计划不新增“跨校”功能，也不做大规模删字段。
2. 当前部署配置文件进入仓库是负责人明确接受的做法。本计划不把它作为待整改项，也不擅自删除或改写；但代码仍需避免把模型密钥、验证码和错误堆栈写入页面、普通数据字段或日志。
3. 不改变简历助手的 Agentic Loop、AI 面试官独立流程、SSE 流式体验和简历可撤销原则。
4. 任何结构拆分都必须先补“现有行为保护测试”，保证拆完后用户看到的行为不变。
5. 本计划只记录扫描后仍成立的问题；已经修好的问题不重复立项。

## 3. 已完成、无需重复的加固

以下项目已在当前代码中确认完成，执行本计划时只保留回归验证：

- 数据库迁移失败时容器会停止，不再把失败版本强行标记成成功。
- 后台任务查询会校验任务发起人，不能读取别人的任务结果。
- 代理来源地址按可信代理层数解析，不再无条件相信任意转发头。
- 切换工作简历失败时，页面会回到原简历并提示失败。
- 删除会话会先取消仍在运行的生成任务。
- 会话切换时，待发送消息队列已经进入会话缓存。
- 首次建会话已有并发保护，不会因快速操作重复创建。
- 注册验证码不再通过注册结果返回，换邮箱后会吊销旧刷新凭证。

对应历史计划：`docs/superpowers/plans/2026-06-29-security-hardening.md`。

## 4. 扫描基线

| 检查项 | 当前结果 | 结论 |
|---|---:|---|
| 后端单元测试 | 322 通过，1 跳过 | 现有测试稳定，但对上传、登录续期和断线恢复覆盖不足 |
| 数据库迁移 | 单一 head；空 SQLite 升级成功 | 迁移链当前健康 |
| 前端构建 | 通过 | 主文件约 1.91 MB，压缩后约 551 KB，首屏仍偏重 |
| 前端代码检查 | 20 个错误，3 个警告 | 当前不能作为上线门禁 |
| 后端静态检查 | 250 个问题，其中 97 个可机械修复 | 需分批治理，禁止一次性自动改全仓 |
| 前端端到端测试 | 8 个通过 | 仅覆盖面试和分析页，未覆盖简历助手主链路 |
| 浏览器控制台 | 分析页存在无效页面结构警告 | 自动测试通过不代表页面完全健康 |
| 前端生产依赖审计 | 3 个漏洞：2 严重、1 中等 | PDF 导出依赖需要优先处理 |
| 本地 Python 环境审计 | 10 个包共报告 67 条已知漏洞 | 需在干净 Python 3.11 环境重新锁定和复核 |
| Docker Compose 配置 | 通过 | 基础编排有效 |
| 自动流水线 | 未发现 | 合并前没有统一自动门禁 |
| Python 版本 | 本地 `.venv` 为 3.9.6，容器为 3.11 | 本地环境目前无法可靠启动完整应用 |

说明：Python 漏洞数字来自当前本地环境，不等同于最终生产镜像。实施时以“干净 Python 3.11 环境 + 锁定后的依赖”重新审计结果为准。

## 5. 主要代码复杂度

| 文件 | 约行数 | 风险 |
|---|---:|---|
| `backend/app/student/agent_runtime.py` | 6,040 | 简历助手编排、工具、事实校验、导出耦合，改一处容易影响整条链路 |
| `frontend/src/student/ProfilePage.tsx` | 3,102 | 个人档案多个区域混在一个页面，局部修改回归范围过大 |
| `frontend/src/student/AgentChatView.tsx` | 2,493 | 会话、输入、附件、工作简历和时间线耦合 |
| `backend/app/interview/service.py` | 2,386 | 面试流程与已废弃语音实现混杂，已有大段不可达代码 |
| `frontend/src/student/AIInterviewerPage.tsx` | 2,233 | 面试建立、答题、语音、断线恢复和报告展示耦合 |
| `frontend/src/admin/AdminHomePage.tsx` | 1,374 | 管理端多个业务区域集中在一个文件 |
| `backend/app/student/resume_router.py` | 1,323 | 简历读写、快照、恢复、导出入口较集中 |

这些文件不是“因为长就立刻拆”。正确顺序是：先修确定性问题和补测试，再按职责搬移代码，最后比较行为一致性。

### 用户最容易直接感到不舒服的地方

- **像卡住了**：流式连接异常时可能长时间重连或过早失败，用户不知道 AI 还在做还是已经断了。
- **像把内容弄丢了**：切换会话时，未发送草稿和附件状态仍可能消失。
- **像串台了**：快速切换聊天或面试记录，旧请求可能晚到并覆盖当前页面。
- **不敢点撤销**：缺少精确版本凭据时可能撤销“最新修改”，而不是刚才那次 AI 修改。
- **明明成功却说失败**：面试答案已被服务器接收但流断开时，备用提交可能让页面误报失败。
- **AI 说得很像真的**：单项“量化、扩写”还没有复用完整事实校验，可能把建议写成未经确认的成绩。
- **不知道 AI 记住了什么**：会话记忆后端存在，但学生端没有清晰的查看、修改和删除入口。
- **越用越慢**：历史消息一次性加载、前端首屏资源偏大，数据变多后等待感会明显增强。

这些体感问题分别由 Task 9～14、22、25 处理，且优先于大规模代码拆分。

## 6. 优先级总览

### P0：上线前必须完成

1. 统一产品事实和运行版本，避免按错误文档部署。
2. 修复 PDF/文件处理相关已知依赖漏洞并锁定版本。
3. 收紧头像、反馈截图等上传入口，补生产安全响应头。
4. 生产环境配置必须“缺关键项就拒绝启动”，禁止退回会打印验证码的开发发信方式。
5. 模型平台密钥不再以明文写入路由规则或返回管理页面。
6. 修复登录续期时旧凭证覆盖新凭证的问题。
7. 修复简历助手断线恢复可能无限重连或首次异常就直接失败的问题。
8. 修复撤销错版本、面试备用提交误报失败等用户信任问题。

### P1：首个稳定版本完成

1. 会话草稿、附件和历史加载不因快速切换而丢失或串页。
2. 单项 AI 润色接入简历事实校验，不生成未经确认的新事实。
3. 统一页面错误格式，隐藏堆栈、服务器路径和上游原始错误。
4. 移除启动时建表，反馈数据纳入正式迁移。
5. 增加运行事件、临时附件、登录记录的保留和清理策略。
6. 把“AI 记住的内容”做成学生可见、可改、可删的功能。
7. 建立一条命令和自动流水线，覆盖构建、检查、迁移和核心剧本。

### P2：稳定运行后持续优化

1. 结构化日志、链路编号、错误告警和业务指标。
2. 前端按页面拆包，降低首次打开等待时间。
3. 在有保护性测试后拆分超大文件。
4. 评估把刷新凭证迁移到更安全的浏览器 Cookie。
5. 根据真实数据决定是否把学生端后台运行迁移为 Redis 统一调度。

---

# 第一阶段：上线事实、依赖与入口安全

## Task 1：校正文档中的产品事实和运行事实

**Files**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Create: `docs/api-current.md`
- Create: `scripts/check_docs_consistency.py`
- Create: `docs/architecture/current-product-boundary.md`

**问题**

文档同时出现“高校多租户”“单管理员学生端”、过期迁移版本、错误端口、面试官走主智能体、项目没有测试等互相冲突的描述。新代理或开发者会照着错误地图修改真实业务。

**Steps**

- [ ] 把产品边界明确写成“单管理端 + 学生端”；说明 `tenant_id` 只作兼容预留，不把它描述成当前跨校功能。
- [ ] 以 `alembic heads` 的结果更新“最新迁移”描述，不再手写长期会过期的固定版本；更推荐改为运行命令获取。
- [ ] 以 Vite、Docker Compose 和 Nginx 的真实配置统一本地端口、容器端口和访问地址。
- [ ] 明确 AI 面试官走独立面试流程，不经过简历助手 Agentic Loop。
- [ ] 更新真实测试命令、测试数量仅作“扫描日期基线”，避免长期写死。
- [ ] 清理文档中已不存在的 MCP 和旧面试入口。
- [ ] 生成 `current-product-boundary.md`：列出学生端、管理端、后台任务、文件存储和第三方模型的边界图。
- [ ] `check_docs_consistency.py` 检查明显过期描述：错误端口、多个迁移 head、旧入口、乱码占位符。
- [ ] 不改写负责人明确接受的部署文件入库策略，只把它记录为当前项目约定。

**Validation**

- [ ] `python scripts/check_docs_consistency.py`
- [ ] `cd backend && alembic heads`
- [ ] `cd frontend && npm run build`
- [ ] 新加入项目的人只读 README 和架构边界文档，可以正确说出两个学生智能体分别走哪条流程。

**Commit**

`docs: 校正产品边界与运行说明`

## Task 2：统一 Python 3.11 并锁定可复现依赖

**Files**

- Create: `.python-version`
- Modify: `backend/requirements.txt`
- Create: `backend/requirements.lock`
- Modify: `backend/Dockerfile`
- Modify: `backend/entrypoint.sh`
- Modify: `README.md`
- Create: `scripts/audit_dependencies.sh`

**问题**

本地 `.venv` 是 Python 3.9.6，而代码和容器按 3.11 编写；`backend/app/core/dify_client.py` 的类型写法在 3.9 导入时直接失败。部分依赖使用较宽的最低版本，开发、部署和下一次安装可能得到不同结果。

**Steps**

- [ ] 用 `.python-version` 固定 Python 3.11 的具体小版本，并让 Docker 使用同一主次版本。
- [ ] 启动脚本检查 Python 主次版本，不满足时给出业务可理解的修复提示并退出。
- [ ] 在干净 Python 3.11 环境安装现有依赖，先跑全量后端测试，记录基线。
- [ ] 使用锁定工具生成 `requirements.lock`；生产镜像从 lock 安装，`requirements.txt` 保留直接依赖意图。
- [ ] 分组升级 `PyJWT`、`pypdf`、`python-multipart`、`FastAPI/Starlette`、`pdfminer.six`、`Pillow`、`cryptography`，每组升级后跑对应测试。
- [ ] 给 `backend/app/core/dify_client.py` 增加与项目一致的未来注解声明，避免工具误用旧环境时出现难懂错误；这不替代 Python 3.11 统一。
- [ ] 对体积很大的可选能力依赖（如本地向量库或本地模型）区分“生产必需”和“可选安装”，避免所有部署都下载不用的包。
- [ ] `audit_dependencies.sh` 在临时干净环境运行依赖审计，不依赖开发者旧虚拟环境。
- [ ] 审计结果若暂无兼容修复版本，必须写入带负责人和复查日期的例外清单，不能静默忽略。

**Validation**

- [ ] `python --version` 显示 Python 3.11.x。
- [ ] `cd backend && python -m pytest tests/ -v`
- [ ] `cd backend && python -m pip check`
- [ ] `bash scripts/audit_dependencies.sh`
- [ ] 使用 lock 连续构建两次镜像，关键依赖版本一致。

**Commit**

`build: 统一 Python 版本并锁定后端依赖`

## Task 3：修复前端 PDF 依赖漏洞并建立导出回归样本

**Files**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/resume/utils/exportResumePdf.ts`
- Create: `frontend/src/resume/utils/exportResumePdf.test.ts`
- Create: `frontend/e2e/resume-pdf-export.spec.ts`
- Create: `frontend/e2e/fixtures/resume-export-sample.json`

**问题**

生产依赖审计报告 2 个严重和 1 个中等漏洞。`html2pdf.js` 没有在源码中使用，却带入另一套 PDF 与净化依赖；实际使用的 `jspdf` 版本也在漏洞范围内。

**Steps**

- [ ] 删除没有使用的 `html2pdf.js`。
- [ ] 把 `jspdf` 升级到审计给出的安全版本或更高兼容版本。
- [ ] 对照新版变更调整字体嵌入、分页、图片和中文输出。
- [ ] 建立固定简历样本，覆盖中文、英文、长段落、空区块、头像和跨页经历。
- [ ] 单元测试验证生成结果非空、页数合理、文件头正确，不把下载链接写入聊天正文。
- [ ] 端到端测试从简历页触发导出并验证下载成功。
- [ ] 人工对比升级前后 PDF：中文不乱码、内容不截断、页眉页脚和分页不明显退化。
- [ ] 将 `npm audit --omit=dev` 加入统一验证；严重漏洞阻止合并。

**Validation**

- [ ] `cd frontend && npm audit --omit=dev --registry=https://registry.npmjs.org`
- [ ] `cd frontend && npm run build`
- [ ] `cd frontend && npx playwright test e2e/resume-pdf-export.spec.ts`

**Commit**

`fix: 升级简历 PDF 导出依赖`

## Task 4：建立统一、安全的图片上传入口

**Files**

- Create: `backend/app/core/image_upload.py`
- Modify: `backend/app/auth/router.py`
- Modify: `backend/app/student/router.py`
- Modify: `backend/app/student/feedback_router.py`
- Modify: `backend/app/admin/feedback_router.py`
- Create: `backend/tests/test_image_upload_security.py`
- Create: `backend/tests/test_feedback_uploads.py`
- Modify: `backend/.env.example`
- Modify: `backend/app/core/config.py`

**问题**

部分头像和反馈截图入口只看文件名后缀，部分入口没有流式大小上限，还会把原始文件直接放到公开静态目录。伪装成图片的网页文件、超大图片和解压炸弹会带来页面注入或资源耗尽风险。

**Steps**

- [ ] 在 `image_upload.py` 建立唯一入口：分块读取、读取过程中限制字节数，不先把整个文件装进内存。
- [ ] 同时检查文件签名、实际解码格式、像素总数、宽高上限和动画帧数；文件名后缀只作提示，不能作信任依据。
- [ ] 只允许 JPEG、PNG、WebP；明确拒绝 SVG、HTML、脚本、损坏文件和超限动图。
- [ ] 服务器重新解码并编码成新文件，去除原文件元信息，用随机文件名和服务器决定的后缀。
- [ ] 头像和背景图设置不同尺寸、质量和最大体积；保存前生成适合页面展示的版本。
- [ ] 反馈截图不再直接暴露为公共静态文件；保存为受保护附件，由管理员入口校验身份后读取。
- [ ] 反馈描述设置长度上限，反馈类型使用固定枚举，修复当前乱码成功提示。
- [ ] 配置项写入 `config.py` 和 `.env.example`：头像、背景图、反馈截图的体积及像素上限。
- [ ] 添加文件清理：用户替换图片后删除旧文件；反馈删除或超过保留期后清理附件。

**Tests**

- [ ] 正常 JPEG/PNG/WebP 上传成功且浏览器可显示。
- [ ] 把 HTML、SVG 改名成 `.png` 仍被拒绝。
- [ ] 超过体积、像素或帧数上限的文件被拒绝，进程内存不突增。
- [ ] 损坏图片和带奇怪双后缀的文件被拒绝。
- [ ] 学生不能读取反馈附件，管理员可以读取。
- [ ] 返回内容使用统一 `{code, msg, data}` 格式。

**Validation**

- [ ] `cd backend && python -m pytest tests/test_image_upload_security.py tests/test_feedback_uploads.py -v`
- [ ] 手动走一遍头像、背景图、反馈截图上传与替换。

**Commit**

`fix: 收紧图片与反馈附件上传边界`

## Task 5：补生产安全响应头与同源文件策略

**Files**

- Modify: `nginx/dify.conf`
- Modify: `frontend/nginx/default.conf`
- Modify: `docker-compose.yml`
- Create: `backend/tests/test_security_headers.py`
- Create: `docs/operations/security-headers.md`

**问题**

当前 Nginx 缺少内容类型保护、页面嵌套限制、来源限制等浏览器侧安全边界。项目又允许上传和展示图片，一旦某个入口判断错误，影响会被放大。

**Steps**

- [ ] 增加 `X-Content-Type-Options: nosniff`。
- [ ] 增加 `Content-Security-Policy`，先根据现有模型请求、字体、图片和流式连接列出最小白名单；禁止任意脚本来源。
- [ ] 增加 `frame-ancestors` 或等效页面嵌套限制。
- [ ] 增加合适的 `Referrer-Policy` 和 `Permissions-Policy`。
- [ ] 仅在 HTTPS 生产入口增加 HSTS；本地开发不强制，避免开发环境被浏览器锁死。
- [ ] 静态上传文件明确 `Content-Type`、缓存时间和 `Content-Disposition`，受保护反馈附件默认下载或安全内联。
- [ ] 先以报告模式观察 CSP 违规，再切到强制模式；记录确有必要的例外来源和原因。

**Validation**

- [ ] 用 `curl -I` 检查首页、接口、头像和反馈附件的响应头。
- [ ] 浏览器控制台没有新增 CSP 阻断，登录、SSE、图片和 PDF 导出正常。
- [ ] 恶意 HTML 即使误存到图片目录，也不会按网页脚本执行。

**Commit**

`fix: 增加生产浏览器安全边界`

## Task 6：让生产配置缺失时拒绝启动

**Files**

- Modify: `backend/app/core/config.py`
- Modify: `backend/app/auth/email.py`
- Modify: `backend/app/main.py`
- Modify: `backend/.env.example`
- Create: `backend/tests/test_production_config.py`
- Create: `backend/tests/test_mail_provider.py`
- Create: `docs/operations/production-checklist.md`

**问题**

`APP_ENV` 目前是任意字符串，只有完全等于 production 才会关闭开发行为；生产发信缺配置时还可能退回会把验证码写进日志的开发方式，并向用户显示“已发送”。这会造成假成功和验证码泄露。

**Steps**

- [ ] 把运行环境限制为明确枚举：development、test、production；无法识别的值直接拒绝启动。
- [ ] 生产启动时验证 JWT 密钥强度、加密密钥格式、管理员初始密码、数据库类型、前端来源和邮件服务配置。
- [ ] 生产缺邮件配置时拒绝启动，不允许创建 `DevMailProvider`。
- [ ] 开发邮件方式不再记录明文验证码；测试通过注入假发信器读取验证码，不依赖日志。
- [ ] 健康检查拆成“进程活着”和“服务可接单”：后者检查数据库、Redis、迁移状态和必要配置。
- [ ] 启动日志只输出配置项是否就绪，不输出密钥、密码、完整连接串或验证码。
- [ ] 把上线前检查写成可勾选清单，包括迁移、备份、回滚入口和最小冒烟剧本。

**Tests**

- [ ] production + 缺 SMTP：启动失败，日志无验证码。
- [ ] production + 默认弱密钥：启动失败。
- [ ] 非法 `APP_ENV`：启动失败。
- [ ] development：假发信器可用于测试，但页面不直接收到验证码。
- [ ] readiness 在数据库或 Redis 不可用时返回不可接单，liveness 仍能反映进程状态。

**Commit**

`fix: 增加生产配置启动闸门`

## Task 7：模型平台密钥只保存加密引用

**Files**

- Modify: `backend/app/admin/agent_service.py`
- Modify: `backend/app/admin/master_service.py`
- Modify: `backend/app/admin/router.py`
- Modify: `backend/app/admin/models.py`
- Create: `backend/alembic/versions/20260629_0001_encrypt_route_provider_secret.py`
- Create: `backend/tests/test_admin_route_secret.py`

**问题**

当前把已解密的模型平台密钥写入 `provider_config_json`，管理端读取路由规则时又可能把整个配置返回。即使部署文件策略是负责人接受的，这类运行时密钥也不应散落在普通业务字段、返回结果和日志中。

**Steps**

- [ ] 路由规则只保存 `agent_id`、模型平台记录编号或加密密钥引用，不保存明文密钥。
- [ ] 真正调用模型平台时再从专用加密字段读取并短暂解密，使用后不写回普通对象。
- [ ] 管理端返回仅显示“已配置/未配置”和脱敏尾号，不返回可还原密钥的内容。
- [ ] 新迁移识别现有 `provider_config_json` 中的明文，写入加密字段或关联现有模型配置，然后清除明文。
- [ ] 迁移日志只记录处理条数，不打印旧值。
- [ ] 结构化日志和异常记录统一过滤 `api_key`、`authorization`、`token`、`secret` 等字段。
- [ ] 增加数据库和接口断言，确保明文不出现在规则 JSON、响应正文和日志捕获中。

**Validation**

- [ ] `cd backend && alembic upgrade head`
- [ ] `cd backend && python -m pytest tests/test_admin_route_secret.py -v`
- [ ] 创建、更新、读取并实际调用一条路由，功能正常且所有返回均脱敏。

**Commit**

`fix: 移除路由规则中的明文模型密钥`

---

# 第二阶段：登录、流式对话与用户操作可信度

## Task 8：统一登录续期，消除旧凭证覆盖新凭证

**Files**

- Modify: `frontend/src/shared/api.ts`
- Modify: `frontend/src/shared/AuthProvider.tsx`
- Modify: `frontend/src/shared/ProtectedRoute.tsx`
- Create: `frontend/src/shared/authSession.ts`
- Create: `frontend/src/shared/authSession.test.ts`
- Create: `frontend/e2e/auth-refresh.spec.ts`

**问题**

页面启动时会拿旧访问凭证请求当前用户。公共请求层可能已经成功续期并保存新凭证，但启动逻辑随后又把旧凭证写回存储。多个请求同时过期时，登录续期、退出和页面身份状态也存在多套实现。

**Steps**

- [ ] 建立唯一 `authSession`：读取、更新、清除会话以及广播“已续期/已失效”。
- [ ] `apiRequest` 和流式请求只从该入口取当前访问凭证，不由调用页面手工传旧值。
- [ ] 全站共用一个正在进行的续期请求，多个同时 401 只发一次续期。
- [ ] 续期成功后先原子更新新会话，再重放失败请求；旧调用结果无权覆盖更新后的会话。
- [ ] 续期最终失败时统一清空会话、停止进行中的 SSE，并跳回登录页；保留可安全恢复的页面地址。
- [ ] `AuthProvider` 只订阅统一会话变化，不再实现第二套续期逻辑。
- [ ] SSO 登录参数进入页面后立即从地址栏移除，再发网络请求，避免留在历史、日志和来源地址中。
- [ ] 中期方案记录为后续任务：刷新凭证迁移到 Secure、HttpOnly、SameSite Cookie；本任务先消除现有竞态。

**Tests**

- [ ] 旧访问凭证 + 有效刷新凭证：启动后保持登录，保存的是新凭证。
- [ ] 4 个请求同时 401：只续期一次，4 个请求都正常重放。
- [ ] 刷新凭证失效：只退出一次，不出现重复提示或循环跳转。
- [ ] 续期期间打开另一页：不会被旧页面结果覆盖。
- [ ] SSO 地址参数在请求发出前已经从地址栏消失。

**Validation**

- [ ] `cd frontend && npm run build`
- [ ] `cd frontend && npx playwright test e2e/auth-refresh.spec.ts`

**Commit**

`fix: 统一登录续期与失效处理`

## Task 9：统一简历助手的断线重连与运行恢复

**Files**

- Modify: `frontend/src/student/chatRuntimeStore.ts`
- Create: `frontend/src/student/runStream.ts`
- Create: `frontend/src/student/runStream.test.ts`
- Modify: `frontend/src/student/AgentChatView.tsx`
- Create: `frontend/e2e/resume-stream-recovery.spec.ts`
- Modify: `backend/app/student/run_manager.py`
- Create: `backend/tests/test_run_event_resume.py`

**问题**

当前流式连接只要收到一次成功响应就把重试次数清零，代理若反复正常建连后提前断开，可能一直循环；首次网络异常又可能绕过重试直接失败。新消息订阅和页面恢复订阅还有两套相似但不完全一致的代码。

**Steps**

- [ ] 抽出唯一 `runStream`，统一首次订阅、断线重连、刷新页面恢复和最终状态核对。
- [ ] 重连使用“总时长 + 总次数”双重预算；只有收到比上次更大的 `seq` 才算取得有效进展。
- [ ] 网络异常、HTTP 提前结束、SSE 解析错误进入同一重试策略，使用带抖动的递增等待。
- [ ] 每次重连携带最后已确认 `after_seq`，前端按事件编号去重，文字增量不重复拼接。
- [ ] 达到预算后查询运行状态：已完成则补拉最终快照；仍运行则显示“连接中断，可继续恢复”；失败才展示失败。
- [ ] 返回可取消句柄；切换会话、删除会话、退出登录和页面卸载时都停止旧连接。
- [ ] 后端保证同一 `run_id` 的事件编号单调递增，终态事件可重复查询且不会缺最终消息。
- [ ] 给重连次数、恢复成功率、最终失败原因留结构化埋点，供 Task 20 使用。

**Tests**

- [ ] 第一次连接前网络异常，恢复网络后继续收到完整回答。
- [ ] 每收到一个增量就被代理断开，不会无限重连。
- [ ] 同一事件被重复返回，不会造成文字重复或活动胶囊重复。
- [ ] 刷新页面后从最后 `seq` 继续，最终内容与数据库一致。
- [ ] 切换会话后旧会话事件不会写进新会话。

**Validation**

- [ ] `cd frontend && npx playwright test e2e/resume-stream-recovery.spec.ts`
- [ ] `cd backend && python -m pytest tests/test_run_event_resume.py -v`
- [ ] 手动在浏览器开发工具切换离线/在线，回答能够恢复。

**Commit**

`fix: 统一简历助手断线恢复`

## Task 10：保存每个会话的草稿和待上传附件

**Files**

- Modify: `frontend/src/student/AgentChatView.tsx`
- Modify: `frontend/src/student/chatRuntimeStore.ts`
- Create: `frontend/src/student/sessionDraftStore.ts`
- Create: `frontend/src/student/sessionDraftStore.test.ts`
- Create: `frontend/e2e/resume-session-drafts.spec.ts`

**问题**

待发送消息队列已经按会话缓存，但输入框草稿和未发送附件没有。学生切换会话时，输入了一半的内容和刚选的附件仍可能消失；多个附件上传状态也容易被当前页面状态误覆盖。

**Steps**

- [ ] 为每个会话保存 `inputValue`、待上传附件、上传进度、失败状态和思考档位。
- [ ] 尚未创建会话时使用稳定的本地草稿编号；首条消息创建会话后把草稿原子迁移到真实会话编号。
- [ ] 切换前先保存当前草稿，切换后恢复目标会话草稿，不清空其他会话内容。
- [ ] 删除会话时删除对应草稿和临时附件；新建空会话不会继承旧草稿。
- [ ] 已开始上传的附件切换会话后继续归属于原会话，完成回调不得写入当前其他会话。
- [ ] 页面刷新后是否保留草稿采用明确策略：文本可存在浏览器本地，文件只保留名称并提示重新选择，避免把大文件写入本地存储。
- [ ] 对草稿存储设置数量和时间上限，避免长期累积用户简历文本。

**Tests**

- [ ] A 会话输入一半并选附件，切到 B 再切回 A，文本和附件状态仍在。
- [ ] A 附件上传完成时页面正在 B，不会串到 B。
- [ ] 删除 A 后草稿消失，B 不受影响。
- [ ] 首条消息并发创建期间快速切换，草稿只迁移一次。

**Commit**

`feat: 按会话保存输入草稿与附件`

## Task 11：防止旧页面请求覆盖新会话，并给历史记录分页

**Files**

- Modify: `frontend/src/student/AgentChatView.tsx`
- Modify: `frontend/src/student/AIInterviewerPage.tsx`
- Modify: `frontend/src/student/chatRuntimeStore.ts`
- Modify: `backend/app/student/router.py`
- Modify: `backend/app/interview/router_student.py`
- Create: `backend/tests/test_session_history_pagination.py`
- Create: `frontend/e2e/session-switch-race.spec.ts`

**问题**

聊天页和面试页加载详情时没有请求代次保护。快速点 A、B 两个会话，较慢返回的 A 可能覆盖已经选择的 B。聊天历史接口还会一次性加载全部消息、活动和附件；前端传 `limit=0` 想只取元数据，后端并未执行这个含义。

**Steps**

- [ ] 每次会话选择生成请求代次，并取消上一个仍在进行的请求。
- [ ] 响应落地前同时校验“请求代次”和“目标会话仍是当前会话”；任一不符就丢弃。
- [ ] 面试详情加载使用同一模式，避免旧报告或旧问题覆盖当前面试。
- [ ] 新增轻量会话元数据入口，只返回标题、工作简历、最后消息时间、运行状态和未读提示。
- [ ] 历史消息按游标向前分页，默认先取最近一屏；活动与附件只查询本页相关消息。
- [ ] 会话列表也按游标分页或限制最近数量，搜索走服务端。
- [ ] 前端滚到顶部时加载更早内容，并保持滚动位置不跳动。
- [ ] 为 `(session_id, id/created_at)`、活动消息关联和附件消息关联检查并补必要索引。
- [ ] 保持旧入口一段兼容期，记录调用量后移除无效 `limit=0` 约定。

**Tests**

- [ ] 人为让 A 延迟、B 快速返回，最终页面仍显示 B。
- [ ] 2,000 条消息的会话首屏响应不随总历史线性增长。
- [ ] 向上加载不会重复、漏消息或跳滚动位置。
- [ ] 当前正在生成的消息与分页历史能正确合并。

**Commit**

`fix: 防止会话串页并分页加载历史`

## Task 12：让简历撤销只撤销刚刚那一次，并立即刷新预览

**Files**

- Modify: `frontend/src/student/AgentChatView.tsx`
- Create: `frontend/src/student/resumeUpdateEvents.ts`
- Modify: `backend/app/student/resume_router.py`
- Create: `backend/tests/test_resume_exact_revert.py`
- Create: `frontend/e2e/resume-exact-undo.spec.ts`

**问题**

聊天助手修改简历后，如果页面拿不到本次快照编号，会退而求其次撤销“最新快照”。用户在另一个页面又做过修改时，这可能撤销错内容。撤销成功后右侧预览也可能仍显示旧画面，造成“到底撤了没有”的不确定感。

**Steps**

- [ ] 每次 AI 写入的完成事件必须包含本次修改对应的精确 `revision_id`、简历编号和修改后版本时间。
- [ ] 撤销按钮只接受该精确编号；缺失时禁用并提示“本次修改缺少撤销凭据”，不得自动取最新快照。
- [ ] 后端恢复时再次核对快照属于当前用户、当前简历和本次修改链。
- [ ] 恢复成功后广播简历更新事件，聊天右侧预览、简历中心和编辑器都重新读取服务器内容。
- [ ] 若用户在 AI 修改后又手工编辑，明确提示存在新修改，让用户选择进入版本记录查看，而不是静默覆盖。
- [ ] 版本记录中展示时间、来源（AI/手工/恢复）和简短改动说明，后续可在此支持“重做”。

**Tests**

- [ ] AI 修改 A 后，用户手改 B，再点 A 的撤销：不会误撤 B。
- [ ] 撤销成功后聊天预览和简历中心立即一致。
- [ ] 快照属于另一份简历或另一用户时拒绝恢复。
- [ ] 连续两次 AI 修改分别只能撤销对应版本。

**Commit**

`fix: 使用精确版本撤销 AI 简历修改`

## Task 13：修复面试提交备用路径的幂等与恢复体验

**Files**

- Modify: `frontend/src/student/AIInterviewerPage.tsx`
- Create: `frontend/src/student/interviewApi.ts`
- Modify: `backend/app/interview/router_student.py`
- Modify: `backend/app/interview/service.py`
- Create: `backend/tests/test_interview_submit_idempotency.py`
- Create: `frontend/e2e/interview-submit-recovery.spec.ts`

**问题**

面试回答先走流式运行，连接失败后再走普通提交，但两条路径生成了不同的请求编号。若服务器其实已保存回答，只是流断了，备用提交会收到“重复状态”并让页面把答案放回输入框，用户看到的是失败，实际上服务器已经进入下一题。

**Steps**

- [ ] 用户点击提交时只生成一次 `request_id`，流式路径和备用路径共用。
- [ ] 后端以“面试编号 + 请求编号”保存幂等结果；相同请求重放返回第一次结果，不重复推进阶段。
- [ ] 前端遇到已处理或连接不确定时，读取最新面试详情并按服务器状态恢复，不直接显示提交失败。
- [ ] 面试流式订阅采用 Task 9 的预算、事件编号和取消原则；页面离开时停止旧订阅。
- [ ] 答案只在确定服务器未接收时恢复到输入框；已接收则展示下一题或评分等待状态。
- [ ] 修复 `router_student.py` 中乱码接口描述。

**Tests**

- [ ] 服务器保存后立即断流，页面刷新状态后进入下一题，答案不重复。
- [ ] 相同 `request_id` 提交两次只推进一次。
- [ ] 请求确实未到服务器时，答案回到输入框供重试。
- [ ] 切换面试时旧流不会更新新面试。

**Commit**

`fix: 保证面试回答幂等提交与断线恢复`

## Task 14：让简历编辑器里的单项 AI 辅助也遵守事实边界

**Files**

- Modify: `backend/app/student/ai_assist_router.py`
- Modify: `backend/app/student/ai_assist_service.py`
- Modify: `backend/app/student/agent_fact_guard.py`
- Modify: `frontend/src/resume/components/AiAssistPanel.tsx`
- Create: `backend/tests/test_ai_assist_fact_guard.py`
- Create: `frontend/e2e/resume-ai-assist.spec.ts`

**问题**

单项“润色、量化、扩写”入口虽然地址里有简历编号，但当前没有用它确认简历归属，也没有从服务器读取对应原文；它主要靠提示词要求模型不要编造，未复用简历助手已有的事实校验。尤其“量化”和“扩写”很容易把建议写成不存在的业绩事实。

**Steps**

- [ ] 先确认简历属于当前学生且未删除，再读取指定区块、条目和当前版本。
- [ ] 请求只传区块定位、操作类型和版本，不再把浏览器传来的任意文本当唯一事实源。
- [ ] 用户已在编辑器改但未保存时，明确区分“基于未保存草稿建议”和“直接修改在线简历”；默认只给建议，不自动写入。
- [ ] 对模型结果运行现有事实校验，新增公司、学校、职位、时间、数字和证书时标记或阻止。
- [ ] “量化”没有真实数字时只给占位建议或提问，例如“可补充人数/金额”，不得虚构具体数字。
- [ ] 返回结果包含 `safe_to_apply`、风险提示和被识别的新事实，页面用普通语言说明。
- [ ] 版本不一致时要求重新读取，不覆盖用户刚刚的手工修改。
- [ ] 上游模型错误映射成稳定提示，不把服务商原始错误、地址或异常类型返回学生。

**Tests**

- [ ] 尝试新增不存在的销售额、公司、证书和日期，被拦截或明确标为待确认。
- [ ] 普通措辞优化正常返回。
- [ ] 操作别人的简历编号被拒绝。
- [ ] 页面版本落后时不应用建议。
- [ ] 模型超时只显示友好重试提示。

**Commit**

`fix: 为简历单项 AI 辅助增加事实校验`

---

# 第三阶段：数据生命周期、运行方式与错误边界

## Task 15：把反馈表和所有建表动作纳入正式迁移

**Files**

- Modify: `backend/app/main.py`
- Create: `backend/app/student/feedback_models.py`
- Modify: `backend/app/student/feedback_router.py`
- Modify: `backend/app/admin/feedback_router.py`
- Create: `backend/alembic/versions/20260629_0002_manage_user_feedback.py`
- Create: `backend/tests/test_feedback_migration.py`
- Modify: `backend/entrypoint.sh`

**问题**

应用启动时仍执行 `Base.metadata.create_all`，还用原始 SQL 临时创建反馈表。生产数据库结构因此可能取决于“哪次服务先启动”，而不是可审查、可回放的迁移历史。

**Steps**

- [ ] 为反馈建立正式模型，字段包含创建者、类别、描述、附件引用、处理状态、回复和时间。
- [ ] 新迁移兼容已有反馈表：只补缺字段和索引，不丢现有数据。
- [ ] 从 `main.py` 删除原始建表 SQL。
- [ ] production 启动不执行 `create_all`；测试数据库通过 fixture 或迁移建立。
- [ ] 开发环境也优先运行迁移，避免“本地能跑、生产缺列”。
- [ ] 反馈列表按创建时间和处理状态增加索引并分页。
- [ ] `entrypoint.sh` 继续保持迁移失败即停止，增加启动前单一 head 检查。

**Validation**

- [ ] 空 SQLite `alembic upgrade head` 成功且反馈表完整。
- [ ] 模拟已有旧反馈表升级，记录数量和内容不变。
- [ ] `cd backend && alembic heads` 只有一个 head。
- [ ] 应用启动不再执行运行时 DDL。

**Commit**

`refactor: 将反馈数据纳入正式迁移`

## Task 16：统一接口错误格式并隐藏内部细节

**Files**

- Modify: `backend/app/main.py`
- Modify: `backend/app/core/response.py`
- Modify: `backend/app/infra/rate_limit.py`
- Modify: `backend/app/jobs.py`
- Modify: `backend/app/jobs_router.py`
- Modify: `backend/app/student/ai_assist_router.py`
- Modify: `backend/app/interview/router_student.py`
- Modify: `frontend/src/shared/api.ts`
- Create: `backend/tests/test_error_envelope.py`
- Create: `frontend/src/shared/apiErrors.test.ts`

**问题**

普通业务返回使用 `{code, msg, data}`，但参数错误、权限错误、限流和部分异常仍返回 `detail` 或原始服务商错误。后台任务状态还可能把服务器文件路径和异常堆栈返回页面。

**Steps**

- [ ] 给 HTTP 错误、参数校验错误、限流、未知错误增加统一响应处理。
- [ ] 定义稳定业务错误编号：登录失效、无权限、版本冲突、文件不合规、模型繁忙、运行已处理等。
- [ ] 生产 500 只返回请求编号和友好提示；异常类型、堆栈、服务器路径只进受保护日志。
- [ ] 后台任务结果移除 `result_path`、`traceback` 等内部字段，只返回可下载凭据或友好失败原因。
- [ ] 第三方模型、语音和邮件错误做映射，不把提供商地址、模型密钥片段或原文透传。
- [ ] 前端请求层统一把错误编号映射成页面提示，业务页面不再猜测多种响应形状。
- [ ] SSE 的 `runtime.error` 也使用同一错误编号与请求编号，不携带堆栈。

**Tests**

- [ ] 400、401、403、404、409、422、429、500 都符合信封格式。
- [ ] 响应中不出现服务器绝对路径、`Traceback`、密钥和上游完整错误。
- [ ] 登录失效仍能被前端统一识别并退出。
- [ ] SSE 错误页面显示可理解提示并可重试。

**Commit**

`fix: 统一接口错误与隐私边界`

## Task 17：定义业务数据、事件与文件的保留策略

**Files**

- Create: `docs/architecture/data-retention.md`
- Modify: `backend/app/student/agent_models.py`
- Modify: `backend/app/student/revision_models.py`
- Modify: `backend/app/interview/models.py`
- Modify: `backend/app/auth/models.py`
- Modify: `backend/app/student/run_manager.py`
- Create: `backend/app/maintenance/cleanup.py`
- Create: `backend/app/maintenance/router.py`
- Create: `backend/tests/test_data_retention.py`
- Create: `backend/alembic/versions/20260629_0003_add_retention_indexes.py`

**问题**

项目文档说所有业务数据软删除，但真实代码中简历、面试、消息、事件和附件存在不同删除方式。运行事件长期写数据库，没有明确清理；上传文件也可能在业务记录删除后成为孤儿。盲目把所有表都改成软删除同样会无限膨胀。

**Steps**

- [ ] 先形成保留矩阵，不一刀切：用户可恢复内容、审计内容、临时内容分别定义删除方式和期限。
- [ ] 建议默认：简历和面试进入 30 天回收站；AI 修改快照每份保留最近 20 条；终态运行事件保留 7 天；失败任务和登录记录保留 30 天；未引用临时附件保留 24 小时。
- [ ] 学生主动彻底删除前给出影响说明；管理端审计和合规需要另行定义，不在页面静默永久保存。
- [ ] 清理任务只处理终态和超过期限的数据，绝不删除活跃运行所需事件。
- [ ] 删除数据库记录时同步清理文件；扫描并报告孤儿文件，先报告模式运行一周再自动清理。
- [ ] 为运行事件增加 `(run_id, seq)` 唯一或组合索引，为期限清理增加终态时间索引。
- [ ] 清理任务使用数据库锁保证多进程下只执行一次，并记录处理数量与失败项。
- [ ] 增加管理员手动预览清理范围和执行入口，不把服务器路径暴露到页面。

**Tests**

- [ ] 活跃运行事件不被清理，终态过期事件会被清理。
- [ ] 回收站期限内可恢复，超过期限按策略删除。
- [ ] 被多个记录引用的文件不会误删。
- [ ] 清理任务重复运行结果一致。

**Commit**

`feat: 建立业务数据与附件保留策略`

## Task 18：明确单进程运行约束，并为多实例准备迁移路径

**Files**

- Modify: `backend/app/student/run_manager.py`
- Modify: `backend/entrypoint.sh`
- Modify: `docker-compose.yml`
- Modify: `backend/app/core/config.py`
- Create: `backend/tests/test_run_manager_deployment_mode.py`
- Create: `docs/architecture/run-manager.md`

**问题**

学生端后台运行管理器是当前进程内单例，锁、取消和实时订阅都在内存中。Compose 明确使用一个进程，但入口默认值曾允许多个 worker；一旦部署配置遗漏，用户可能连到另一个进程，看不到运行或无法取消。

**Steps**

- [ ] 当前版本明确采用“单应用进程 + Redis 事件辅助”的受支持模式，入口和配置默认都固定为 1。
- [ ] production 若检测到 worker 大于 1 且仍使用内存运行管理器，拒绝启动并说明业务影响。
- [ ] readiness 暴露当前运行管理模式、Redis 是否就绪和活跃任务数量，不暴露用户内容。
- [ ] 写明扩容触发条件：并发任务、CPU/内存、排队时长达到阈值后，才迁移到统一任务队列。
- [ ] 第二步迁移方案预留：任务状态和取消标志入 Redis/数据库，任意实例都能接续订阅；模型生成 worker 与接口进程分离。
- [ ] 在迁移真正完成前，不宣称支持多实例水平扩容。
- [ ] 测试错误 worker 配置会被阻止，单进程模式取消、恢复和事件续传正常。

**Commit**

`fix: 固化后台运行的受支持部署模式`

## Task 19：移除面试服务中的不可达旧语音实现

**Files**

- Modify: `backend/app/interview/service.py`
- Modify: `backend/app/interview/voice_service.py`
- Delete after verification: `backend/app/interview/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_voice_service_characterization.py`
- Create: `backend/tests/test_interview_route_inventory.py`

**问题**

`interview/service.py` 的 `_infer_audio_format`、`_transcribe_voice_audio_sync`、`voice_submit_turn` 和 `voice_submit_turn_sync` 在返回之后仍保留大段旧实现，实际永远不会执行。仓库还有未挂载的旧 `interview/router.py`。两套实现会误导维护者，也让安全修复容易改到“看起来对、实际没运行”的代码。

**Steps**

- [ ] 先为当前真正生效的 `voice_service.py` 补行为测试：格式识别、体积上限、转写失败、幂等提交、事件顺序。
- [ ] 用路由清单测试确认生产只挂载 `router_student.py` 的预期入口。
- [ ] 删除四个函数 `return` 后的不可达旧代码，不同时改变现行行为。
- [ ] 对未挂载旧路由逐项做能力对照；已被新路由覆盖后删除文件，若有唯一能力则先迁移再删除。
- [ ] 统一音频校验只由 `voice_service.py` 承担，服务层不重复猜格式和大小。
- [ ] 跑面试全套测试和端到端语音替身测试，比较事件顺序与页面状态。

**Validation**

- [ ] `cd backend && python -m pytest tests/test_voice_service_characterization.py tests/test_interview_route_inventory.py -v`
- [ ] `cd frontend && npx playwright test e2e/interview*.spec.ts`
- [ ] 后端静态检查不再报告这些不可达块。

**Commit**

`refactor: 移除面试语音旧实现与废弃路由`

---

# 第四阶段：页面质量、可见记忆与自动门禁

## Task 20：先清零前端检查，再建立后端分级检查

**Files**

- Modify: `frontend/src/resume/ResumeEditorPage.tsx`
- Modify: `frontend/src/resume/api.ts`
- Modify: `frontend/src/resume/components/AiAssistPanel.tsx`
- Modify: `frontend/src/resume/components/RichTextEditor.tsx`
- Modify: `frontend/src/resume/templates/registry.tsx`
- Modify: `frontend/src/student/AgentChatView.tsx`
- Modify: `frontend/src/student/InterviewHistoryDrawer.tsx`
- Modify: `frontend/src/student/InterviewReportPage.tsx`
- Modify: `frontend/src/student/StudentHomePage.tsx`
- Create: `backend/pyproject.toml`
- Create: `.editorconfig`
- Create: `scripts/check_encoding.py`

**问题**

前端检查当前有 20 个错误和 3 个警告；包括任意类型、在页面同步阶段改状态、缺依赖、只允许组件导出的规则、无效规则名、BOM 和一条孤立的“正在生成 PDF”表达式。后端静态检查有 250 项，若一次性自动修会制造巨大风险。

**Steps**

- [ ] 删除 `ResumeEditorPage.tsx` 中孤立的 `('正在生成 PDF...')`，为 PDF 数据补真实类型。
- [ ] 清理 `resume/api.ts` 的 `any`、BOM 和手工拼接凭证；新增支持进度、自动续期的统一上传请求，不退回裸请求。
- [ ] 把 `AiAssistPanel`、历史抽屉、报告页中“页面同步阶段立刻改状态”的逻辑改为事件驱动或派生值。
- [ ] 修复 React 依赖警告，确保回调引用稳定且不会捕获旧会话。
- [ ] 把模板注册数据和组件导出拆到不同文件；安装并正确配置需要的 React 规则，或删除不存在的规则注释。
- [ ] 前端达到 0 error、0 warning，随后把警告也设为失败。
- [ ] 增加 `.editorconfig` 固定 UTF-8、LF、结尾换行；编码脚本拦截 BOM、替换字符和项目中已知的 `????` 乱码。
- [ ] 后端先修会影响正确性的高信号项：重复字典键、重复定义、未定义名称、不可达代码。
- [ ] 再按业务包逐批修未使用导入和格式；每批都跑对应测试，禁止全仓盲目自动修复。
- [ ] 最终把后端静态检查加入门禁；复杂度和函数长度先作报告，不立即阻止合并。

**Validation**

- [ ] `cd frontend && npm run lint -- --max-warnings=0`
- [ ] `cd frontend && npm run build`
- [ ] `cd backend && ruff check app tests`
- [ ] `python scripts/check_encoding.py`
- [ ] `cd backend && python -m pytest tests/ -v`

**Commit sequence**

1. `fix: 清零前端代码检查问题`
2. `chore: 增加编码与后端静态检查`
3. 按后端业务包分别提交，避免单个巨大格式提交。

## Task 21：修复无效页面结构并补聊天可访问性

**Files**

- Modify: `frontend/src/student/AnalysisPage.tsx`
- Modify: `frontend/src/student/AgentChatView.tsx`
- Modify: `frontend/src/student/AIInterviewerPage.tsx`
- Create: `frontend/e2e/accessibility.spec.ts`
- Modify: `frontend/playwright.config.ts`

**问题**

分析页把 Arco `Tag` 产生的块元素放进段落元素，浏览器会自动纠正页面结构并产生水合警告。聊天图片预览主要靠鼠标点击，缺少对话框语义、Escape 关闭、焦点管理和键盘操作。

**Steps**

- [ ] 把分析页标签所在容器改为合法的 `div`/内联布局，不让块元素嵌套在段落内。
- [ ] 图片缩略图使用可聚焦按钮或补完整键盘语义，Enter/Space 可打开。
- [ ] 大图预览具备对话框标题、焦点圈定、Escape 关闭、关闭后焦点回到原图。
- [ ] 所有仅图标按钮补可读名称；生成中、上传中和错误状态由屏幕阅读器可感知。
- [ ] 面试录音按钮明确宣布“录音中/正在转写/提交失败”。
- [ ] 端到端测试收集控制台错误并默认失败；对 React 19 + Arco 已知 `element.ref` 警告建立带删除日期的临时白名单。
- [ ] 加入键盘完整走通：登录后选择简历、发消息、打开预览、关闭预览、进入面试。

**Validation**

- [ ] `cd frontend && npx playwright test e2e/accessibility.spec.ts`
- [ ] 控制台不再出现 `<div>` 嵌套 `<p>` 错误。
- [ ] 只用键盘能完成核心操作，焦点位置可见且顺序合理。

**Commit**

`fix: 修复页面结构与聊天键盘体验`

## Task 22：把“AI 记住的内容”做成学生可见、可改、可删

**Files**

- Modify: `backend/app/student/router.py`
- Modify: `backend/app/student/agent_runtime.py`
- Create: `frontend/src/student/SessionMemoryPanel.tsx`
- Modify: `frontend/src/student/AgentChatView.tsx`
- Create: `backend/tests/test_session_memory_visibility.py`
- Create: `frontend/e2e/session-memory.spec.ts`

**问题**

后端已经有会话记忆和更新入口，模型也能保存约束、事实和偏好，但前端没有可发现的查看/删除入口。这违反“记忆对用户透明”的体验红线：学生不知道 AI 记住了什么，也无法修正过期资料。

**Steps**

- [ ] 后端用结构化字段返回 `constraints`、`facts`、`preferences`，不让页面解析原始 JSON 字符串。
- [ ] 每条记忆带来源、创建时间和适用会话；不要把模型内部推理或系统提示暴露给用户。
- [ ] 聊天页面增加“AI 记住的内容”面板，用普通语言区分约束、事实和偏好。
- [ ] 支持单条编辑、单条删除和全部清空；操作前后都有明确反馈。
- [ ] 删除或修改后同步更新证据池，下一轮消息立即使用新值。
- [ ] 模型保存新记忆时在页面给轻量提示，不打断生成；用户可以直接撤销。
- [ ] 敏感信息默认不自动记忆，或先征得用户确认；至少对身份证、电话、邮箱等做拦截。

**Tests**

- [ ] 模型保存偏好后面板可见，下一轮使用该偏好。
- [ ] 用户删除事实后下一轮不再引用。
- [ ] A 会话记忆不会出现在 B 会话。
- [ ] 非法记忆结构不会让聊天页崩溃。

**Commit**

`feat: 增加可管理的会话记忆面板`

## Task 23：建立覆盖核心剧本的一键验证与自动流水线

**Files**

- Create: `scripts/verify.sh`
- Create: `.github/workflows/verify.yml`
- Modify: `frontend/playwright.config.ts`
- Create: `frontend/e2e/resume-assistant.spec.ts`
- Create: `frontend/e2e/resume-editor.spec.ts`
- Create: `frontend/e2e/auth.spec.ts`
- Create: `backend/tests/integration/test_mysql_redis_smoke.py`
- Modify: `README.md`

**问题**

当前没有自动流水线。后端测试很多，但简历助手“选择工作简历 → 发消息 → AI 调工具 → 活动胶囊 → 简历落地 → 撤销”没有前端自动覆盖。现有面试测试也没有把意外控制台错误当失败。

**Steps**

- [ ] `scripts/verify.sh` 作为唯一入口，依次检查 Python 版本、后端静态检查、后端测试、迁移单一 head、空库升级、前端检查、构建、端到端测试、依赖审计和 Compose 配置。
- [ ] 脚本默认遇错停止，最后给出清晰分项结果；支持 `--quick` 仅跑受影响检查，但合并门禁必须跑全量。
- [ ] 端到端测试通过本地假模型或固定 SSE 剧本运行，不依赖真实收费模型，也不受模型输出随机性影响。
- [ ] 新增简历助手主剧本：首次惰性建会话、选择工作简历、流式增量、工具活动、更新简历、精确撤销。
- [ ] 新增编辑器剧本：手工修改、单项 AI 建议、版本冲突、PDF 导出。
- [ ] 新增登录剧本：注册验证码替身、登录、续期、退出、角色保护。
- [ ] 自动流水线使用 Python 3.11 和项目 Node 版本；缓存只加速依赖，不缓存测试数据库状态。
- [ ] 合并门禁跑 SQLite 快速套件；另设 MySQL + Redis 集成任务验证锁、时间和 SQL 方言差异。
- [ ] 每日或发布前任务运行完整浏览器矩阵、依赖审计和镜像启动冒烟。
- [ ] 文档写明失败定位方式，不要求非技术负责人阅读原始长日志。

**Validation**

- [ ] 本地 `bash scripts/verify.sh` 全绿。
- [ ] 故意制造一个前端类型错误、两个迁移 head 和一个控制台错误，流水线分别能拦截。
- [ ] 恢复代码后流水线全绿。

**Commit**

`ci: 增加全项目一键验证与核心剧本`

---

# 第五阶段：可观测性、性能与结构治理

## Task 24：增加请求编号、结构化日志和用户体验指标

**Files**

- Create: `backend/app/core/request_context.py`
- Create: `backend/app/core/logging.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/student/run_manager.py`
- Modify: `backend/app/student/agent_runtime.py`
- Modify: `backend/app/interview/service.py`
- Modify: `frontend/src/shared/api.ts`
- Modify: `frontend/src/shared/ErrorBoundary.tsx`
- Create: `docs/operations/observability.md`
- Create: `backend/tests/test_log_redaction.py`

**问题**

当前页面错误边界主要写控制台，后端也缺少统一请求编号和结构化字段。出现“用户一直转圈”“回答断了”“模型没改简历”时，很难把一次页面操作、一次后台运行和一次模型调用串起来，也无法知道问题是个例还是趋势。

**Steps**

- [ ] 每次页面请求生成或接收 `request_id`，后台运行额外有 `run_id`；所有相关日志和错误返回携带编号。
- [ ] 日志使用结构化字段：业务入口、耗时、状态、模型提供方、工具名、事件数量、重连次数；不记录完整简历、回答正文和密钥。
- [ ] 建立统一脱敏器，覆盖凭证、邮件、手机号、身份证、模型密钥和上传文件内容。
- [ ] 前端错误边界上报页面、版本、请求编号和安全摘要，用户只看到“可重试 + 问题编号”。
- [ ] 监控关键体验：首个文字等待时间、整轮完成时间、SSE 重连成功率、事实校验阻止率、版本冲突、面试备用恢复率、上传失败率、邮件失败率。
- [ ] 监控资源：活跃运行、排队长度、事件表增长、附件空间、数据库连接、Redis 可用性。
- [ ] 为告警设可行动阈值和负责人，避免“所有错误都报警”导致失去意义。
- [ ] 建立一次故障演练：模型超时、Redis 暂停、邮件失败，确认页面提示和告警都符合预期。

**Validation**

- [ ] 任意一次失败可用页面问题编号查到完整安全链路。
- [ ] `test_log_redaction.py` 断言日志不包含测试密钥、完整邮箱、简历正文和 Authorization。
- [ ] 仪表盘能区分模型慢、网络断线、数据库失败和用户主动取消。

**Commit**

`feat: 增加端到端请求追踪与体验指标`

## Task 25：降低首屏体积并建立性能预算

**Files**

- Modify: `frontend/src/App.tsx`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/src/student/StudentHomePage.tsx`
- Create: `scripts/check_bundle_budget.mjs`
- Create: `docs/operations/frontend-performance.md`

**问题**

前端主文件约 1.91 MB，压缩后约 551 KB。管理端、面试报告、富文本编辑器、PDF 能力和学生聊天有较多代码被提前装入；构建还提示部分动态加载没有真正形成独立分包。

**Steps**

- [ ] 先生成构建分析，按真实占比分出路由代码、Arco、编辑器、PDF 和图表等大块。
- [ ] 管理端、AI 面试、简历编辑器、报告页按路由懒加载；学生首页只加载当前入口所需内容。
- [ ] PDF 导出库只在点击导出时加载，富文本编辑能力只在进入编辑器时加载。
- [ ] 修复“同时静态和动态导入”导致分包无效的问题。
- [ ] 在 Vite 中建立稳定手工分组，避免一个公共包囊括所有重量级能力。
- [ ] 删除确认未使用的前端生产依赖和图标导入。
- [ ] 给主入口设置体积预算，并记录低端设备/普通校园网下的首屏、可交互和聊天打开时间。
- [ ] 懒加载期间使用与页面布局一致的骨架，不出现空白闪烁。

**Validation**

- [ ] `cd frontend && npm run build`
- [ ] `node scripts/check_bundle_budget.mjs`
- [ ] 首页不下载 PDF、管理端和面试报告代码。
- [ ] 在模拟慢速网络下，入口可理解状态出现更快且无功能退化。

**Commit**

`perf: 按业务页面拆分前端资源`

## Task 26：拆分简历助手后端巨型运行时

**Files**

- Modify: `backend/app/student/agent_runtime.py`
- Create: `backend/app/student/runtime/orchestrator.py`
- Create: `backend/app/student/runtime/context_builder.py`
- Create: `backend/app/student/runtime/tool_registry.py`
- Create: `backend/app/student/runtime/tool_dispatcher.py`
- Create: `backend/app/student/runtime/resume_tools.py`
- Create: `backend/app/student/runtime/memory_tools.py`
- Create: `backend/app/student/runtime/export_tools.py`
- Create: `backend/app/student/runtime/model_adapters.py`
- Create: `backend/tests/test_agent_runtime_characterization.py`

**问题**

一个 6,000 行文件同时承担模型适配、上下文、工具定义、工具执行、事实校验、质量闸门、记忆和导出。直接继续堆功能会让任何小改动都需要理解整条链路，也容易遗漏“工具定义、派发、前端显示”的同步点。

**Steps**

- [ ] 先增加黑盒保护测试，固定不同思考档位、工具选择、事件顺序、版本冲突、事实阻止、记忆写入和达到迭代上限时的现有行为。
- [ ] 第一批只移动纯函数：模型思考档位和请求参数到 `model_adapters.py`，保持公开函数签名。
- [ ] 第二批移动上下文组装，测试 pinned 记忆、摘要边界和最近消息截断完全一致。
- [ ] 第三批建立工具注册表，让工具定义、执行函数、页面展示类别有可机器校验的单一清单。
- [ ] 按简历、记忆、导出拆工具执行；每移动一个工具跑其单测和核心剧本。
- [ ] 最后让 `orchestrator.py` 只负责循环：请求模型、执行工具、回灌结果、发事件和终止。
- [ ] 保留 `agent_runtime.py` 兼容导出一段时间，逐步迁移调用方，不做一次性全仓改名。
- [ ] 为新增工具建立自动测试：注册但未派发、派发但未标前端类别时直接失败。

**Validation**

- [ ] 全量后端测试和简历助手 E2E 全绿。
- [ ] 同一固定模型剧本在拆分前后产生相同事件序列和最终简历。
- [ ] 主编排文件显著缩小且不包含具体 PDF/记忆/简历写入实现。

**Commit sequence**

1. `test: 固化简历助手运行时行为`
2. `refactor: 拆分模型适配与上下文组装`
3. `refactor: 建立统一工具注册与派发`
4. `refactor: 精简简历助手主循环`

## Task 27：拆分面试流程和前端巨型页面

**Files**

- Modify: `backend/app/interview/service.py`
- Create: `backend/app/interview/session_service.py`
- Create: `backend/app/interview/turn_service.py`
- Create: `backend/app/interview/report_service.py`
- Modify: `frontend/src/student/AIInterviewerPage.tsx`
- Create: `frontend/src/student/interview/InterviewSetup.tsx`
- Create: `frontend/src/student/interview/InterviewRoom.tsx`
- Create: `frontend/src/student/interview/VoiceAnswer.tsx`
- Create: `frontend/src/student/interview/InterviewRecovery.ts`
- Modify: `frontend/src/student/ProfilePage.tsx`
- Modify: `frontend/src/admin/AdminHomePage.tsx`

**问题**

面试服务和几个前端页面超过两千到三千行。建立面试、答题、评分、语音、报告、个人档案各区块和管理端各模块互相牵连，导致修改一个按钮也可能影响断线恢复或其他页面。

**Steps**

- [ ] 先为面试 8 个阶段、追问、压力面试、反问、收尾和报告生成建立状态机保护测试。
- [ ] 后端按“建立面试、提交一轮、生成报告”拆服务，`service.py` 保留兼容门面。
- [ ] Harness 继续独立负责校验，不把评分规则复制到新服务。
- [ ] 前端先抽纯展示区，再抽建立页、面试房间、语音回答和恢复逻辑；共享状态保持单一来源。
- [ ] `ProfilePage` 按个人信息、教育、经历、荣誉、证书、技能拆区块，每区块独立保存和错误提示。
- [ ] `AdminHomePage` 按模型、Skill、MCP、路由和反馈拆模块，页面只负责导航和布局。
- [ ] 每一次拆分只搬一个职责，不同时换视觉设计或业务规则。
- [ ] 比较拆分前后截图、接口次数、事件顺序和键盘路径。

**Validation**

- [ ] 后端面试全套测试与前端面试 E2E 全绿。
- [ ] 个人档案所有日期、空值和保存失败场景回归通过。
- [ ] 管理端模型、Skill、MCP、路由与反馈操作回归通过。

**Commit sequence**

1. `test: 固化面试与大型页面现有行为`
2. `refactor: 按面试生命周期拆分服务`
3. `refactor: 拆分面试页面职责`
4. `refactor: 拆分个人档案与管理端模块`

## Task 28：评估更安全的浏览器会话保存方式

**Files**

- Modify: `backend/app/auth/router.py`
- Modify: `backend/app/auth/service.py`
- Modify: `backend/app/core/security.py`
- Modify: `frontend/src/shared/authSession.ts`
- Modify: `frontend/src/shared/api.ts`
- Create: `backend/tests/test_refresh_cookie.py`
- Create: `frontend/e2e/auth-cookie.spec.ts`
- Create: `docs/architecture/auth-cookie-migration.md`

**问题**

现有访问和刷新凭证都保存在浏览器可读取存储中；若页面将来出现脚本注入，刷新凭证也可能被取走。Task 4、5、7、8 会先显著降低风险，本任务是稳定后再做的较大迁移，不应和上线前修复混在一起。

**Steps**

- [ ] 设计刷新凭证使用 `Secure + HttpOnly + SameSite` Cookie，访问凭证只保存在内存。
- [ ] 明确本地开发、HTTPS 生产、跨来源登录和 SSO 的 Cookie 行为。
- [ ] 增加 CSRF 防护并限制续期、退出等会改变会话的请求来源。
- [ ] 设计旧本地存储会话的一次性平滑迁移和强制失效日期。
- [ ] 保持多标签页登录/退出同步，不在前端暴露刷新凭证。
- [ ] 灰度期间监控续期失败率和重复登录率，超过阈值可回滚到 Task 8 的稳定实现。
- [ ] 删除旧存储前先确认所有端到端、SSO 和移动浏览器测试通过。

**Commit**

`refactor: 将刷新凭证迁移到安全 Cookie`

---

# 7. 扫描发现与任务映射

| 编号 | 发现 | 风险 | 对应任务 |
|---|---|---|---|
| F01 | 产品、端口、迁移和面试架构文档互相矛盾 | 误部署、误修改 | Task 1 |
| F02 | 本地 Python 3.9 与容器 3.11 不一致 | 本地无法可靠启动 | Task 2 |
| F03 | 后端依赖未锁定且本地审计有多项漏洞 | 安全与不可复现 | Task 2 |
| F04 | 未使用的 `html2pdf.js` 和旧 `jspdf` 有严重漏洞 | PDF/页面安全 | Task 3 |
| F05 | 图片上传只看后缀或不限制大小 | 资源耗尽、脚本伪装 | Task 4 |
| F06 | 反馈截图公开静态访问 | 隐私泄露 | Task 4、5 |
| F07 | Nginx 缺少 CSP、nosniff 等边界 | 页面攻击面扩大 | Task 5 |
| F08 | 生产发信缺配置会退回开发方式 | 验证码泄露、假成功 | Task 6 |
| F09 | 生产关键密钥和环境值缺严格校验 | 带错误配置上线 | Task 6 |
| F10 | 模型平台密钥写入普通路由 JSON | 密钥扩散 | Task 7 |
| F11 | 启动登录续期可能把旧访问凭证写回 | 随机掉线 | Task 8 |
| F12 | 多处重复实现续期和登录失效 | 状态不一致 | Task 8 |
| F13 | SSE 重试计数可被反复清零，网络异常路径不一致 | 无限转圈或过早失败 | Task 9 |
| F14 | 会话草稿和未发送附件未按会话保存 | 用户输入丢失 | Task 10 |
| F15 | 快速切换时旧详情响应覆盖新会话 | 串会话错觉 | Task 11 |
| F16 | 历史和会话列表缺分页，`limit=0` 无效 | 长期变慢 | Task 11 |
| F17 | 撤销缺精确快照时会取最新快照 | 撤错用户内容 | Task 12 |
| F18 | 撤销后右侧预览可能不刷新 | 用户不信任结果 | Task 12 |
| F19 | 面试流式与备用提交使用不同请求编号 | 已成功却提示失败 | Task 13 |
| F20 | 单项 AI 辅助未校验简历归属和事实 | 编造业绩、越权定位 | Task 14 |
| F21 | 启动时直接建反馈表 | 数据结构不可控 | Task 15 |
| F22 | 错误响应格式不一并暴露路径/堆栈 | 页面难处理、内部泄露 | Task 16 |
| F23 | 运行事件、登录记录和附件无保留策略 | 数据持续膨胀 | Task 17 |
| F24 | 删除方式与“全部软删除”文档冲突 | 误删或无限保留 | Task 17 |
| F25 | 内存运行管理器与多 worker 默认值冲突 | 无法取消或接续运行 | Task 18 |
| F26 | 面试服务存在大段 return 后旧代码和废弃路由 | 修错代码、维护困难 | Task 19 |
| F27 | 前端检查 20 错误、3 警告 | 回归无门禁 | Task 20 |
| F28 | 后端静态检查 250 项，含重复键和重复定义 | 隐藏正确性风险 | Task 20 |
| F29 | 多处 BOM、乱码提示和乱码接口说明 | 用户与文档体验差 | Task 20 |
| F30 | 分析页存在无效 DOM 嵌套 | 浏览器纠正、水合警告 | Task 21 |
| F31 | 图片预览和录音状态键盘/读屏体验不足 | 可访问性差 | Task 21 |
| F32 | 会话记忆后端存在但用户不可见不可删 | 违反透明记忆原则 | Task 22 |
| F33 | 无自动流水线，简历助手核心链路无 E2E | 合并后才发现回归 | Task 23 |
| F34 | 缺请求编号、错误上报和体验指标 | 线上问题难定位 | Task 24 |
| F35 | 前端主包约 1.91 MB，动态加载部分失效 | 首屏偏慢 | Task 25 |
| F36 | 多个核心文件 2,000～6,000 行 | 修改风险持续升高 | Task 26、27 |
| F37 | 刷新凭证保存在浏览器可读取存储 | XSS 后会话风险 | Task 28 |

## 8. 明确不作为问题处理的事项

- 不把当前项目描述为跨校产品，也不为不存在的学校隔离体验增加页面和流程。
- 不擅自删除 `tenant_id`；这属于单独的数据模型决策，当前收益不足以覆盖迁移风险。
- 不擅自移除负责人明确接受入库的部署配置文件。
- 不把 React 19 + Arco 已知 `element.ref` 警告当作业务故障；先临时白名单，依赖升级后移除。
- 不因为文件大就一次性重写；所有拆分都排在正确性、安全性和保护测试之后。
- 不在 `message.completed` 或 `done` 之前增加新的慢模型调用，以免恢复“页面一直转圈”的体验。
- 不把“所有数据永久软删除”当作天然正确；按 Task 17 的业务价值和恢复期限分别设计。

## 9. 推荐执行批次与发布门槛

### 批次 A：上线阻断项

完成 Task 1～9、12～16。发布门槛：

- 依赖没有未豁免的严重生产漏洞。
- 生产缺关键配置会拒绝启动，验证码和模型密钥不会进入日志/响应/普通字段。
- 登录续期、SSE 断线、撤销和面试重复提交测试全绿。
- 图片伪装、超限图片和未授权反馈附件读取测试全绿。

### 批次 B：用户信任与长期稳定

完成 Task 10～11、17～23。发布门槛：

- 草稿不会因切换会话丢失，旧请求不会覆盖新页面。
- 历史分页、事件清理和单进程部署约束明确。
- 前后端检查、构建、迁移、核心 E2E 可由一条命令完成并接入合并门禁。
- AI 记忆对学生可见、可改、可删。

### 批次 C：运行效率与可维护性

完成 Task 24～28。发布门槛：

- 线上问题能通过问题编号追踪，关键体验有指标。
- 首屏达到设定体积预算。
- 巨型文件拆分前后行为对比一致。
- Cookie 会话迁移有灰度和回滚方案。

## 10. 每个任务通用验收清单

- [ ] 先写失败测试，确认测试确实能抓住原问题。
- [ ] 修改范围只覆盖当前任务，不顺手重写无关代码。
- [ ] 前端通过 `npm run build` 和 `npm run lint -- --max-warnings=0`。
- [ ] 后端通过受影响测试；合并前再跑 `python -m pytest tests/ -v`。
- [ ] 迁移任务确认只有一个 head，并在空 SQLite 与 MySQL 集成环境升级。
- [ ] 涉及 SSE 时验证断线续传、重复事件和页面卸载。
- [ ] 涉及简历写入时验证重新读取、版本检查、快照和精确撤销。
- [ ] 涉及文件时验证体积、真实格式、权限、清理和错误提示。
- [ ] 涉及日志时用测试密钥、邮箱和简历内容检查脱敏。
- [ ] 用学生可理解的语言检查成功、失败、等待和恢复提示。
- [ ] 更新对应文档和回滚说明。
- [ ] 一个任务一个中文提交；大重构按计划中的提交序列拆分。

## 11. 完成定义

只有同时满足以下条件，才算这轮全项目改进真正完成：

1. 扫描表 F01～F37 均已完成、被负责人明确接受为例外，或被新的证据证明不再成立。
2. `scripts/verify.sh` 在干净环境全绿，自动流水线使用同一命令全绿。
3. 注册/登录、简历助手、简历编辑、PDF 导出、AI 面试、管理端主路径都有自动剧本。
4. 生产配置错误会在上线前暴露，而不是等用户操作后才失败。
5. 学生在断网、续期、切会话、撤销和重复提交时不会丢内容或看到与服务器相反的状态。
6. 密钥、验证码、异常堆栈、服务器路径和反馈私密附件不会出现在不应出现的位置。
7. 数据和文件有可执行的保留、恢复和清理策略。
8. 文档描述与实际产品、端口、流程、迁移和测试一致。

## 12. 计划自检

- 已按当前代码而非旧文档判断产品结构。
- 已排除本轮之前已经修好的安全与体验项。
- 已尊重“单管理员 + 学生端”和部署配置入库的明确决定。
- 已把每个发现映射到具体任务，没有只给泛泛建议。
- 已给出文件、步骤、验证和提交方式，可由后续编码代理逐项执行。
- 已把高风险正确性修复放在大规模重构之前。
- 已避免新增跨校、复杂组织体系等超出当前业务范围的需求。
