# 上游同步升级 SOP 历史记录（非规范）

> 本页只保留 2026-11-18 至 2026-11-19 已记录的历史事实与旧验证结果，供追溯；不是现行流程或授权。旧报告中的命令和数据路径不应直接用于新同步。当前操作规则以 [SOP v2](SOP-上游同步升级.md) 为准。

## 2026-11-18：v0.4.0 同步评估与集成

- 上游基线为 v0.4.0；当时记录上游增量为 32 commits / 153 files（+8960/−4078），fork 自有 124 commits / 305 files，重叠 58 个文件（17 个 locale、41 个实质重叠）。上游 Rust 改动涉及 14 个已被 fork 移入 `crates/lappp-core/` 的文件；评估指出 `Content.vue` 双边大改和 SQLite v23/v24 迁移语义编号冲突是重点风险。
- 决定采用 merge 而非逐提交 rebase。实施记录：`git merge-tree` 预测 39 个冲突文件；实际自动映射了 7 个搬迁文件。详细评估、冲突与执行结果见 [v0.4.0 同步评估](SYNC-v0.4.0-同步评估-2026-11-18.md)。
- 当时记录迁移修复将 fork 迁移重编号至 v25–v30，并以 v31 补偿上游 v23/v24 变更；隔离 v28 副本演练记录为 28→31，包含 `atags.source`、索引及 VL/FTS/embed 表检查。该事实仅表示旧报告所记结果，不代表当前分支或当前迁移路径已重新验证。
- 旧报告记录 `cargo check --workspace --all-targets` exit 0；`cargo test --workspace` 681 passed / 0 failed / 12 ignored；前端 13 个测试脚本全绿（transport 抽验 35/35）；Windows 三产物构建 exit 0；隔离迁移演练和真机启动结果详见该评估报告。旧报告同时列出 3 个上游孤儿测试、可能遗留 bridge 描述行等未决事项。

## 2026-11-18 至 2026-11-19：类型门禁建设（311 → 0）

以下为当时记录的阶段数据与修复事实，不构成当前类型检查结果：

| 日期 / 批次 | 报告中的诊断数 | 记录的主要内容 |
|---|---:|---|
| 2026-11-18 初始盘点 | 311 / 42 文件 | TS2339×94、TS2322×54、TS2367×41、TS2345×38、TS7006×37、TS2503×8 及其他；Content.vue 147、Settings.vue 31、Image.vue 17。 |
| 2026-11-18 第 1 批 | 311→250 | 收窄 TS2367 字面量问题、替换 `NodeJS.Timeout`，补 `Home.vue` 参数类型；记录了门禁诊断 key 需归一化。 |
| 2026-11-18 第 2 批 | 250→222 | `configStore.js` 的 persisted-state 插件类型增强未加载导致推断失效；记录添加 side-effect import 后恢复。 |
| 2026-11-18 第 3 批 | 222→189 | 修正 null / never 级联：`uiStore` 判别联合、Settings ref 泛型、`externalApps` 数组类型。 |
| 2026-11-19 第 4 批 | 189→149 | 为隐式 any 回调和解构补类型；调整 thumbnail scheduler 测试先转译 TS 源再执行。 |
| 2026-11-19 第 5 批 | 149→108 | 清理 TS2339；报告记录了 Home 全屏 store、`cancelIndexing`、toast 调用、`listVlModels` 等问题修复，以及避免 `vite/client` 类型污染的做法。 |
| 2026-11-19 第 6 批 | 108→59 | 补 API JSDoc 与 null 参数类型、拓宽 library ID 类型；记录匿名解构参数 JSDoc 会劣化推断。 |
| 2026-11-19 收官批 | 59→0 | 类型门禁升为硬零错；报告记录修复 `openFolderDialog`、模板 v-model 类型、CSSProperties、video.js 声明及 null/undefined 差异。 |

当时总结记录 311→0 共七批，并挖出 Home 全屏状态、`cancelIndexing`、toast、`listVlModels` 与 i18n CRLF 加载等真问题。逐批细节、类型计数及源码锚点见 [旧版 SOP 的执行历史](SYNC-2026-11-19-上游7提交合并.md) 和以下相关提交历史；这些提交哈希可在仓库 Git 历史中检索：

- 批次 1–3：`42b74009`、`60ece91f`、`dfdf64c8`（日期 2026-11-18）。
- 批次 4–6 和收官：`6be0b98c`、`ff0c1aca`、`f69a5460`、`d6619c73`（日期 2026-11-19）。
- 当前检查命令见 SOP v2；本页不代表本次门禁结果。

## 2026-11-19：跨引用与聚合门禁建设

- 测试聚合曾接入 26 个孤儿测试（20 个绿项移入 16 个域，另 6 个文件 / 67 用例经修复后转入正域）；报告称形成 36 个 `test:*` 域及 `npm run test` 聚合。上游 `offlineCatalog` 测试在 Windows 的 CRLF 下曾因 import 剥离正则只匹配 `\n` 而加载失败；另有上游测试在干净上游树对照出现 24/6 红，旧记录将其归因为测试断言未跟随已变更契约。以上数字与结论均来自当时记录。
- `test:crossrefs` 接入前端聚合脚本，检查三类闭包：前端 invoke 与 handler、字面/动态前缀 i18n 调用与 `en.json`、shortcut ID 与注册表。当时记录 262 个注册命令、1688 个 i18n key、62 个 shortcut ID，以及注入假命令 / key / action 后失败的咬合验证。实现提交：`9dd73c22`。
- 聚合 runner 的 Windows 执行问题导致旧版曾报告“36/36”但实际没有运行测试域。修复改为通过 `process.execPath` 启动域脚本，并增加 runner 自检；该事件说明汇总数字必须有实际执行证据。提交：`f4f755ef`。
- 2026-11-19 七提交同步记录的门禁表另记：`typecheck:gate` 因上游新增 `statusBarFields: null` 首次发现 1 个类型错误，补 JSDoc 后回到 0/0；前端 36 域 / 547 用例全绿；Rust workspace 690 passed / 0 failed / 12 ignored，client feature 5 passed；前端构建与 Windows debug 构建 OK；当时真机图库记录缩略图 28、滚动后 26/28、原图 3648px、console 零错误。详见 [七提交同步记录](SYNC-2026-11-19-上游7提交合并.md)；这些是其原报告数据，不是本次重跑结果。
- 旧版 smoke 实现记录调试端口通过临时配置注入、还原原配置并重建干净二进制；另一次门禁建设记录默认原图阈值为 800、缩略图 32、滚动 52/32、viewer 2256px，以及人为拉高阈值后失败并走还原重建路径。相同的历史报告记载 conf 无 diff、debug port 检查为 0；本页不宣称这些结果已由当前控制器重新验证。实现提交：`ce81f7aa`。

另见仓库提交历史：`226841ca`（测试聚合）、`a0821a22`（孤儿 TS 测试）、`29668fd7`（测试修复与隔离区清理）、`9dd73c22`、`f4f755ef`、`ce81f7aa`。所有历史数量和结果保留当时报表口径；本页未重新执行这些测试。
