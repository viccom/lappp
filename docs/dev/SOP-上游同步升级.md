# SOP：上游同步升级 v2

> 适用：评估并将 `upstream/main` 的冻结提交集成到本 fork。历史执行证据见 [历史记录](SOP-上游同步升级-历史记录.md)；每次执行从 [同步记录模板](SYNC-template.md) 另存一份。本文是当前唯一操作规范。

## 原则与停机条件

- 只 fetch 上游；本地 `main` 只允许在候选门禁通过后快进到已冻结 SHA；`develop` 只通过 merge 集成，不 rebase、不改写历史。SOP 不默认包含任何 push。
- 在取得独立明确授权前，不创建任何 commit、不推进本地 `main` / `develop`、不 push、不运行真实图库 smoke、不覆盖 `D:\LapPortable`、不发布。创建隔离集成 commit、快进本地 `main`、快进 `develop`、push、隔离 smoke、真实数据 smoke、部署和发布均各自授权；一个动作的授权不代表其他动作授权。
- 比较必须使用记录的完整 SHA，不能用 `HEAD~1` 或浮动 `upstream/main` 作为审核范围。任何失败、未知、未隔离的数据路径或未决高风险都是 **NO-GO**；停止并报告，不靠跳过门禁放行。
- 保留用户工作区和分支；不清理、不覆盖现有未提交改动。开始前要求干净工作区；不干净则停止。

## 0. 固定目录与准备

以下命令均从仓库根 `D:\MyCodes\AI-album\lap` 执行，除非另有明确标注。同步记录先写到仓库外用户目录下以本次 `syncId` 命名的新文件；这既避免把半成品写进基线工作树，也不构成提交授权。只有门禁完成后，才可按 §6 将最终记录复制到隔离候选中。上一记录只作历史参考，不替代本次检查。

```powershell
# cwd: D:\MyCodes\AI-album\lap
$ErrorActionPreference = 'Stop'
$repoRoot = 'D:\MyCodes\AI-album\lap'
$syncTime = Get-Date
$syncId = $syncTime.ToString('yyyyMMdd-HHmmss')
$syncBranch = "sync/$syncId"
$isolatedWorktree = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP "lap-sync-worktree-$syncId"))
$recordDate = $syncTime.ToString('yyyy-MM-dd')
$recordName = "SYNC-$recordDate-$syncId.md"
$recordPath = Join-Path $env:USERPROFILE "lap-sync-record-$syncId.md"
if (-not [System.IO.Path]::IsPathFullyQualified($recordPath)) { throw 'external sync record path must be absolute' }
function Invoke-CheckedNative {
    param([string]$Program, [string[]]$Arguments)
    $output = & $Program @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "$Program $($Arguments -join ' ') failed with exit $exitCode" }
    return $output
}
Set-Location $repoRoot
$statusLines = @(Invoke-CheckedNative git @('status', '--short', '--branch'))
$statusLines
$initialChanges = @(Invoke-CheckedNative git @('status', '--porcelain'))
if ($initialChanges.Count -ne 0) { throw 'working tree is not clean; stop without changing user files' }
$currentBranch = ((Invoke-CheckedNative git @('branch', '--show-current')) -join '').Trim()
if ($currentBranch -ne 'develop') { throw 'start on develop; stop and confirm the intended branch' }
if (Test-Path -LiteralPath $isolatedWorktree) { throw "isolated worktree path already exists: $isolatedWorktree" }
if (Test-Path -LiteralPath $recordPath) { throw "external sync record already exists: $recordPath" }
$remoteNames = @(Invoke-CheckedNative git @('remote'))
if ($remoteNames -notcontains 'upstream') { throw 'upstream remote is missing' }
$upstreamUrl = ((Invoke-CheckedNative git @('remote', 'get-url', 'upstream')) -join '').Trim()
if ($upstreamUrl -match '://[^/@]+@') { throw 'upstream URL contains credentials; do not display or record it' }
if ($upstreamUrl -notmatch '(^|[:/])julyx10/lap(\.git)?$') { throw 'upstream URL is not the expected julyx10/lap repository' }
$developSha = ((Invoke-CheckedNative git @('rev-parse', 'develop')) -join '').Trim()
$mainSha = ((Invoke-CheckedNative git @('rev-parse', 'main')) -join '').Trim()
$statusText = ($statusLines -join '; ').Replace('|', '\|')
$templateText = Get-Content -LiteralPath (Join-Path $repoRoot 'docs/dev/SYNC-template.md') -Raw -Encoding utf8
Set-Content -LiteralPath $recordPath -Value $templateText -NoNewline -Encoding utf8
$record = Get-Content -LiteralPath $recordPath -Raw
$record = $record.Replace('| 同步日期 / 操作者 | |', "| 同步日期 / 操作者 | $($syncTime.ToString('yyyy-MM-dd HH:mm:ss zzz')) / 需填写操作者 |")
$record = $record.Replace('| 当前分支 / 工作区 | |', "| 当前分支 / 工作区 | $currentBranch；$statusText |")
$record = $record.Replace('| ``develop`` 基线 | |', "| ``develop`` 基线 | $developSha |")
$record = $record.Replace('| 本地 ``main`` 基线（旧 SHA） | |', "| 本地 ``main`` 基线（旧 SHA） | $mainSha |")
Set-Content -LiteralPath $recordPath -Value $record -NoNewline -Encoding utf8
Write-Output "syncId=$syncId developSha=$developSha mainSha=$mainSha isolatedWorktree=$isolatedWorktree recordPath=$recordPath"
```

