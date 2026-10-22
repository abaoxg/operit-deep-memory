# deep_memory · 深度记忆 🧠

六边形长期记忆插件（Operit ToolPkg）。AI 可像人一样长期记住事实/偏好/事件/关系/想法/任务，跨对话不丢失。

**v1.1.0 起接入 AI 语义判定**：不再只靠固定句式正则，而是由**当前对话模型自己判断**「这句话里有没有值得长期记住的东西」，自动判定类型/重要性/敏感/空间。零外部依赖，**不需要任何 API Key**。

## AI 智能记忆（v1.1.0 新增）

| 项 | 说明 |
|----|------|
| 调用通道 | `Tools.Chat.call({functionType, turns})` → 主通道 `MEMORY`，失败自动降级 `CHAT` |
| 零 API Key | 直接用宿主已配置的模型，不额外付费、不额外配置 |
| 语义判定 | 8 类「应该记住」（身份/账号/稳定偏好/关系/长期目标/显式要求/AI 长期设定/项目设备事实）+ 6 类「不应记住」（寒暄/一次性请求/即时报错/代码日志/重复信息/明确不用记） |
| 自动打标 | AI 直接给出 `type/importance/sensitive/space`，不用事后猜 |
| 失败兜底 | AI 不可用/返回非法 JSON/超时 → 自动落回原正则提取，功能不中断 |
| 成本控制 | 消息过短、纯寒暄、含代码块、超 4000 字 → 本地直接跳过，不浪费模型调用；每小时配额默认 60 次 |
| 面板可控 | 设置页可开关、可调最短字数/每小时上限/单条最多条数，并有「AI 自检」「查看AI日志」两个按钮 |

### 双通道触发

| 通道 | 钩子 | 说明 |
|------|------|------|
| 主通道 | `registerChatMessageHook` | 消息落库后触发，稳定不易漏；只处理 `sender=user/human`，AI 自己的回复不参与提取 |
| 兼容通道 | `registerMessageProcessingPlugin` | 部分宿主版本不下发，保留作兜底 |

两条通道用 `chatId|content` 做 5 分钟去重，同一句话只调一次模型。

## 六边形能力

| 维度 | 能力 | 工具 |
|------|------|------|
| 📝 记忆写入 | 6 类型记忆 + 自动标签 + 相似去重合并 + 重要性分级 + 过期/置顶 + 空间 + 敏感加密 | `dm_remember` |
| 🔍 智能检索 | 中文分词关键词 + 类型/标签/时间/空间过滤 + 5 种排序 + 时间衰减 + 可选语义重排(Embedding) | `dm_recall` |
| 🧠 关联图谱 | 双向手动关联 + 共享标签自动建议 | `dm_link` / `dm_unlink` |
| ⏰ 遗忘曲线 | 艾宾浩斯复习队列（间隔指数增长）+ 健康度评分 + 到期/过期提醒 | `dm_review` |
| 📊 统计洞察 | 类型分布/标签云/今日本周新增/平均健康度/活跃排行 + Markdown 报告 | `dm_stats` / `dm_report` |
| 📄 纯白纯文字 UI | 工具箱六屏面板：纯白背景 + 纯文字排版，极简干净 | 工具箱入口 |

## 通用记忆 / 单独记忆（注入范围）

| 开关 | 说明 |
|------|------|
| 通用记忆 | 所有记忆全局共享，任何对话框都能看到/注入（chatId 为空的记忆） |
| 单独记忆 | 只属于某个对话框（chatId 归属），其他对话看不到、不注入 |
| 自动提取存入单独记忆 | 开=自动提取的记忆归当前对话框；关=存为通用记忆（默认） |

- 写入：`dm_remember(chatId="对话框ID")` = 单独记忆；不传 = 通用记忆
- 检索：`dm_recall(chatId=...)` 含该对话框单独记忆；`allChats=true` 含全部；默认仅通用
- 注入：当前对话框自动包含「通用记忆 + 本对话单独记忆」（由 SystemPromptCompose 的 chatId 识别）

## 注入预算（v1.1.0 修复）

原实现有三个缺陷，已全部修掉并用单测锁住：

1. `injectCount` 只约束「候选填充」，置顶记忆 + 到期复习项可无上限挤入 → 现在三条路径统一受 `cap` 约束
2. 置顶记忆无开关、无上限 → 新增 `injectPinnedAlways`，关掉即不优先占位
3. 预算硬编码 1200 字符 → 改为读 `injectBudgetChars`（默认 1600），预算不够时先按上限扩容重排一次，仍装不下才提示「另有 N 条未显示」

## 省钱引擎（省 token / 省 API 费）

