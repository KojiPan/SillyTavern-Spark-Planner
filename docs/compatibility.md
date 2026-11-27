# 1.18.0 / 1.19.x 兼容核对

## 0.3.0 新接口与复验（2026-11-24）

以下补充优先于原阶段一记录。官方 1.18.0 与 1.19.1 固定源码均已核对并在隔离宿主执行回归，最低版本仍为 1.18.0；没有针对未来所有版本作全面保证。

| 新依赖 | 官方源码与使用边界 |
| --- | --- |
| `ChatCompletionService.sendRequest` | 两版 `public/scripts/custom-request.js` 导出并由 getContext 提供；支持 secret_id、流式与 AbortSignal；经两版真实服务代理验证。 |
| `Generate('quiet',…,true)` / `GENERATE_AFTER_DATA` | 两版原生 dry-run 构造完整上下文并在返回前发出载荷；不提交消息、不发主模型请求；独立 Planner 复用该载荷。dry-run 跳过其他扩展生成拦截器。 |
| `CHAT_COMPLETION_SETTINGS_READY` | 两版已有；继承模式调整本次 Quiet 最终 max_tokens，finally 移除监听，不改变常规正文预算。 |
| `/api/secrets/read,write,rotate`、`readSecretState` | 两版 `src/endpoints/secrets.js` 与 `public/scripts/secrets.js` 支持多 Key ID；只使用脱敏清单与 secret ID，写后恢复原活动项，刷新原生脱敏状态。 |
| `/api/backends/chat-completions/status,generate` | 两版接受 Custom URL、secret_id；模型刷新、思考强度 include-body 与排除参数通过官方代理，无新增后端或外部密钥中转。 |
| `/api/worldinfo/get,edit`、`worldInfoCache`、`WORLDINFO_UPDATED` | 两版已有。对保存响应检查并同步官方缓存；缓存导出及服务端端点属版本相关边界，后续升级必须回归。原生保存未提供 CAS，不承诺跨客户端原子更新。 |
| `accountStorage` / `SillyTavern.libs.localforage,yaml` | 两版存在，分别用于备份作用域、本地备份与 Markdown YAML 解析；ZIP 编解码附带 fflate 0.8.3，无远程运行时依赖。 |

结果：两版均通过原生链路、独立流式代理、密钥隔离、UI CRUD、ZIP 回导、历史回用、取消/超时/刷新/聊天隔离，以及每版 40 组布局检查；单元测试 19/19。模型侧使用本地测试服务，无私人数据；商业提供商、真实手机和群聊工具组合仍未穷举，见 [测试记录](../TESTING.md)。下文保留此前兼容调查的历史说明。

本次只放宽经验证的最低版本、修正诊断中的版本文案，并扩展测试及文档。没有改变工作流、UI 结构、条目数据格式、模型提示词或世界书条目配置。

## 官方基准