**GO：** 当前分支为干净的 `develop`；`upstream` 远端地址已核实为 `julyx10/lap`；记录及隔离工作树路径均为新路径；已明确拟评估目标，并准备了上次记录的完整 upstream target SHA。否则停止。`$recordPath` 在仓库外，半成品不会弄脏基线工作树；写入记录不授权任何提交或分支推进。此时仅模板快照与基本基线已写入；提交裁决、冲突处理、门禁、环境与授权结果须按执行事实逐项补全，不得复制仍含空项的模板记录。

## 1. 冻结快照与差异评估

先保存 `develop`、本地 `main` 和上游起点 SHA，再 fetch。核对本地 `main` 与同步记录中的上一次上游目标；本地 `main` 是 fork 提交的祖先基线，不一定等于上一次 upstream SHA。必须同时核对上一次 target 等于当前 `develop`/上游的 merge-base；否则记录实际起点并暂停，先人工确认 fetch 窗口。核对确认后冻结 fetch 前 `upstream/main` 的完整 SHA 为起点，fetch 后固定目标 SHA；之后所有审查固定在该 SHA，即使远端分支继续移动也不扩大范围。

```powershell
# cwd: D:\MyCodes\AI-album\lap
$lastRecordedTarget = Read-Host '输入上次 SYNC 记录的 upstream target SHA；无记录或与当前 upstream/main 不一致时停止'
if ($lastRecordedTarget -notmatch '^[0-9a-fA-F]{40,64}$') { throw 'a previously recorded complete upstream target SHA is required' }
$upstreamBaseSha = ((Invoke-CheckedNative git @('rev-parse', 'upstream/main')) -join '').Trim()
if ($lastRecordedTarget -ne $upstreamBaseSha) { throw 'upstream moved since prior recorded target; verify intended sync interval before fetch' }
$mergeBaseBeforeFetch = ((Invoke-CheckedNative git @('merge-base', $developSha, $upstreamBaseSha)) -join '').Trim()
if ($lastRecordedTarget -ne $mergeBaseBeforeFetch) { throw 'previous upstream target is not the current develop/upstream merge-base; stop and reconcile history' }
& git merge-base --is-ancestor $lastRecordedTarget $mainSha
$ancestorExit = $LASTEXITCODE
if ($ancestorExit -ne 0) { throw "local main is not based on the previous recorded upstream target (exit $ancestorExit); stop and investigate" }
Invoke-CheckedNative git @('fetch', 'upstream')
$upstreamUrl = ((Invoke-CheckedNative git @('remote', 'get-url', 'upstream')) -join '').Trim()
if ($upstreamUrl -match '://[^/@]+@') { throw 'upstream URL contains credentials; stop and do not record it' }
if ($upstreamUrl -notmatch '(^|[:/])julyx10/lap(\.git)?$') { throw 'upstream URL changed; stop and revalidate source' }
$upstreamUrl = $upstreamUrl -replace '\.git$', ''
$record = Get-Content -LiteralPath $recordPath -Raw
$record = $record.Replace('| 上游来源 / fetch 时间 | |', "| 上游来源 / fetch 时间 | $($upstreamUrl -replace '^https://', '') / $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz') |")
Set-Content -LiteralPath $recordPath -Value $record -NoNewline -Encoding utf8
$upstreamTargetSha = ((Invoke-CheckedNative git @('rev-parse', 'upstream/main')) -join '').Trim()
$mergeBaseSha = ((Invoke-CheckedNative git @('merge-base', $developSha, $upstreamTargetSha)) -join '').Trim()
$forkBaseSha = $mainSha
if ($lastRecordedTarget -ne $mergeBaseSha) { throw 'upstream interval base differs from the develop/upstream merge-base; stop and reconcile history before assessing commits' }
$record = Get-Content -LiteralPath $recordPath -Raw
$record = $record.Replace('| `develop` 基线 | |', "| ``develop`` 基线 | $developSha |")
$record = $record.Replace('| 本地 `main` 基线（旧 SHA） | |', "| 本地 ``main`` 基线（旧 SHA） | $mainSha |")
$record = $record.Replace('| 上游基线（同步窗口起点） | |', "| 上游基线（同步窗口起点） | $upstreamBaseSha |")
$record = $record.Replace('| 上游目标（冻结，不再跟随移动分支） | |', "| 上游目标（冻结，不再跟随移动分支） | $upstreamTargetSha |")
$record = $record.Replace('| `develop` 与上游目标的 merge-base | |', "| ``develop`` 与上游目标的 merge-base | $mergeBaseSha |")
Set-Content -LiteralPath $recordPath -Value $record -NoNewline -Encoding utf8
Write-Output "upstreamBaseSha=$upstreamBaseSha upstreamTargetSha=$upstreamTargetSha mergeBaseSha=$mergeBaseSha"
Invoke-CheckedNative git @('log', '--reverse', '--format=%H %ad %s', '--date=iso-strict', "$upstreamBaseSha..$upstreamTargetSha")
Invoke-CheckedNative git @('diff', '--stat', '--find-renames', $upstreamBaseSha, $upstreamTargetSha)
Invoke-CheckedNative git @('diff', '--name-status', '--find-renames', $upstreamBaseSha, $upstreamTargetSha)
Invoke-CheckedNative git @('diff', '--stat', '--find-renames', $forkBaseSha, $developSha)
Invoke-CheckedNative git @('diff', '--name-status', '--find-renames', $forkBaseSha, $developSha)
```

