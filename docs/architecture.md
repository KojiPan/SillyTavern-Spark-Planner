# Planner 多分析模块（2026-11-25）

本次新增 `analysis-modules.js`（共享版本解析、模块校验/排序/适用状态、旧模块迁移）与 `analysis-settings.js`（紧凑管理和现有模态编辑器）。模块持久化到世界书包注册表，复用原事务；模块排序使用当前聊天 Planner 配置。`model-settings.js` 只管理模型标签。`workflow.plan` 在原调用前解析有效模块和冻结来源，`core.plannerSections` 组织五段及双容器，原结果入口过滤明确空模块。原 Generation 调用与原生世界书插入逻辑不变。

创作包导入/导出、复制、删除扩展为携带模块，共享原标签冲突处理。旧全局字段保留迁移备份但不重复加载，自定义混合协议通过一次性编辑确认。当前设计和兼容限制详见 [分析模块](analysis-modules.md)；下方各版本描述为历史记录，与本节冲突时以本节为准。

# 0.6.0 多创作包（2026-11-25）

创作包采用绑定世界书内的逻辑分组，注册表、分类与归属沿用原事务。新增全局默认/聊天覆盖、多包候选过滤和原弹窗跨包移动；父子 UID、模型版本和请求快照保留。详见 [本次存储与兼容设计](multi-packs.md)。下方保留早期版本记录；多包和删除条目的实时资格语义以本节及链接为准。

# 0.5.0 可观察性与界面局部调整（2026-11-25）

- core.plannerSections 从原 plannerPrompt 提取五段已组装文本与元数据；仍以同样的 filter(Boolean)/双换行合并。tests/prompt-assembly.fixture.json 是改动前输出样本，覆盖旧默认、独立模块、空模块、自定义及不同上限，验证最终 Prompt 字节不变。模块启用/版本、目录过滤、原生世界书注入、Swipe 和模型设置语义不变。
- channels / planner-context 在原有边界接收实际 generate_data，克隆 messages（含原有额外消息字段）并白名单提取必要参数。继承 native 在官方 CHAT_COMPLETION_SETTINGS_READY 最后处理器中；其余分支在 ChatCompletionService.sendRequest 调用前。未挂钩 fetch、未修改核心。边界之后其他扩展或服务端仍可能适配，因此每份快照明确保存 boundary / boundaryNote / transportNotes。
- workflow 为每次 run 的历史 record 新增 request，捕获时立即调用原 saveMetadataDebounced；保存一份冻结的请求上下文/五段/映射/模块状态，未把大请求重复放进 plan/applied。后续响应解析和失败原因单独写 requestDiagnostics，原 request 不随设置/条目编辑/Swipe 更新。失败/取消仍沿用原记录状态；历史回用没有新 Planner 调用，不伪造新请求。
- 请求参数只保留模型、来源、流式、token 限额、采样、reasoning 与停止配置等明确白名单，不保存连接 URL、鉴权头、密钥/secret ID、proxy_password 或自定义请求体原文。用户真实上下文仍完整保留，快照属于聊天私有数据。条目导入/导出模块未接触 request 字段。
- 新增 request-viewer.js，复用 editor.editDialog 的原生 Popup 壳；以保存记录为唯一数据源，不读取实时设置或重组提示。双视图、延迟构造折叠消息、全文/单部分复制、原请求 TXT/JSON 导出。每段/每消息无额外固定滚动框，阅读使用弹窗中部一个原生滚动区，支持键盘焦点。
- editor 原先始终 top=visualViewport.offsetTop+12，现以真实 dlg 尺寸计算视口内居中，并用 ResizeObserver / visualViewport resize+scroll 在视口变化后校正。保持原模态背景锁和父级滚动恢复。正文放大和保存/取消草稿语义沿用原逻辑；只读窗口省去重复确认按钮。
- index / library / version-editor / style：局部重排当前页与编辑字段，普通提示用短暂、不可拦截点击的本插件 toast；默认版列表和低频诊断收起。汇总标题显示本轮分析，模块名与存储字段（discovery）、原 Prompt 保留。没有新增 UI 框架、数据库、多包管理或分析业务。

下文保留之前的架构记录；快照与 UI 描述以本节为准。

# 0.4.0 增量设计（2026-11-25）