| 开关 | 说明 | 效果 |
|------|------|------|
| 注入压缩 | 条数 3、内容 80 字、标签 2 个、精简格式 | 单次注入从 ~300 token 降至 ~100 token（省 2/3） |
| 缓存友好注入 | 注入文本稳定 + 缓存文件复用（`injection_cache.json`） | 配合 DeepSeek 等前缀缓存，重复部分按缓存价计费（≈1/10） |
| 冷热分级 | 热记忆（30 天内访问）全量注入，冷记忆仅一行标题 | 记忆多时显著省 token |
| 自动清理过期 | 过期 N 天后自动删除（默认 7 天，有备份兜底） | 省存储与扫描开销 |
| 省钱统计 | `dm_stats` 显示单次注入 token 估算 + 低健康度清理建议 | 看得见的省钱 |

## 好用增强

- **重要日期提醒**：生日/纪念日提前 7 天注入"📅 N 天后"（AI 主动祝贺）
- **快捷遗忘**：对话说"忘了关于 X 的事"自动删除，无需显式调工具
- **AI 语义自动记忆**：任意自然语句都可能被写入（"我是做网络运维的"），不再要求特定句式
- **记忆冲突检测**：同主题关键值不一致时自动提醒（不覆盖旧记忆）
- **到期/过期提醒**：注入"⏰今日到期/⚠️已过期"
- **记忆空间隔离**：general/工作/生活/学习 多空间，AI 自动判断该进哪个
- **敏感加密存储**：`sensitive=true` 内容加密落盘（🔒 标记）
- **自动备份**：每次写入备份至 `backup/`（保留 20 份）
- **可选语义检索**：配置 Embedding API 后按语义余弦相似度重排
- **系统提示词注入**：按空间注入高价值记忆 + 冲突/到期/日期标注
- **XML 渲染**：AI 回复 `<memory_card id="xxx"/>` 自动渲染

## 工具清单（14 个）

`dm_remember` `dm_recall` `dm_forget` `dm_update` `dm_link` `dm_unlink` `dm_review` `dm_stats` `dm_options` `dm_export` `dm_import` `dm_report` `dm_extract` `dm_conflicts`

## 数据位置

`/sdcard/Download/Operit/plugins/com.operit.deep_memory/`
- `memories.json` 记忆库（上限 5000 条，敏感项加密）
- `settings.json` 引擎设置（自动提取/冲突/提醒/空间/加密密钥/Embedding/AI 判定）
- `ai_state.json` AI 调用统计与配额（每小时计数、成功/跳过/失败数、最近结果）
- `ai_extract.log` AI 判定日志（环形保留 200 行）
- `backup/` 自动备份（最近 20 份）

## 排障

| 现象 | 处理 |
|------|------|
| 面板「AI 自检」显示调用失败 | 先看错误串：`Invalid function_type` = 宿主没有独立 MEMORY 模型，代码会自动降级 CHAT；其他超时/中断多为模型侧问题 |
| 自检通过但聊天不写入 | 确认设置页「对话自动记忆」与「AI 智能判定」都开；再看「查看AI日志」有没有 `chatmsg 触发` 记录 |
| 完全没有 `chatmsg` 记录 | 宿主版本不支持 `registerChatMessageHook`，此时只剩 msgproc 通道，日志里会有「宿主不支持」提示 |
| 返回不是合法 JSON | 模型输出被思考内容带偏，关掉「启用思考」再试 |
| 改完插件不生效 | 必须重启 Operit（插件 JS 在启动时加载并缓存） |

## 入口位置

| 入口 | 位置 | 说明 |
|------|------|------|
| 工具箱 | 工具箱 → 深度记忆 | 六屏面板（总览/搜索/时间线/图谱/复习/设置） |
| 侧边栏 | 侧边栏 → 插件 → 深度记忆 | 同一面板直达，v1.1.1 新增 |

## 二次开发

- 源码在 `src/`（TypeScript），编译产物在 `dist/`
- 编译：`tsc -p tsconfig.json`（types 在 `../types`）
- 打包：用 Python `zipfile` 打进 manifest.json / README.md / tsconfig.json / dist / src
- 本地单测（不用装进 app）：`node test_ai_extract.js` / `node test_injection.js` / `node test_integration.js`
- 部署：将 `.toolpkg` 放入 `Android/data/com.ai.assistance.operit/files/packages/` 后发广播
  `am broadcast -a com.ai.assistance.operit.DEBUG_INSTALL_TOOLPKG -n com.ai.assistance.operit/.core.tools.packTool.ToolPkgDebugInstallReceiver --es package_name com.operit.deep_memory --es file_path <toolpkg路径> --ez reset_subpackage_states true`