命令将冻结 SHA 写入本次记录；后续比较只使用这些变量或记录的 SHA，不再引用会移动的 `upstream/main`。此处 `$mergeBaseSha` 是冻结的 `develop` 与上游目标共同祖先。对 fork 的文件差异，以记录的本地 `main` SHA 和 `develop` SHA 比较；它描述 fork 当前相对镜像基线的改动范围。所有差异需包含新增、删除、重命名及重命名前后路径。逐提交审查上游变化，并与 fork 差异做路径交集分析，重点检查 `src-vite/`、`src-tauri/src/`、`src-tauri/crates/`。记录每个提交的接收、适配、延后或拒绝决定、价值、迁移 / 安全 / 依赖 / 测试风险和证据。检查删除符号、命令/i18n/shortcut 契约、SQLite 迁移编号、配置 / 数据路径、许可与密钥处理。

**GO：** 每个上游提交均有可追溯裁决；fork 重叠均已解析；所有迁移、数据、安全、许可及依赖风险有验证策略；记录没有未决高风险。`defer` / `reject` 表示当前冻结目标不得直接合并；必须停止本次同步，或在候选中提出显式、可审查的适配/回退方案并重新评估，不能靠 cherry-pick 绕过冻结目标。否则停止，不进入合并。

## 2. 冻结后创建隔离候选

冻结快照和评估完成后、任何本地分支推进之前，在独立工作树中从记录的 `developSha` 建立候选分支，并以冻结的 `$upstreamTargetSha` 执行 no-commit merge。不得先快进本地 `main`：`main` 推进只在候选集成通过门禁后按 §6 单独授权。命令全程明确检查候选分支名、工作树根路径及两侧父提交 SHA。合并目标直接用冻结 SHA，不依赖本地 `main`。

```powershell
# cwd: D:\MyCodes\AI-album\lap
Set-Location $repoRoot
$currentDevelopSha = ((Invoke-CheckedNative git @('rev-parse', 'develop')) -join '').Trim()
if ($currentDevelopSha -ne $developSha) { throw 'develop changed since snapshot; stop and resnapshot' }
Invoke-CheckedNative git @('worktree', 'add', '-b', $syncBranch, $isolatedWorktree, $developSha)

# cwd: $isolatedWorktree（重新执行候选检查）
Set-Location $isolatedWorktree
$candidateRoot = [System.IO.Path]::GetFullPath(((Invoke-CheckedNative git @('rev-parse', '--show-toplevel')) -join '').Trim())
if ($candidateRoot -ne $isolatedWorktree) { throw 'candidate worktree root mismatch' }
$candidateBranch = ((Invoke-CheckedNative git @('branch', '--show-current')) -join '').Trim()
if ($candidateBranch -ne $syncBranch) { throw 'candidate branch mismatch' }
$candidateBaseSha = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
if ($candidateBaseSha -ne $developSha) { throw 'candidate was not created from frozen develop SHA' }
$candidateMergeBase = ((Invoke-CheckedNative git @('merge-base', $developSha, $upstreamTargetSha)) -join '').Trim()
if ($candidateMergeBase -ne $mergeBaseSha) { throw 'merge base differs from frozen snapshot assessment' }
& git merge --no-commit --no-ff $upstreamTargetSha
$mergeExit = $LASTEXITCODE
if ($mergeExit -ne 0) {
    $unmerged = @(Invoke-CheckedNative git @('diff', '--name-only', '--diff-filter=U'))
    if ($unmerged.Count -eq 0) { throw "git merge failed without unresolved paths (exit $mergeExit)" }
    Write-Output "Merge stopped for conflict resolution; unresolved paths: $($unmerged -join ', ')"
}
$candidateMergeSha = ((Invoke-CheckedNative git @('rev-parse', 'MERGE_HEAD')) -join '').Trim()
if ($candidateMergeSha -ne $upstreamTargetSha) { throw 'candidate MERGE_HEAD does not equal frozen upstream target' }
Write-Output "candidateRoot=$candidateRoot candidateBranch=$candidateBranch candidateBaseSha=$candidateBaseSha candidateMergeSha=$candidateMergeSha mergeExit=$mergeExit"
```

发生冲突时 `git merge --no-commit` 的非零退出码表示待解决冲突；仅当存在未合并路径时才按冲突流程继续。无冲突时命令停在尚未提交的合并状态。工作树和分支均为隔离候选，不改变共享 `develop` 或本地 `main`。记录保存于 `$recordPath`（仓库外），不得在仓库根创建同步记录。

## 3. 隔离候选冲突处理与审查

在候选工作树解决冲突，遵循逐提交裁决；对上游删除、移动或重命名的内容，在 fork 所有路径全局搜残留。命令、事件、协议、配置、locale 与资源路径改动需查相应契约。每个冲突及其证据写入仓库外同步记录。完成后确认无未合并路径、当前分支及工作树根仍匹配 §2，并核对 `developSha` 和 `$upstreamTargetSha` 是待合并的两个父历史。冲突无法按已记录裁决解决、发现新语义冲突 / 迁移风险，或候选不再是预期基线即为 **NO-GO**；停止，不推进任何分支。