当前状态：P0 Planner → Generation、原生世界书扫描、Swipe、持久化/历史已实现并保留；P1 的库分类/编辑/弹窗已实现，本轮点选原先仍为类型→分类→正文多层结构。本次只增量替换点选布局与补充版本适配；没有新增数据库、世界书条目身份或生成拦截链路。

- model-versions.js：公共标签校验、Generation 主模型读取、AND/OR 匹配、条目/模块版本唯一解析和导入冲突重映射。专用版按版本 priority、标签 priority 降序，最后版本 ID 字典序；同优先级冲突带原因。不根据 Planner 渠道或在线状态推断模型。
- version-editor.js：给原 editor.js 编辑器加版本导航，使用原 textarea 与放大入口；各版本草稿随原弹窗取消/保存；禁止删除最后有效版本。
- model-settings.js：原插件设置中的 modelTags / analysisModules 管理。未定义 analysisModules 时把原 prompts.discovery 作为兼容默认模块，不读取时写回或重排用户数据。
- 世界书 spark_planner 元数据增加 versions。共享原条目 ID、UID、enabled、类型/分类和所有 NATIVE_FIELDS。主 content 与 recommendation 保持默认版镜像，原生编辑默认正文仍有效；专用版不会创建额外 WI 条目。条目读取向旧数据提供默认版语义，真正保存时再写版本字段。
- workflow.plan 在冻结编号目录前读取主模型并解析版本，目录仍只有逻辑标题/适用推荐开启；模块按同一主模型解析并维持五段顺序。plan.modelResolution / record.modelResolution 保存原模型、标签定义及版本；applied.entries 保留各版本的选中条目快照。activation 每次读取当前主模型、用快照各版本重新解析唯一正文并尊重当前可选状态；不修改历史原规划。lastGeneration 只记当前规划的最近执行诊断。
- 无默认且不匹配的素材不会进入目录或 overlayLore。手工勾选只记录逻辑 ID，不绕过 activation 的模型条件。关闭总开关时仍由既有 overlayLore 清除所有拥有镜像。
- 顶部徽标只读取模型/标签，以标签优先级（相同按标签 ID）显示一项；详情列全部命中与规则。它与版本候选及决策互不写入，不触发规划。
- skill-pack.js：v2 Markdown/ZIP 保留逻辑 ID 与 native 参数，导出版本与所需标签定义。导入重复标签 ID 的矛盾定义拒绝；和本地冲突的定义保留本地、给导入标签新 ID 并改写导入版本引用，预览明确显示变化。世界书写入成功后才保存合并标签。存在已删除标签的孤立引用时，导出明确报错，要求先修复，避免静默生成缺定义的包。

下面保留原实现调查与历史阶段记录；与本节冲突时以本节为准。

# 调查与阶段一架构（2026-11-23）

## 0.3.0 更新（2026-11-24，优先于下方历史设计）

用户已授权完成阶段二、三。面板现为中央聊天区底部固定约 70% 高度，隐藏滚动条、内部滚动；四页签都已实现。新增 `features.js`（管理界面）、`skill-pack.js`（稳定 ID Markdown/ZIP）、`channels.js`（原生代理/密钥服务）；原条目元数据形状保留。分类名称为可选设置列表，普通条目保持不变。

历史在各聊天内保留最近 50 条，原始模型文本不因编辑或回用被覆盖。回用创建独立记录、保留来源 ID，按当前玩家 UUID 绑定。快照精简为已选条目和发现；历史中已删除的素材仍可从快照复现，应用修改时保留原生高级字段。刷新恢复将遗留 running 记录标为 interrupted。

独立渠道先用原生 Quiet dry-run 捕获 `GENERATE_AFTER_DATA`，保留原生消息数组或格式化全文，再交 `ChatCompletionService.sendRequest`。Key 经酒馆原生 secret 接口保存，扩展配置只有 secret ID 与绑定 URL；写 Key 后恢复主 Custom 活动项。继承 Chat Completion 只调整最终 Quiet 输出限额，避免 32768 预扣上下文。独立渠道与正文连接互不替换。dry-run 会跳过其他扩展 generation interceptor，仍存在 Quiet/普通正文差异，需组合实测，不能声称最终上下文完全相同。

