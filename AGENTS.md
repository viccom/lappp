# lappp 项目规约（AI 协作者向）

> 面向在本仓库干活的 AI 协作者与新同事：**只写项目特有的事实**——分支与红线、可执行命令、架构边界、已踩过的坑。
> 通用工程纪律见全局 `AGENTS.md`；机器事实（工具链版本、路径）见 `~/.zcode/machine-profile.md`。
> 数字与锚点核对于 2026-11-19（提交 `e87aa3d1`）。上游一更新锚点就会漂移，**以代码为准**，发现对不上就改本文。

---

## 0. 这是什么 / 分支怎么用

- 本仓库是 [julyx10/lap](https://github.com/julyx10/lap) v0.4.0 的 fork，产品名 **lappp**。
- `main` = **上游镜像**，不在其上做任何自有提交；`develop` = **所有自有开发**；功能分支从 `develop` 切出。
- `origin` = `github.com/viccom/lappp`，`upstream` = `julyx10/lap`。
- 当前：`main` = `3e265ce5`（上游 v0.4.0 + 7 个提交：状态栏字段可定制、相似图按需计数、切视图不闪背景、智能相册/合集排序移入面板菜单等），`develop` 领先 `main` **160 个提交**（含上游合并）。
- 产物三件套：`lappp.exe`（厚版/内嵌）、`lappp-client.exe`（薄客户端）、`lappp-server.exe`（无头服务端），由 `scripts/build-windows.ps1` 产出。
- crate：`lappp`（Tauri 壳）/ `lappp-core`（Tauri-free 内核）/ `lappp-server`（axum）。

---

## 1. 红线

1. **GPL-3.0-or-later**：fork 整体受此约束，分发构建物须开源；上游署名不得移除。
2. **InsightFace buffalo_s（`det_500m` / `w600k_mbf`）是「仅限非商业研究」许可**（`THIRD_PARTY_NOTICES.txt:416`）。**分发带人脸功能的构建物前必须先处理模型许可**（替换或取得授权）。自用无碍。
3. **不得改 Tauri 标识符 `com.julyx10.lap`**（`src-tauri/tauri.conf.json`）：它指向真实图库所在的数据目录，改了用户的数据就失联。代价是 WebView2 缓存与已安装版共用——这是已知取舍，不是 bug。
4. **VL 网关密钥（`vl-api-key`）是用户私有资产**：不提交、不打印、不写进日志或错误信息；后端已用 `#[serde(skip_serializing)]` + 脱敏保护，改动时不得破坏。
5. **不自动更新**：in-app updater 已关闭（`src/common/updatesPolicy.js`，`UPDATER_FEED_IS_FORK_OWNED = false`）——上游签名的产物会覆盖本 fork。在 fork 拥有自己的发布端点与 minisign 密钥前不得开启。
6. **不破坏用户资产**：真实图库（2,773 项）、`D:\LapPortable` 便携目录、`%LOCALAPPDATA%\com.julyx10.lap[.debug]` 都是用户资产，覆盖前先备份并说明替换了什么。
7. **不改上游既有行为**，除非功能方案里明确列为「适配点」并有测试保护。
8. **只在被要求时 commit/push**。

---

## 2. 事实基线

| 维度 | 现状（2026-11-19） |
|---|---|
| 版本 | `0.4.0`（`src-tauri/Cargo.toml:4`、`src-vite/package.json:4`） |
| DB schema | 迁移 **v31**（`crates/lappp-core/src/t_migration.rs:374`）；上游 v23/v24 占位，fork 自有迁移重编号 v25–v30，v31 是 v0.4.0 同步的补偿迁移。**新迁移从 v32 起** |
| 连接 | WAL / `synchronous=NORMAL` / `foreign_keys=ON` / `busy_timeout=5s`（`t_sqlite.rs:11522`） |
| 命令 | `#[tauri::command]` 共 262 处，**全部已注册**：桌面 `generate_handler!` 257 条（`src/main.rs`）+ 客户端 5 条；服务端桥接白名单 **234** 条（`crates/lappp-server/src/bridge_gen.rs`，另有断言校验三者严格划分） |
| 前端规模 | `src/common` 48 个逻辑模块、`src/components` 74 个 `.vue`、`src/views` 7 个路由视图、`src/locales` 17 种语言（en/zh-CN 各 1676 个 leaf key，其余 1660，ko 1634） |
| Rust 测试 | `cargo test --workspace` → **690 passed / 0 failed / 12 ignored**（core 605+11 ignored、壳 12、server 71、drag 2+1 ignored） |
| 前端测试 | 52 个 `*.test.mjs` 共 **547 用例**，分 **36 个 `test:*` 域**，聚合 `npm run test` 全绿 |
| 类型门禁 | `npm run typecheck:gate` 基线 **0**（`src-vite/typecheck-baseline.json`）——已经是硬零错门禁 |
| 支持格式 | **76** 个扩展名：图像 32（常规 14 + FFmpeg 14 + Affinity 4）、RAW 25（`x3f` 临时禁用）、视频 19（`crates/lappp-core/src/t_common.rs`） |
| 推理 | ONNX Runtime `2.0.0-rc.10`，**仅 CPU**（全仓无任何 execution provider 配置）；嵌入维度由运行时探测（CLIP ViT-B/32 实测 512），不硬编码 |
| 内置模型 | 5 个：`text_model.onnx`、`vision_model.onnx`、`tokenizer.json`、`det_500m.onnx`、`w600k_mbf.onnx` → `src-tauri/resources/models/`；多语言塔（540MB）按需下载到 `<appdata>/models/multilingual`；`bge-local` 描述嵌入模型为可选 |

---

## 3. 门禁命令（改完必跑，顺序即成本递增）

```bash
# 前端（src-vite/）
npm run typecheck:gate      # vue-tsc 基线门禁：只许减少不许新增（--update 重新基线化）
npm run test                # 聚合跑完 35 个 test:* 域
npm run test:crossrefs      # 命令 / i18n key / 快捷键 id 三方契约对账
npm run build               # 桌面 bundle（src-vite/dist）

# Rust（src-tauri/）
cargo test --workspace
cargo test -p lappp --no-default-features --features client   # 薄客户端裁剪腿

# 真机冒烟（重建+起 GUI+CDP，会临时注入调试端口并自动回退）
npm run smoke:desktop

# Windows 三件套
pwsh -File scripts/build-windows.ps1 -BuildProfile release   # 默认 release
```

`npm run test` 已含 `test:crossrefs`；`smoke:desktop` **不在** `npm run test` 内（它要重建并起窗口），属同步/发布门禁。

**退出码纪律**：不要用 `cmd | head` 之类的管道判成败（会吞真实退出码）；失败时贴原始 stderr。

---

## 4. 架构地图：改哪先读哪

| 目标 | 去哪 |
|---|---|
| 桌面命令（`#[tauri::command]`） | `src-tauri/src/t_*.rs`（壳）→ 实现落在 `src-tauri/crates/lappp-core/src/t_*.rs` |
| 内核逻辑（SQLite / 索引 / AI / 文件操作） | `src-tauri/crates/lappp-core/src/`（**Tauri-free**，见下） |
| HTTP 服务端（桥接 / SSE / 鉴权 / 媒体 / 静态站点） | `src-tauri/crates/lappp-server/src/`（`bridge_gen.rs` 是命令白名单真源） |
| 前端可测逻辑（纯函数层） | `src-vite/src/common/`（48 个模块，**必须可测**） |
| 前端 UI | `src-vite/src/components/`（74 个）、`src-vite/src/views/`（7 个） |
| 前端状态 | `src-vite/src/stores/`：`configStore`（全局设置→localStorage）、`libraryStore`（每库状态→后端 `saveLibraryState`）、`uiStore`/`viewerSessionStore`（纯运行时，不落盘） |
| 传输缝（桌面 ⇄ Web 切换点） | `src-vite/src/common/transport/`（`mode.js` 决定 tauri/http；`capabilities.js` 决定原生能力可见性） |
| 导航→查询决策 | `src-vite/src/common/queryDispatch.js`（纯函数，Content.vue 只执行不决策） |
| 图片理解提示词模板 | `src-tauri/crates/lappp-core/src/t_vl_templates.rs`（内置模板库）+ `docs/dev/VL-提示词模板库.md`（设计、实测与探针用法） |

**边界规则**：`lappp-core` **不允许出现 `#[tauri::command]`**——`crates/lappp-core/src/guard.rs` 是构建期守卫，会扫每个源文件。命令只能在 `src-tauri/src/` 里定义，再注册进 `generate_handler!`；服务端要暴露则加进 `bridge_gen::COMMANDS` + `EXPOSURES`（read/write/admin）。

**巨石文件**：`t_sqlite.rs` 约 1.4 万行、`t_utils.rs` 约 5.8 千行、`Content.vue` 约 1.28 万行。**新代码放新文件**，不要继续加厚它们。

---

## 5. 编码规范

### Rust

- 模块按 `t_<域>.rs` 平铺，新功能建新文件，不往 `t_cmds.rs`/`t_sqlite.rs` 里堆。
- 错误风格：`Result<T, String>`（仓库一致风格，**不用** thiserror/anyhow）。
- schema 变更**必须**走 `t_migration.rs` 的版本化迁移（新库从 v32 起），不要手改既有库。
- 后台任务：`State` 持 `AtomicBool` 取消标志 + `Mutex` 状态，进度走 `app.emit`。
- 并发纪律：同相册扫描单实例；动相册 DB 前等扫描结束；库级操作持库锁。
- 单元测试与实现同文件 `#[cfg(test)] mod tests`；新逻辑必须带测试；需要真实外部依赖的用 `#[ignore]` 并写清复现命令。

### 前端

- 所有后端调用封装进 `src/common/api.js`（222 个导出函数），组件不直接 `invoke`。
- 状态：全局设置进 `configStore`；每库 UI 状态进 `libraryStore`。
- 文案**必须**走 i18n：新增 key 至少 `en` + `zh-CN` 同步加，其余语言可后补但 key 要先占位；命名空间现状：en/zh-CN 共 31 个，其余 30 个。
- 测试：`tests/*.test.mjs`（`node --test`）只测**纯逻辑模块**；可测逻辑抽到 `src/common/` 再测，不测 `.vue` 单文件。**新增 `tests/*.test.mjs` 必须挂到 package.json 的某个 `test:*` 脚本**，否则孤儿守卫（`tests/orphanGuard.test.mjs`）会让门禁变红。
- 类型：`.vue`/`.ts` 里 **JSDoc 断言被忽略**（`/** @type {X} */ (v)` 不生效），必须用 TS 语法（`null as number | null`、`{} as Record<string, any>`）；`.js` 文件里 JSDoc `@param/@returns` 有效，但**不要给匿名解构参数加 `@param`**（会劣化推断）。
- 组件放 `src/components/`，独立全屏功能用 `WebviewWindow` + router 新路由（见 `src/common/transport/window.js` 的 `webRouteForWindowLabel`）。

### 新增测试的固定要求（历史踩坑）

1. 读源码文件必须归一化 CRLF（本机 `autocrlf=true`）：`.replace(/\r\n/g, '\n')`。
2. 锚点不得依赖跨行 `\n` 形态、位置索引（`menu.value[2]`）或注释挂位巧合。
3. 尽量 `import` 纯模块直接测；必须用 `new Function(ts.transpile(...))` 时先转译再执行。
4. 涉及文件系统时间戳的测试，变更前 `sleep ≥ 25ms`（Windows ~15.6ms tick 合并）。
5. 断言行为，不断言实现细节。

---

## 6. 已知陷阱（事故沉淀，动手前扫一遍）

1. **悬空 action id 会静默毁掉整个视图**：上游删了 `file.moveToFolder` 动作，菜单里还引用着它的快捷键；`getShortcut` 在渲染期抛错，Vue 把组件根替换成注释节点 → 宫格出现空白格、双击看不到原图。**规则**：任何 `shortcut('…')` / `getShortcutLabel(s)` 的 id 必须在 `SHORTCUTS` 注册；标签查询必须**全函数**（未知 id 返回空，不抛）。`scripts/check-cross-refs.mjs` 与 `tests/shortcutsLayout.test.mjs` 已把这条钉死。
2. **计数必须取自被计对象自己的查询**。侧栏主题计数曾复用「当前环境查询」，把无约束的库查询当成文本腿并集 → 每个主题都显示库总数（2,773）。**规则**：被计对象是主题/智能体时，计数走它自己的查询（`getSubjectCountAndSum`）。
3. **聚合量是运行时量**：`counts` / `activateTick` / `subjectCounts` 不落盘、加载即清（`src/common/libraryState.js`）。否则错值会跨会话存活（本次就残留了 8 个 2,773）。
4. **JS store 的类型陷阱**：字面量不拓宽（`'1' === '5'` 恒假）；`null` 默认值让守卫之后收窄成 `never`，一次放大几十个 TS2339；`persist:` 选项在 `pinia-plugin-persistedstate` 的类型增强未加载时会让 `defineStore` 重载解析崩塌（`configStore.js` 顶部的 `import 'pinia-plugin-persistedstate';` 就是为此，**别删**）。
5. **类型门禁的 key 必须归一化**：诊断消息里内嵌整段 store 类型串，直接拿原文当 key 会把无关的类型改动误报成新错；现按 `file :: TScode :: 归一化消息` 取键（`scripts/typecheck-gate.mjs`）。
6. **WebView2 的 CDP 只能从 `additionalBrowserArgs` 注入**：wry 总会自己传浏览器参数，此时 WebView2 **忽略** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量。发布用的包绝不能带 `--remote-debugging-port`（`scripts/smoke-desktop.mjs` 在 `finally` 里逐字节还原配置并重建干净二进制）。
7. **`src-vite/dist` 是桌面包与 Web 包共用的 outDir**，`build` 与 `build:http` 会互相覆盖且 `emptyOutDir` 清空。交付给 `lappp-server --web-dir` 前**最后跑 `build:http`**。
8. **多语言 CLIP 塔不在 `resources/models` 里**：它按需下载到 `<appdata>/models/multilingual`，调试构建从 exe 目录解析资源（`target/debug/models`），缺模型时主题查询会直接报错「Image search model files are missing」。
9. **debug 与 release 数据目录不同**（`com.julyx10.lap.debug` / `com.julyx10.lap`），`--data-dir` **原样使用不追加后缀**；测真实库必须显式指定，别让测试跑到另一个库上。
10. **云端文件保护**：`is_cloud_only` 检查贯穿哈希/嵌入/缩略图/XMP 每条路径，新功能触碰文件内容前必须沿用。
11. **门禁本身要有牙**：聚合 runner 曾用 `spawnSync(npm_execpath, …, {shell:true})` 拉起各域，在 Windows 上 cmd.exe 根本不执行 `npm-cli.js`，**每个域都秒退 0**，门禁长期报「35/35 全绿」而一个测试都没跑（是 2026-11-19 上游合并时被真机/单文件跑法对出来的）。现在 runner 直接 `spawn(process.execPath, args)` 跑 `node …`，并由 `tests/aggregateRunner.test.mjs`（`test:gate`）钉住「失败域必须让 runner 退出 1」「域脚本必须真的被执行」。**新增任何门禁脚本时，先证明它能红。**
12. **两个 lappp 实例无法并存**：WebView2 的用户数据目录由 Tauri identifier（`com.julyx10.lap`）决定，与 `--data-dir` 无关；第二个实例的 webview 起不来（带调试端口时卡在 `setup-ready` 之前、CDP 无目标）。所以冒烟前必须先关掉用户自己的实例——**并且只能用 `taskkill /PID <pid>`，绝不能用 `taskkill /IM lappp.exe`**，后者会把用户的实例一起杀掉。
13. **事件 API 只能从 `common/transport` 进**：直接 `import ... from '@tauri-apps/api/event'` 在桌面能跑、在 Web 端静默失效（事件永远不来）。历史上有两处（`StatusBarFieldsDialog.vue`、`composables/useLibraryChangeRefresh.ts`）踩过；`tests/transport.test.mjs` 已加守卫「除传输缝外任何文件不得 import 该模块」（`import type` 白名单放行）。同理，Web 专属的令牌、SSE 重放、会话失效跳转都要在**两端**成立：浏览器令牌只走 HttpOnly Cookie（服务端按 `Sec-Fetch-*`/`Origin` 识别），SSE 帧要写协议层 `id:`（否则浏览器不产生 `Last-Event-ID`、重连重放整段缓冲），`markExpired` 之后要有订阅者把 Web 路由回 `/login`。
14. **拍摄时间是墙上时间，不是 UTC**：`afiles.taken_date` 存的是正确瞬间，但凡是把它渲染给人看或给模型看的地方，都要用**本地时区**——前端 `new Date(ts*1000)`、SQLite `strftime(…, 'unixepoch', 'localtime')`、后端 `chrono::Local`。VL 提示词曾用 UTC 渲染，17:04 的傍晚照在提示词里变成 09:04，模型于是（正确地）说「上午」；同理 `{weekday}/{time_of_day}/{season}` 必须从本地墙上时间推导。见 `docs/dev/VL-提示词模板库.md`。
15. **Windows 上运行中的 exe 会被锁**：探针/工具还在跑时重新链接同一个 exe 会 `LNK1104: 无法打开文件 …vl_probe.exe`；而 `cargo build … | tail -4 && ./tool` 这种写法会用 `tail` 的退出码把编译失败吃掉，**旧二进制照跑**，测出来的结论是假的。规则：编译与运行必须分开跑，编译看**它自己的**退出码（`cargo build … > log 2>&1; echo $?`），确认成功再单独启动工具。
16. **提示词改动必须同配置重复运行再下结论**：模型输出方差极大——同一个二进制、同一批照片，两轮里「用上人脸姓名」的比例是 1/66 和 8/66，另两轮是 27/66 和 14/66。单轮 11 次调用的 4/11 对 6/11 是噪声，不能当改进证据。网关回报的 `input_tokens` 在同一轮内从 134 到 1500 不等，也不能拿来估成本。评估方法、样本量与已证/未证的结论见 `docs/dev/VL-提示词模板库.md`。

---

## 7. 上游同步流程

**必须**按 [`docs/dev/SOP-上游同步升级.md`](docs/dev/SOP-上游同步升级.md) v2 操作；每次同步另存 [`docs/dev/SYNC-template.md`](docs/dev/SYNC-template.md) 为独立记录。旧执行事实归档于 [`docs/dev/SOP-上游同步升级-历史记录.md`](docs/dev/SOP-上游同步升级-历史记录.md)，不作现行规范或本次验证证据。

- Git 仅 fetch 上游；本地 `main` 仅能快进到记录的冻结 SHA；在隔离工作树内用 merge 集成到 `develop`，**禁止 rebase**。审核与文件差异必须基于完整 SHA，覆盖新增、删除、重命名，重点检查 `src-vite/`、`src-tauri/src/`、`src-tauri/crates/`。
- SOP 不默认包含 merge commit、共享分支推进或 push。创建 merge commit、推进 `main` / `develop`、push 至各 origin 分支均须明确授权；真实数据目录 smoke、覆盖 `D:\LapPortable`、发布亦各需独立授权。不得要求用真实用户图库测试。
- 上游删除或移动符号后必须全仓检查残留引用。`scripts/check-cross-refs.mjs` 仅覆盖命令/handler、i18n 与 `en.json` fallback、shortcut ID；locale 完整键集合须另查，其他协议与跨文件契约按 SOP 核验。
- 门禁、迁移隔离或路径检查有失败、未执行或未确证项，**不得推进共享分支**。记录实际命令、cwd、环境、退出码与日志；历史报告不代替当前证据。

---

## 8. 部署与回滚

| profile | 二进制 | 默认数据目录 | 用途 |
|---|---|---|---|
| debug | `build\windows\debug\lappp.exe`、`lappp-client.exe`、`lappp-server.exe` | `%LOCALAPPDATA%\com.julyx10.lap.debug` | 调试 / 隔离验证；真实数据 smoke 需独立授权与路径审查 |
| release | `build\windows\lappp.exe`、`lappp-client.exe`、`lappp-server.exe` | `%LOCALAPPDATA%\com.julyx10.lap` | 产品形态；与 debug 使用不同默认数据目录 |

- 覆盖 `D:\LapPortable` 需独立授权并先时间戳备份**所有实际替换文件**，随后按同步 SOP 核验构建产物及不含 `--remote-debugging-port`；不得只备份 exe。
- `lappp-server.exe` 不内嵌前端（运行时读 `--web-dir`/`resources/web`），仅前端变更时无需更新它。
- 回滚：代码按 merge 提交选择 `git revert -m 1 <merge-commit>`；部署将备份的所有文件恢复原名。SQLite 迁移须先在隔离副本验证，回滚数据策略按本次同步记录执行。

---

## 9. 协作方式（用户明确要求）

- **前端问题先解剖代码，不要反复重启二进制**：Vue 渲染期抛错会把组件根换成注释节点（`subTree === Symbol(v-cmt)`），从 vnode/组件树层查起；探针只读不改语义。
- **用户的实测就是事实**，不要先怀疑「是不是误报」再去找解释；先复现到同一条代码路径上。
- 报告要带**实际命令与真实输出**，不写「应该可以 / 理论上」。
- 破坏性或对外动作（覆盖用户目录、删数据、推送发布）先确认目标并回显。

---

## 10. 当前开放事项

- `contrib/aur` 配方仍指向上游 `lap` 0.3.2，fork 未维护。
- `docs/.vitepress` 文档站仍指向上游（发布页 base=`/lap/`）。
- `docs/dev/launch-portable-check.ps1` 仍硬编码旧程序名 `Lap.exe`；更新前须确认目标及脚本安全行为，并在修复后实测。
- 项目已完成事项、同步历史和门禁建设过程归档于 `docs/dev/SOP-上游同步升级-历史记录.md`，不在本开放清单重复罗列。