## 4. 条件门禁

只在隔离候选结果上运行。进入前确认 `$isolatedWorktree` 根目录、`$syncBranch` 分支及 `HEAD` / `MERGE_HEAD` 分别对应记录的 `$developSha` / `$upstreamTargetSha`，不存在未解决冲突。上游未触及某些领域时可将专门检查记为“不适用”，说明依据；核心前端测试、类型门禁、前端构建及适用的 Rust 工作区测试不可省略。任何门禁失败即停止并保留原始输出。

```powershell
# cwd: D:\MyCodes\AI-album\lap；$isolatedWorktree 来自第 0 节
Set-Location $repoRoot
Set-Location $isolatedWorktree
$candidateRoot = [System.IO.Path]::GetFullPath(((Invoke-CheckedNative git @('rev-parse', '--show-toplevel')) -join '').Trim())
$candidateBranch = ((Invoke-CheckedNative git @('branch', '--show-current')) -join '').Trim()
$candidateHead = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
$mergeHead = ((Invoke-CheckedNative git @('rev-parse', 'MERGE_HEAD')) -join '').Trim()
if ($candidateRoot -ne $isolatedWorktree -or $candidateBranch -ne $syncBranch) { throw 'candidate worktree/branch mismatch' }
if ($candidateHead -ne $developSha -or $mergeHead -ne $upstreamTargetSha) { throw 'candidate merge parents do not match frozen SHAs' }
$unmerged = @(Invoke-CheckedNative git @('diff', '--name-only', '--diff-filter=U'))
if ($unmerged.Count -ne 0) { throw 'unresolved candidate conflicts remain' }

# cwd: $isolatedWorktree\src-vite
Set-Location (Join-Path $isolatedWorktree 'src-vite')
Invoke-CheckedNative npm.cmd @('run', 'typecheck:gate')
Invoke-CheckedNative npm.cmd @('run', 'test')
Invoke-CheckedNative npm.cmd @('run', 'test:crossrefs')
Invoke-CheckedNative npm.cmd @('run', 'build')

# cwd: $isolatedWorktree\src-tauri
Set-Location (Join-Path $isolatedWorktree 'src-tauri')
$env:CARGO_TARGET_DIR = Join-Path $isolatedWorktree 'src-tauri/target'
Invoke-CheckedNative cargo @('test', '--workspace')
# 仅当 client feature / 其依赖路径受影响，或发布目标包含 client 时运行
Invoke-CheckedNative cargo @('test', '-p', 'lappp', '--no-default-features', '--features', 'client')

# cwd: $isolatedWorktree
Set-Location $isolatedWorktree
$env:CARGO_TARGET_DIR = Join-Path $isolatedWorktree 'src-tauri/target'
Invoke-CheckedNative pwsh @('-File', 'scripts/build-windows.ps1', '-BuildProfile', 'debug')
```

`npm run test` 已包含 `test:crossrefs`；显式再运行一次用于单独记录跨引用门禁。`test:crossrefs` 只验证：前端 `invoke` 与 Tauri handler、i18n 调用与 `en.json` 回退键、shortcut 调用与注册 ID。它不证明所有 locale 文件键齐全；改动 locale 时须另行比较各语言键集合。主题计数有逻辑测试，但没有完整 GUI 主题计数断言。

若上游触及 Rust workspace / feature 边界，运行两条 Cargo 测试；不相关时在记录中列明依据并标为不适用。debug 便携构建是部署候选时需构建三件套。若上述某命令失败，禁止推进分支，禁止以改基线、跳过测试或只报部分测试通过的方式规避。

## 5. 隔离数据库迁移与 GUI smoke（按需；GUI smoke 须独立授权）

迁移风险存在时，必须用隔离数据库副本验证。无需迁移风险时记录理由。**禁止把真实用户图库作为必测项。** GUI smoke 也须取得独立授权并使用独立的应用数据根目录和测试图片副本；不允许仅靠 `--data-dir` 推定隔离完成。迁移快照应从候选工作树执行；真实原始 DB 路径必须在隔离完成、目录 ACL 已确认后才输入脚本。

### 准备 DB 和完整应用数据隔离

备份工具只复制一个 SQLite DB，目标文件必须不存在、父目录须已存在：

```powershell
# cwd: $isolatedWorktree\src-tauri；候选工作树必须已初始化子模块；快照目标目录由操作者确认 ACL 安全
Set-Location (Join-Path $isolatedWorktree 'src-tauri')
$sourceDb = (Read-Host '输入已授权读取且已确认的数据源 SQLite DB 绝对路径').Trim('"')
$snapshotDb = (Read-Host '输入一个安全目录下新的快照 DB 绝对路径（目标文件必须不存在）').Trim('"')
if (-not [System.IO.Path]::IsPathFullyQualified($sourceDb) -or -not (Test-Path -LiteralPath $sourceDb -PathType Leaf)) { throw '源 DB 路径无效' }
if (-not [System.IO.Path]::IsPathFullyQualified($snapshotDb) -or (Test-Path -LiteralPath $snapshotDb)) { throw '快照目标必须是不存在的绝对路径' }
if (-not (Test-Path -LiteralPath (Split-Path -Parent $snapshotDb) -PathType Container)) { throw '快照目标父目录不存在' }
Invoke-CheckedNative python @('-I', '..\\scripts\\backup-library-db.py', $sourceDb, $snapshotDb)
```