世界书写入使用官方 get/edit 端点并检查 HTTP 返回，保留稳定 UID；写前比较缓存/磁盘与再次读取结果，插件同源标签间用 Web Locks。每次保存前在账户/浏览器作用域 IndexedDB 留最近 3 份拥有条目备份，恢复只替换本插件条目。写后更新官方缓存并发 `WORLDINFO_UPDATED`。这些属于版本相关导出/端点兼容边界；原生服务没有 CAS，跨客户端存在无法完全封闭的竞态。心理发现保存固定原绑定目标，异步保存结束不切换新聊天的选择。

取消通过 AbortController 和原生 stopGeneration 传播；timeout、停止、迟到结果、切换聊天和刷新中断已做隔离测试。仍未全面验证所有商业供应商、群聊工具续轮、第三方拦截器及真实手机软键盘。完整证据见 [当前测试记录](../TESTING.md)。下文保留调查历史，旧未完成项以本节为准。

## 源码基准

- 用户工作区：SillyTavern 1.18.0，`8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`。
- 官方最新稳定版：**1.19.1**，tag 与 release 分支均为 `82b64a45c34facbc98ff4b9f33c067d3ccab6a17`。使用 GitHub releases/latest API 与 git ls-remote 核对。
- 下载相关源码后，另外建立 `work/spark-reference/runtime` 隔离工作树，独立测试数据在 `work/spark-reference/test-data`。没有升级用户核心源码或使用用户聊天与密钥。
- 初始开发基准为 1.19.1；后续已补充官方 1.18.0 Release 对照与双版本宿主测试，最低支持 1.18.0，见 [版本兼容记录](compatibility.md)。不能由源码调查推断未来版本、所有提供商或所有预设已经兼容。