| 版本 | 固定源码提交 | 独立测试目录 |
| --- | --- | --- |
| [1.18.0 Release](https://github.com/SillyTavern/SillyTavern/releases/tag/1.18.0) | `51ad27fb86d39a3daca3adaa970375c9670c12df` | `work/spark-reference/runtime-1.18.0` |
| [1.19.1 Release](https://github.com/SillyTavern/SillyTavern/releases/tag/1.19.1) | `82b64a45c34facbc98ff4b9f33c067d3ccab6a17` | `work/spark-reference/runtime` |

本地原工作区虽声明 1.18.0，HEAD 是 `8172dcd0e`，晚于官方 1.18.0 tag。本次使用固定官方 tag，不将该工作区等同于 1.18.0 Release。测试实例只使用独立数据目录；没有修改原工作区核心源码、聊天、世界书或密钥。

## 实际依赖核对

| 依赖 | 官方 1.18.0 源码位置 | 与 1.19.1 对照及结论 |
| --- | --- | --- |
| `SillyTavern.getContext()` 设置、聊天元数据、保存与生成工具 | `public/scripts/st-context.js:getContext` | 插件使用的属性均已存在。1.19.1 新增的 `messageFormatter` 未被本插件使用。 |
| `generateQuietPrompt({quietPrompt, quietToLoud, skipWIAN, responseLength, forceChId})` | `public/script.js:3025` | 用 AST 提取函数比较，两个 tag 的实现文本相同；对象参数及主模型请求复用方式不变。 |
| manifest `generate_interceptor` / `runGenerationInterceptors` | `public/scripts/extensions.js:2015` | 实现相同，仍 await `(chat, contextSize, abort, type)`；通过 `abort(true)` 阻止外层请求，不抛异常后静默继续。 |
| 原生 `Generate` 顺序 | `public/script.js:4240,4505,4576,5259` | 先生成开始事件，提交玩家输入/处理 Regenerate，再执行拦截器，之后世界书扫描和请求。Quiet/Swipe/Regenerate 的调用路径在两版真实宿主验证。 |
| 原生模型请求 | `public/script.js:sendGenerationRequest`、`public/scripts/openai.js` | 插件没有自行构造模型 HTTP 请求。两版均走原生 Chat Completion `/api/backends/chat-completions/generate`，测试仅在网络边界模拟响应。 |
| `loadWorldInfo/saveWorldInfo` | `public/scripts/world-info.js:2036,4097` | 函数实现相同；从 getContext 使用，保留原有标记与稳定 UID。 |
| `createWorldInfoEntry/createNewWorldInfo/openWorldInfoEditor` | `public/scripts/world-info.js:4057,4336,5818` | 两版均导出且函数实现相同，无需改名或 fallback；测试探测三个导出并调用创建接口。打开编辑器函数存在，但未做完整交互回归。 |
| `WORLDINFO_ENTRIES_LOADED` 扫描数组 | `public/scripts/world-info.js:4492` | 两版都 await 发出 `{globalLore,characterLore,chatLore,personaLore}`，之后排序并克隆。本插件继续只调整当前扫描数组。 |
| 深度与真实 Outlet 注入 | `public/script.js:4615`；`public/scripts/world-info.js:world_info_position.outlet` | 1.18.0 已支持 outlet position=7，原生映射到 NONE 扩展提示；原生 `{{outlet::koji_cot}}` 消费者在两版测试中得到展开。 |
| Outlet 宏 | `public/scripts/macros/definitions/core-macros.js:450`、`public/scripts/macros.js` | 已存在于 1.18.0，未用普通文字模拟。测试采用宿主默认宏设置，未穷举所有宏引擎配置。 |
| 生命周期事件 | `public/scripts/events.js` | 插件使用的 `GENERATION_STARTED/ENDED/STOPPED`、`CHAT_CHANGED`、`MESSAGE_RECEIVED`、`WORLDINFO_ENTRIES_LOADED` 在两版均存在；events.js 在两 tag 之间无差异。 |
| 生成锁/取消与恢复 | `public/script.js:stopGeneration,activateSendButtons,deactivateSendButtons` | 三个函数实现相同；保留原有递归保护与 Regenerate 恢复逻辑。 |

固定源码：[1.18.0 script.js](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/script.js)、[st-context.js](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)、[extensions.js](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)、[world-info.js](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/world-info.js)、[events.js](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/events.js)。对应文件也与 1.19.1 tag 做了本地对照。

结论：没有发现现有插件依赖 1.19.x 才新增的接口，所以不增加无必要的版本分支或适配包装。世界书模块辅助函数仍属于官方导出但未纳入 getContext 的版本相关接口，风险与原设计相同。

## 验证顺序与边界

正式 manifest 原先仍为 1.19.1。先将相同运行时代码复制到独立 1.18.0 测试宿主，只在测试副本放宽版本门槛。官方 1.18.0 与 1.19.1 实际运行通过后，才把正式 manifest 改为 1.18.0，并对最终文件复验。未把仅改 manifest 作为兼容证据。

测试通过：真实扩展加载、所需 getContext 函数与事件探测、世界书模块导出、Planner 与正文两阶段、同一次原始输入、条目正文与发现注入、真实 Outlet 展开、禁用条目从目录排除、原生 Swipe 复用、手动继续、Regenerate 失败恢复、总开关关闭后的正常发送/Swipe/Regenerate、Planner 失败不发送正文。两版每次测试均为 10 次模拟模型请求，页面 JS 错误为 0。语法与 11 项逻辑测试也通过。

1.18.0 首轮真实宿主测试在新安装欢迎页超时，未进入模型请求；修正测试脚本的初始化等待后通过。最终文件复验还发现测试在 Regenerate 恢复数组后、宿主尚未完成异步重载时就发送下一条输入；改为等待恢复完成提示后再继续。两处修改仅作用于测试，不改变插件交互。

未确认：真实模型渠道与预设组合、真实手机浏览器、所有 1.19.x 补丁版、群聊/工具循环、流式取消和断流、并发标签编辑与持久化错误。兼容声明针对已核对的接口及已列出的版本/场景，不扩展为全面验证保证。

## 新入口的接口补充

独立面板新增使用两版 getContext 已提供的 `Popup` 与 `POPUP_TYPE.DISPLAY`，以及公开实例的 `show()`、`completeCancelled()`、`onClose` 和 DOM 字段 `dlg`。已核对官方 1.18.0/1.19.1 的 `public/scripts/popup.js`：本插件所用构造参数和生命周期均存在；1.19.1 对自定义输入 autofocus 的新增不涉及本插件。魔法棒采用两版官方 Gallery 在 `public/scripts/extensions/gallery/index.js:addGalleryWandButton` 中使用的 `#extensionsMenu` 扩展挂载点与通用菜单类，无需另设版本分支。

参考：[官方弹窗文档](https://docs.sillytavern.app/for-contributors/writing-extensions/#custom-popups)、[1.18.0 Popup](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/popup.js)、[1.18.0 Gallery](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions/gallery/index.js)。自己的弹窗 `dlg` 样式类及原生输入区选择器属于版本相关边界，后续升级需回归，未修改核心文件或原生模板。