核对工具输出中的 `integrity_check: ok`、源与副本的 `user_version`、`afiles` / `albums` / `afolders` 行数相同。该脚本不备份 `app-config.json`、sidecar、缩略图缓存、图片、外部 `db_storage_dir` 或模型；不可把 DB 快照称为完整应用备份。

为每次迁移或 GUI smoke 建立隔离目录，另行准备独立的 `app-config.json` 与数据库副本。应用数据根目录中 `app-config.json` 位于根下，默认库位于 `libraries/`；若 `db_storage_dir` 有自定义值，库则从该配置路径解析。逐项检查配置中所有 library DB 路径、`db_storage_dir`、图片根路径和 `thumbnail_cache_dir`；自定义值不能指向真实资产。未设置自定义 thumbnail cache 时，默认缓存使用平台应用 cache 目录，不自动跟随 `--data-dir`；smoke 前需将 `thumbnail_cache_dir` 设置为隔离路径或确认默认 cache 不含/不触及真实用户资产。检查 cache 下其他缓存、secret 文件、sidecar 及模型可能访问/写入的路径。无法确认全部路径隔离时，不启动 GUI。迁移先作用于隔离副本；记录迁移前后 `user_version`、关键表/索引及行数检查结果。需要恢复时从只读快照在新路径重建隔离副本，不覆盖源库。

### GUI smoke 事实与执行

`scripts/smoke-desktop.mjs` 要求显式设置 `LAP_SMOKE_DATA_DIR`，不提供默认值；代码将 `--data-dir` 精确设为该路径、不自动追加后缀。debug app-data 根通常为 `%LOCALAPPDATA%\com.julyx10.lap.debug`，release 为 `%LOCALAPPDATA%\com.julyx10.lap`；不能把默认目录当作隔离目录。检查隔离根下生成/读取的 config、DB、缓存及用户数据路径都没有外指向真实资产。模型优先从 app-data 的 `models` 解析，缺失时回退到可执行文件/资源目录的 `models`；确认二者都不是需保护的用户可写数据位置。

冒烟默认原图阈值为 `LAP_SMOKE_MIN_WIDTH=800`（不是 1500），并检查缩略图、滚动后缩略图、双击 viewer 原图解码和 console 错误。冒烟脚本会自行重建仓库 debug exe；保留默认 `LAP_SMOKE_EXE`，显式设置 `LAP_SMOKE_DATA_DIR` 为已验证的隔离根目录。脚本检测到已有 lappp 实例时会拒绝运行，不要关闭或杀掉用户实例。

以下示例保存并还原环境变量原先的「未设置/已设置」状态，即使 smoke 命令失败也如此。若外层 PowerShell 被强制终止，`finally` 不保证执行；手动恢复到原状态。此环境变量只影响 smoke 子进程，不会自行设置应用内配置。

在启动 smoke 前，先把 `src-tauri/tauri.windows.conf.json` 复制到仓库外一个确认不存在的备份路径，并记录 SHA-256；这份备份保留直到检查正常清理完成。脚本会拒绝原配置中已有 `remote-debugging-port` 的情形。备份能在不可捕获中断后恢复原始配置字节，包括 smoke 前用户未提交的编辑。

```powershell
# cwd: D:\MyCodes\AI-album\lap
Set-Location $repoRoot
$isolatedDataRoot = (Read-Host '输入已审查且含测试副本的隔离应用数据根绝对路径').Trim('"')
if (-not [System.IO.Path]::IsPathFullyQualified($isolatedDataRoot) -or -not (Test-Path -LiteralPath $isolatedDataRoot -PathType Container)) { throw '隔离应用数据根路径无效或不存在' }
$configPath = Join-Path $isolatedWorktree 'src-tauri/tauri.windows.conf.json'
$configBackupPath = (Read-Host '输入仓库外新的 smoke 配置备份绝对路径（目标必须不存在）').Trim('"')
if (-not [System.IO.Path]::IsPathFullyQualified($configBackupPath) -or (Test-Path -LiteralPath $configBackupPath)) { throw '配置备份目标必须是不存在的绝对路径' }
$configBackupPath = [System.IO.Path]::GetFullPath($configBackupPath)
if ($configBackupPath.Equals([System.IO.Path]::GetFullPath($configPath), [System.StringComparison]::OrdinalIgnoreCase)) { throw '配置备份不能覆盖 smoke 配置文件' }
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
if ($configBackupPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw '配置备份必须保存在仓库外' }
if (-not (Test-Path -LiteralPath (Split-Path -Parent $configBackupPath) -PathType Container)) { throw '配置备份父目录不存在' }
$configBeforeSmokeHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
Copy-Item -LiteralPath $configPath -Destination $configBackupPath
$configBackupHash = (Get-FileHash -LiteralPath $configBackupPath -Algorithm SHA256).Hash
if ($configBackupHash -ne $configBeforeSmokeHash) { throw 'config backup hash differs from source; do not run smoke' }
Write-Output "configBackupPath=$configBackupPath configBackupSha256=$configBackupHash"
$hadSmokeDataDir = Test-Path Env:\LAP_SMOKE_DATA_DIR
$previousSmokeDataDir = $env:LAP_SMOKE_DATA_DIR
try {
    $env:LAP_SMOKE_DATA_DIR = $isolatedDataRoot
    Set-Location (Join-Path $isolatedWorktree 'src-vite')
    Invoke-CheckedNative npm.cmd @('run', 'smoke:desktop')
} finally {
    if ($hadSmokeDataDir) { $env:LAP_SMOKE_DATA_DIR = $previousSmokeDataDir }
    else { Remove-Item Env:\LAP_SMOKE_DATA_DIR -ErrorAction SilentlyContinue }
    Set-Location $repoRoot
}
$configAfterSmokeHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
if ($configAfterSmokeHash -ne $configBackupHash) { throw 'smoke config differs from saved original; stop and restore/inspect manually' }
```