## 发布到 GitHub
仓库：`abaoxg/operit-deep-memory`（公开，github.com HTTPS 在这台机器上被墙，但 `api.github.com` 正常）

```bash
export GH_TOKEN=<token>

# 1. 源码同步（Git Data API：逐 blob 上传 + base_tree 建树 + 一次提交，原子生效）
node sync_github.js "feat: v1.1.3 —— 修主通道静默失效"

# 2. 安装包发版（tag 已存在则复用，同名资产先删再传，天然幂等）
node release.js
```

`sync_github.js` 注意点：
- **推送前自动跑隐私闸门**（见下节），不通过直接 `exit 1`，不会推上去任何东西
- 用 `base_tree` 建树，**只覆盖有差异的文件，远端其他文件保留**，不会误删历史目录（`patches/`、`verify/`、`docs/`）
- 判断是否要传用的是 `git blob sha1`（`sha1("blob <len>\0" + content)`），不是普通 sha1，否则所有文件都会被判定为「有差异」
- 中途失败时分支指针不动，远端保持原样，重跑即可

## 隐私闸门（`privacy_check.js`）

公开仓库一旦推错了内容，删掉再推是**无效**的 —— 旧 commit 仍可通过 URL 访问，必须删仓库重建才能让旧对象失效。所以把「记得检查」换成强制闸门：`sync_github.js` 入口处调用，`exit 1` 即中断，不发一个字节。

检查三类：

1. **硬模式匹配**：访问令牌、私钥块、家庭路由器口令、内网网关地址、个人设备型号、私有项目名、个人代称、个人工作区路径、手机号、邮箱、记忆条目 id、会话 UUID 等
2. **记忆库正文比对**：把当前记忆库每条内容切成「连续 ≥10 个汉字」的片段去比对源码，避免把插件自身术语（`injectCount`、`cacheFriendly` 这类）误判成泄漏
3. **禁止入库清单**：`memories.json`、`settings.json`、`ai_state.json`、`ai_extract.log`、`injection_cache.json`、`backup/`、凭据文件一律不许出现在仓库里

单独跑：

```bash
node privacy_check.js .      # 退出码 0 = 可推，1 = 有拦截项
```

> 写扫描器时注意：规则串本身会被自己扫到，需把字面量拆成拼接（例如 `"ab" + "cd"`）并跳过检查器自身文件；同时务必做负向控制 —— 拿同一套规则去扫未清洗的原件，能命中原有的敏感内容才算扫描器有效，否则「0 命中」可能只是规则写坏了。

## 版本
v1.1.3 · toolpkg_id: `com.operit.deep_memory`
- v1.1.0：AI 语义判定引擎（`Tools.Chat.call`，MEMORY→CHAT 双通道）+ chatMessage 主通道 + 注入预算三处修复 + AI 自检/日志面板
- v1.1.1：新增侧边栏入口（`surface: main_sidebar_plugins`）；补 `manifest.api_version = 1.0.1`（`Tools.Chat.call` 的硬门槛，缺失会被宿主按 1.0.0 拒绝）
- v1.1.2：修复时间线排序 —— `ipcGetAll` 先按 `createdAt` 降序再截断，最新的记忆排在最上面；同时修掉「超 limit 时取到最旧 N 条、最新记忆被丢弃」的隐患
- v1.1.3：**修复主通道静默失效** —— `dist/main.js` 漏了 `exports.onChatMessagePersisted`（src 有、dist 没有），宿主拒绝注册 `registerChatMessageHook`，抛出的错误被 `try/catch` 吞掉，导致 chatMessage 通道从未工作、只有兼容用的 msgproc 在跑。补上导出后日志出现 `注册 chatMessage 钩子成功`

## 打包须知（v1.1.1 起）
`build_pkg.py` 内置三道硬校验，只在通过时才出包：
1. `manifest.api_version` 必须存在且 `>= 1.0.1`，格式为 `major.minor.patch` 三段
2. `registerNavigationEntry` 的 `surface` 必须落在白名单：`toolbox` / `TOOLBOX` / `MAIN_SIDEBAR_PLUGINS` / `main_sidebar_plugins`
3. `registerXxxHook({function: NAME})` 里的 `NAME` 必须存在于同文件的 `exports.NAME`（已用负向测试验证会 `[FATAL]` 拦住）

> 非法 `surface` 会让宿主在**包解析阶段**抛 `IllegalArgumentException`，整包失败、插件从列表消失，`try/catch` 兜不住。
> 另外，`packages/` 目录里只要残留一个坏包，所有后续安装都会报同一个不相关的错误，排障前务必先清掉。
- v1.0.0：六边形基础能力（写入/检索/图谱/复习/统计/面板）