官方资料：[UI Extensions](https://docs.sillytavern.app/for-contributors/writing-extensions/)、[World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)、[安装扩展](https://docs.sillytavern.app/extensions/)、[Release 1.19.1](https://github.com/SillyTavern/SillyTavern/releases/tag/1.19.1)。

## 接口与实际顺序

源码链接均固定 tag：[script.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.1/public/script.js)、[st-context.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.1/public/scripts/st-context.js)、[extensions.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.1/public/scripts/extensions.js)、[world-info.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.1/public/scripts/world-info.js)、[events.js](https://github.com/SillyTavern/SillyTavern/blob/1.19.1/public/scripts/events.js)。

1. `Generate` 发出 GENERATION_STARTED，然后执行 slash commands 和连通性检查。
2. 正常生成读取并清空输入框，调用 `sendMessageAsUser`；Regenerate 在此阶段删除末尾 assistant；Swipe 的 coreChat 排除待替换回复。
3. 调用 manifest `generate_interceptor`，参数为 `(coreChat, contextSize, abort, type)`；按加载顺序 await。
4. 原生构造角色、预设等上下文，执行世界书扫描，发出 `WORLDINFO_ENTRIES_LOADED`，此事件位于最终克隆与排序前。
5. 世界书引擎按原始 position、role、depth 生成注入，并将真实 Outlet 设为 NONE 类型 extension prompt。Outlet 必须有预设中的 `{{outlet::koji_cot}}` 消费者才显示。
6. 最终提示构造后发出 `GENERATE_AFTER_DATA`，再执行原生请求及回复保存。

可公开实现：manifest 安装、`SillyTavern.getContext()`、`extensionSettings` / `saveSettingsDebounced`、`chatMetadata` / `saveMetadataDebounced` / `saveChat`、`generateQuietPrompt`、`generate`、`loadWorldInfo` / `saveWorldInfo` / `getWorldInfoNames`、生成与聊天事件、`swipe`。总开关关闭时扫描仍过滤本插件拥有的镜像，普通条目保持原样。

兼容层：`Worldbook.api()` 动态导入世界书导出的 `createWorldInfoEntry`、`createNewWorldInfo`、`openWorldInfoEditor`；这些是官方源码导出的模块接口，但未全放进 getContext，属于版本相关依赖。`WORLDINFO_ENTRIES_LOADED` 的可变数组形状、Quiet 对共享 abortController/UI 的副作用、Regenerate 的删除顺序也需要随官方升级回归。集中在 worldbook/workflow/recovery 模块，不 monkey patch Generate，不替换原生 Swipe。

`setExtensionPrompt` 是公开可用接口，但技能不直接走它：原生世界书扫描可完整保留实际位置、Outlet 和高级字段。`WORLDINFO_FORCE_ACTIVATE` 有全局状态，不采用，以免跨轮残留。阶段二独立渠道应复用连接配置与服务端密钥体系；当前阶段仅继承主模型，没有新增密钥存储或对第三方的请求。

## 数据与工作流

创作库以明确拥有的世界书条目为源。元数据 `spark_planner.owner === 'spark_planner'`；稳定 ID 与 WI uid 分开，标题不参与身份判断。普通条目不会被接管。创建条目默认为 native disable=true、System Depth 0；设置层 enabled 独立保存在元数据。用户在世界书编辑器修改其他高级配置后，下一次“应用修改”会读取到规划快照中。

每轮候选过滤 enabled，按类型分别临时编号并克隆冻结。模型目录只包含编号、标题、推荐条件，内部 ID 和正文不进入目录。解析后把编号映射为 ID，非法项告警、去重并截断上限；无合法项仍可继续。空 API 响应视为失败，可重试。

玩家消息 `extra.spark_planner` 存 UUID；chatMetadata 的 plans 以 UUID 索引，保留输入正文用于识别用户编辑。历史最近 50 次在本聊天存储，阶段一只有当前规划编辑界面；历史浏览与跨聊天历史 UI 留待阶段二。规划快照包括所选条目正文及高级字段，防止 Swipe 采用别轮的素材版本。点击应用会更新快照；设置层 enabled 不随当前选择变动。

外层正常 Generate 已提交玩家消息后进入拦截器：清除本轮旧规划 → Quiet Planner（递归旁路，保留正常预设/角色/世界书/历史）→ 解析 → 覆盖心理发现镜像与本轮快照 → 外层继续扫描并生成。Quiet 不保存为聊天消息；不添加第二个 user prompt。手动模式/仅规划调用 abort(true) 停在同一轮；“继续生成”使用原生 regenerate 对末尾 user 生成，不触发空输入替代文本。

生成扫描中，移除数组内本插件镜像并添加当前快照中已选条目的启用副本；持久世界书不切换启用状态。发现镜像仅作可查看副本，实际注入使用当前轮 discovery。关闭开关、Quiet Planner、无本轮快照时均无插件条目注入。原生普通世界书照常处理。

## 最小项目结构

```text
manifest.json / index.js / style.css   安装入口与最小移动端面板
core.js                               目录、协议解析、扫描副本
workflow.js                           规划执行与聊天快照
worldbook.js                          世界书公开接口与兼容边界
recovery.js                           原生 Regenerate 失败恢复
panel-host.js                         官方魔法棒挂载、原生 Popup 与输入区留位
view-state.js                         仅用于展示的七种运行状态与按钮可见性
tests/                                逻辑与真实宿主模拟模型测试
docs/architecture.md / TESTING.md      基准、风险、验收
README.md / LICENSE / package.json    仓库交付
```

## 风险与验证

- Quiet 复用原生完整构造过程，但不同 generation type 的原生行为与 token 预算可能不同；它不是对外层最终 payload 的字节级复制。需用真实预设确认角色、世界书、用户人设、最新输入均在 Planner 中，任务/目录不在 Generation 中。
- Quiet 会操作全局生成锁与 abortController。用 run UUID 防递归，并在返回外层后重锁 UI；取消调用原生 stopGeneration，等待请求实际结束才释放运行锁。聊天切换/关闭开关使迟到结果失效。未用 Promise.race 遗弃仍运行的原生请求。
- 原生 Swipe 自带失败回退；不干预。Regenerate 通过开始事件保存旧 assistant 与所有候选，结束后若未成功则恢复；流失败通过 streamingProcessor.isStopped 判定。该恢复依赖事件顺序，需故障注入回归。
- 扫描时仍遵守原生预算、probability、triggers、characterFilter 等高级配置。因此选中不保证超预算条目最终入 prompt；不擅自覆盖用户高级设置。
- 世界书官方保存函数更新缓存早于服务端保存，且其 `_save` 未检查 HTTP 状态。持久化失败、并发编辑与备份恢复在阶段三需要加强；当前不适合多标签同时编辑相同绑定世界书。
- 聊天切换发生在正在保存镜像时，可能完成旧镜像写入；镜像始终禁用且扫描用聊天快照，不能因此向新聊天注入，但需在阶段三做慢请求测试。
- 历史快照随聊天保存，可能随用户原生聊天导出携带；阶段二创作包导出必须显式排除聊天、历史与密钥。
- 群聊与工具续轮需要额外回归，目前不能宣称已通过。

阶段一必须先通过用户真实角色/预设验收，再做完整分类、历史回用、ZIP 导入导出与独立渠道面板。各项尚未实现内容不算完成或删去需求。

## 日常入口与面板（后续 UI 调整）

按用户要求暂停阶段一人工验收，先调整 UI。原扩展设置栏只保留提示/打开按钮，完整面板停放在隐藏容器；点击原生魔法棒中的“火花规划器”才显示。菜单采用官方 Gallery 的 `#extensionsMenu` 子项挂载惯例，没有菜单注册函数可调用，也没有改核心模板。弹窗使用 `getContext().Popup` + `POPUP_TYPE.DISPLAY`；通过该实例的 `dlg` 专属样式类适配手机底部抽屉/桌面居中，关闭、Esc、模态焦点与销毁沿用原生流程。

面板内容只有一份，关闭后移回隐藏容器，保留事件与界面草稿，不改变开关/生成状态。ResizeObserver 与 visualViewport 只读测量 `#form_sheld`，给自己的弹窗预留原生聊天输入区；不改原生输入框的位置、尺寸或内容。打开时原生模态机制暂时限制背景交互，关闭后恢复。

当前/历史/创作库/设置四个页签中，历史只是明确占位。当前页直接编辑心理发现，短标题按钮切换本轮条目，更多操作和高级详情折叠。状态与按钮由 UI 内存状态、现有规划和原生事件派生，不写入条目或聊天数据。Quiet 暂停/失败不一定再次发出结束事件，因此入口装饰器观察自身拦截器完成，原样转发 abort 参数和返回值，仅刷新 UI 状态；不修改 `Workflow` 的生成决策。
## 可选 ECoT 增量（2026-11-25）

Reasoning 的版本内容增加 `ecotEnabled`（默认 false）、`ecotText`、`ecotOutlet`（默认 EcoT），仍由原 `resolveVersion` 一次决定适用版本。`ecot.js` 提供字段默认值、编辑折叠区和附属条目构造；`version-editor.js` 对复选框按 boolean 捕获，复用原放大编辑，不修改 Planner 提示词或编号协议。

世界书主条目仍为 `spark_planner.kind=skill`；附属条目标记 `kind=ecot, skillId=<父稳定ID>, id=ecot:<父稳定ID>`。每个逻辑条目只维护一个附属 UID，不按版本创建多条。主元数据保存全部版本；附属持久镜像对应默认版文本（没有默认版时为空），实际扫描副本用已解析的同版 ECoT 覆盖内容和锚点。原生 position=7，order=100，probability=100，disable=true。父子原生 UID 不导出、不用标题定位，普通条目不参与匹配。

`Worldbook.upsert/importSkills` 在原有一次世界书事务内维护父子；`remove` 同时删除拥有的附属条目。`syncEcot` 在应用和激活时修复缺失、重复与孤立附属条目，无变化时不写盘；沿用原缓存/磁盘冲突、锁、备份和 HTTP 错误处理。同步失败清空 active、记录错误、通知并中止生成，不发送半份条目。

`Workflow.resolveEntries` 只遍历选中的主条目，从同一个版本同时产生正文与可选 ECoT，附属按 `skillId` 跟随父选择。`overlayLore` 仍只过滤插件镜像并向原生扫描数组添加副本，原生 Outlet 宏负责最终展开。附属镜像的 `enabledVersionIds` 仅用于撤销库中已关闭或清空的 ECoT，没有独立的本轮开关。缺失当前绑定包中的带 ECoT Reasoning 会跳过两部分；原有无 ECoT 的历史快照逻辑保留。内容变更仍须应用更新本轮快照，历史回用不混入当前库正文。

调试中 `mainEnabled/ecotEnabled` 表示扫描副本激活资格，附带 versionId、outletName、syncError、撤销原因和预设引用提示。预设提示只检查当前 Chat Completion 的文本是否出现对应宏，不声称完成 prompt_order/扩展注入的完整启用分析；最终是否入请求由酒馆负责，未引用时不进行位置回退。