冒烟脚本在正常完成及可处理的异常/信号清理中，通过 `restore-clean-build.mjs` 尝试恢复 `tauri.windows.conf.json` 原始字节、停止 smoke 子进程并重建不含调试端口的 exe。进程被强制结束、系统崩溃或断电等不可捕获中断不会执行这些处理，不能以 signal cleanup 推断这类场景已恢复。发生此类中断后，在再次构建、启动或部署前人工检查 `src-tauri/tauri.windows.conf.json`。仅在确认 `$configBackupPath` 是本次 smoke 前保存的仓库外备份、SHA-256 等于 `$configBackupHash`，且目标确为 `$configPath` 后，执行以下恢复；随后检查配置哈希，并从隔离候选的 `src-tauri` 做干净重建：

```powershell
# cwd: D:\MyCodes\AI-album\lap；仅在已确认备份、hash 和目标路径后执行
Set-Location $repoRoot
if ((Get-FileHash -LiteralPath $configBackupPath -Algorithm SHA256).Hash -ne $configBackupHash) { throw 'smoke config backup hash mismatch; do not restore from this file' }
Copy-Item -LiteralPath $configBackupPath -Destination $configPath -Force
$restoredConfigHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
if ($restoredConfigHash -ne $configBackupHash) { throw 'restored smoke config hash mismatch' }
Set-Location (Join-Path $isolatedWorktree 'src-tauri')
Invoke-CheckedNative cargo @('build', '-p', 'lappp')
```

若备份缺失/校验不符或干净重建失败，停止后续操作并报告，不覆盖/部署产物。正常完成时保留备份到配置哈希一致、干净重建成功均已确证后；记录清理及退出码的实际证据，不得把未验证项写作已通过。

## 6. 报告、关闭与推进（每个动作单独授权）

同步记录须包含完整 SHA、提交/文件差异、逐提交裁决、所有门禁的精确 cwd / 命令 / 环境 / 退出码 / 日志位置、数据隔离与恢复细节、未覆盖范围及 NO-GO/GO 理由。不能填入未经执行的结果。完成所有门禁与审查后，先将记录在 `$recordPath`（仓库外）补齐并保存；记录完成本身不授权复制、提交或推进任何分支。严格按以下命令顺序执行：门禁通过后，取得单独授权，将最终记录复制到隔离候选并创建集成 merge commit；随后（如本地 `main` 尚未在冻结目标）取得另一项授权，将本地 `main` 快进到冻结 upstream SHA；最后取得第三项授权，将验证过的集成 commit 快进到 `develop`。每一动作只在对应的独立授权存在时执行；未授权的动作停止在相应边界，不得推定后续授权。

### 将记录纳入隔离集成提交

只有在门禁通过并取得**单独的隔离集成 merge commit 授权**后，才把最终记录复制进候选；不得覆盖同名文件。检查复制前后哈希一致，并核对候选工作树/分支、合并双方 SHA 及完整 staged diff。冲突解决结果需逐项复核并 stage；不要用 `git add -A`。暂存记录后必须确认没有剩余未暂存的 tracked 改动或意外 untracked 文件，否则停止并检查，不提交不明内容。记录文件与已验证的集成候选必须同属该 merge commit。

```powershell
# cwd: D:\MyCodes\AI-album\lap
Set-Location $repoRoot
Set-Location $isolatedWorktree
$candidateRoot = [System.IO.Path]::GetFullPath(((Invoke-CheckedNative git @('rev-parse', '--show-toplevel')) -join '').Trim())
$candidateBranch = ((Invoke-CheckedNative git @('branch', '--show-current')) -join '').Trim()
$candidateHead = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
$mergeHead = ((Invoke-CheckedNative git @('rev-parse', 'MERGE_HEAD')) -join '').Trim()
if ($candidateRoot -ne $isolatedWorktree -or $candidateBranch -ne $syncBranch) { throw 'candidate worktree/branch mismatch' }
if ($candidateHead -ne $developSha -or $mergeHead -ne $upstreamTargetSha) { throw 'candidate merge parents do not match frozen SHAs' }
$unmerged = @(Invoke-CheckedNative git @('diff', '--name-only', '--diff-filter=U'))
if ($unmerged.Count -ne 0) { throw 'unresolved candidate conflicts remain' }
$unstagedBeforeRecord = @(Invoke-CheckedNative git @('diff', '--name-only'))
if ($unstagedBeforeRecord.Count -ne 0) { throw 'candidate has unstaged changes; inspect and stage only reviewed merge resolutions' }
$untrackedBeforeRecord = @(Invoke-CheckedNative git @('ls-files', '--others', '--exclude-standard'))
if ($untrackedBeforeRecord.Count -ne 0) { throw "candidate has unexpected untracked files: $($untrackedBeforeRecord -join ', ')" }
$repoRecordPath = Join-Path $isolatedWorktree "docs/dev/$recordName"
if (Test-Path -LiteralPath $repoRecordPath) { throw "candidate record path already exists: $repoRecordPath" }
Copy-Item -LiteralPath $recordPath -Destination $repoRecordPath
$externalRecordHash = (Get-FileHash -LiteralPath $recordPath -Algorithm SHA256).Hash
$candidateRecordHash = (Get-FileHash -LiteralPath $repoRecordPath -Algorithm SHA256).Hash
if ($candidateRecordHash -ne $externalRecordHash) { throw 'copied record hash mismatch' }
Invoke-CheckedNative git @('add', '--', "docs/dev/$recordName")
Invoke-CheckedNative git @('diff', '--cached', '--check')
& git diff --quiet
$unstagedExit = $LASTEXITCODE
if ($unstagedExit -ne 0) { throw 'unstaged tracked changes remain; inspect/stage only reviewed conflict resolutions' }
$untracked = @(Invoke-CheckedNative git @('ls-files', '--others', '--exclude-standard'))
if ($untracked.Count -ne 0) { throw "unexpected untracked files remain: $($untracked -join ', ')" }
Invoke-CheckedNative git @('status', '--short')
Invoke-CheckedNative git @('diff', '--cached', '--stat')
Invoke-CheckedNative git @('diff', '--cached', '--name-status', '--find-renames')
Write-Output "candidateRoot=$candidateRoot candidateBranch=$candidateBranch candidateBaseSha=$candidateHead upstreamTargetSha=$mergeHead recordPath=$repoRecordPath recordSha256=$candidateRecordHash"

# cwd: $isolatedWorktree；仅已获创建该隔离集成 merge commit 的单独授权后运行
Invoke-CheckedNative git @('commit', '-m', 'Merge frozen upstream into develop')
$integrationSha = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
$integrationParents = ((Invoke-CheckedNative git @('rev-list', '--parents', '-n', '1', $integrationSha)) -join '').Trim()
if ($integrationParents -notmatch "^$integrationSha $developSha $upstreamTargetSha$") { throw 'integration commit parents do not match frozen candidate SHAs' }
Write-Output "integrationSha=$integrationSha integrationParents=$integrationParents"
```

若没有这项 commit 授权，不复制记录；将最终记录留在仓库外 `$recordPath`，并在结论中原样报告该绝对路径。为关闭未提交候选且不留下脏工作树，在记录和门禁证据已保存、候选确为本 SOP 创建并且没有额外未跟踪资产后，从隔离工作树执行 `git merge --abort`，确认工作树干净，再从仓库根移除本流程创建的隔离工作树；不要清理用户已有路径或工作树。此路径只移除工作树目录，保留本流程新建的 `$syncBranch`（仍指向 `$developSha`），并在记录中注明：

```powershell
# cwd: $isolatedWorktree；仅限本 SOP 创建且仍为未提交合并状态的候选
Set-Location $isolatedWorktree
Invoke-CheckedNative git @('merge', '--abort')
$remainingChanges = @(Invoke-CheckedNative git @('status', '--porcelain'))
if ($remainingChanges.Count -ne 0) { throw 'candidate is not clean after merge abort; preserve it and stop' }

# cwd: D:\MyCodes\AI-album\lap
Set-Location $repoRoot
Invoke-CheckedNative git @('worktree', 'remove', $isolatedWorktree)
Write-Output "record remains outside repository: $recordPath"
```

### 门禁通过后的本地 `main` 快进

本地 `main` 只快进到冻结的 `$upstreamTargetSha`，绝不指向集成 merge commit。门禁通过后，若 `main` 尚未到目标，必须先取得**单独明确的本地 main 快进授权**；随后必须验证 `main` 仍等于初始 `$mainSha`，否则停止并重新评估/授权。若已等于冻结目标则只做核验、不执行分支变更；若变为其他 SHA 则停止。此动作不包含 push。

```powershell
# cwd: D:\MyCodes\AI-album\lap；若 main 已在目标，只执行核验无需授权，跳过分支变更；否则先取得本地 main 快进单独授权再运行
Set-Location $repoRoot
$currentMainSha = ((Invoke-CheckedNative git @('rev-parse', 'main')) -join '').Trim()
if ($currentMainSha -eq $upstreamTargetSha) {
    Write-Output "main already at frozen target: $currentMainSha"
} elseif ($currentMainSha -eq $mainSha) {
    Invoke-CheckedNative git @('merge-base', '--is-ancestor', $mainSha, $upstreamTargetSha)
    Invoke-CheckedNative git @('switch', 'main')
    Invoke-CheckedNative git @('merge', '--ff-only', $upstreamTargetSha)
    $mainResultSha = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
    if ($mainResultSha -ne $upstreamTargetSha) { throw 'main is not at frozen upstream target' }
} else {
    throw 'main changed from frozen old SHA to a different target; stop and resnapshot'
}
```

### 将已验证集成提交快进到共享 `develop`

只有存在上节生成并核验过的 `$integrationSha`，本地 `main` 已核实等于 `$upstreamTargetSha`，且另有**明确的本地 develop 快进授权**时，才推进 `develop`。从隔离工作树操作时先回到仓库根，再切换分支；复核集成 worktree SHA、目标分支旧 SHA 与 merge ancestry。若隔离工作树已按未授权分支处置步骤关闭，则不能执行本段，须保留新鲜的验证候选并从头确认门禁与授权。

```powershell
# cwd: $isolatedWorktree；仅持有有效 integrationSha 且尚未关闭候选时核验
Set-Location $isolatedWorktree
$candidateRoot = [System.IO.Path]::GetFullPath(((Invoke-CheckedNative git @('rev-parse', '--show-toplevel')) -join '').Trim())
$candidateBranch = ((Invoke-CheckedNative git @('branch', '--show-current')) -join '').Trim()
$candidateHead = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
if ($candidateRoot -ne $isolatedWorktree -or $candidateBranch -ne $syncBranch -or $candidateHead -ne $integrationSha) { throw 'verified integration worktree, branch, or SHA changed' }
$recordInCommit = @(Invoke-CheckedNative git @('show', '--format=', '--name-only', $integrationSha, '--', "docs/dev/$recordName"))
if ($recordInCommit.Count -ne 1 -or $recordInCommit[0] -ne "docs/dev/$recordName") { throw 'final sync record is not included in the integration commit' }

# cwd: D:\MyCodes\AI-album\lap；仅 main 已核实到目标且另获 develop 快进授权时运行
Set-Location $repoRoot
$currentMainSha = ((Invoke-CheckedNative git @('rev-parse', 'main')) -join '').Trim()
if ($currentMainSha -ne $upstreamTargetSha) { throw 'main is not at frozen upstream target' }
$currentDevelopSha = ((Invoke-CheckedNative git @('rev-parse', 'develop')) -join '').Trim()
if ($currentDevelopSha -ne $developSha) { throw 'develop changed from frozen base; stop and resnapshot' }
Invoke-CheckedNative git @('merge-base', '--is-ancestor', $developSha, $integrationSha)
Invoke-CheckedNative git @('merge-base', '--is-ancestor', $upstreamTargetSha, $integrationSha)
Invoke-CheckedNative git @('switch', 'develop')
Invoke-CheckedNative git @('merge', '--ff-only', $integrationSha)
$developResultSha = ((Invoke-CheckedNative git @('rev-parse', 'HEAD')) -join '').Trim()
if ($developResultSha -ne $integrationSha) { throw 'develop is not at verified integration SHA' }
```

授权仅覆盖明确的本地分支目标；push `origin/main` 或 `origin/develop` 均须另行授权，不包含在本 SOP 命令中。不得将任何授权推定为其他提交、分支推进或对外动作授权。

### 部署 / 发布矩阵

| 构建 | 输出 | 数据目录 | 用途与约束 |
|---|---|---|---|
| Debug 三件套 | `build\windows\debug\lappp.exe`、`lappp-client.exe`、`lappp-server.exe` | `%LOCALAPPDATA%\com.julyx10.lap.debug`（除非显式 `--data-dir`） | 调试、隔离验证、当前便携测试候选；不是 release 产品包 |
| Release 三件套 | `build\windows\lappp.exe`、`lappp-client.exe`、`lappp-server.exe` | `%LOCALAPPDATA%\com.julyx10.lap`（除非显式 `--data-dir`） | 产品形态；部署时须明确用户看到的是另一数据目录 |

部署前须为目标目录内**所有将被替换的文件**制作可恢复备份并记录清单、文件名、时间与校验值，不只备份 exe。`D:\LapPortable` 的覆盖需要单独授权并明确目标；核实实际会替换的 exe、资源、模型、配置及其他文件，发布构建不得包含 `--remote-debugging-port`。验证与回滚路径未确认前不得覆盖。发布/对外分发另需独立授权，并检查 GPL 与 InsightFace 模型许可约束。不得用真实图库作为强制验收条件。

## 7. 事故索引（摘要）

| 日期 / 事件 | 规则与详细证据 |
|---|---|
| 2026-11-18：上游删除快捷键动作后 fork 留下悬空引用；渲染异常导致宫格空缺、查看器白屏 | 冻结区间逐提交审查、fork 路径交集与跨引用检查；详见 [排查记录](排查-2026-11-18-宫格空缺与原图白屏.md) |
| 2026-11-18：v0.4.0 迁移编号与 fork schema 重叠 | 隔离副本演练、核对版本及 schema，不在真实库试迁移；评估与历史证据见 [v0.4.0 同步评估](SYNC-v0.4.0-同步评估-2026-11-18.md) |
| 2026-11-19：前端聚合 runner 曾假绿；类型门禁发现合并引入类型错 | 门禁须确实执行并保留失败证据；详见 [7 提交同步记录](SYNC-2026-11-19-上游7提交合并.md) 及 [历史记录](SOP-上游同步升级-历史记录.md) |
| 2026-11-19：smoke 可能触及默认用户数据目录；调试端口恢复需验证 | smoke 需明确隔离 app-data 与所有配置外部路径，记录恢复及干净重建结果；详见脚本 `scripts/smoke-desktop.mjs` 和 `scripts/restore-clean-build.mjs` |
