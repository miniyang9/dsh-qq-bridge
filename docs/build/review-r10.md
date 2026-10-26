# 评审 · 轮次 10（修复轮）

评审对象：R9 判「可交接」之后的所有改动（在场门控、`/say` 分片、打包、契约、文档、修复轮 11 套红 → 56 绿）。
评审基准：HEAD `3d44113`（`docs: 定基线（H9）与 D17=10 可配落地`），工作树开始时干净。

评审方式：**自己跑**（不引用台账数字）——56 套逐套单跑取**退出码**、5 个自写探针（`.tmp/r10-probe.mjs`、`r10-probe2.mjs`、`r10-gate.mjs`、`r10-shard-d17.mjs`、`r10-detect.mjs`，只 import 实现，不改仓库）、
逐条读 `src/app/bridge.js` 的全部 1720 行。凡引用行号均按当前文件实测。

## 交接结论：不可交接（阻断 3）

| 阻断 | 一句话 | 方向 |
|---|---|---|
| **B1** | PowerShell 探针把「取不到值」读成 `0` 毫秒 → 判定恒为「在场」→ 门控把该发的全吞掉，且它自己的文件兜底永不触发 | 该发被吞 |
| **B2** | 17 个主动推送点里 **5 个没过 `#present()`**，其中 2 个是「你在电脑上答完了，却还推你手机」 | 该静音没静音 |
| **B3** | `02-contracts.md` 的 `WaitPoint` 契约与实现不符（`kind` 封闭集缺 `'say'`、`dropReason` 封闭集少 5 个实际值、`answerMode` 全仓不存在） | 契约 |

其余四项（基线、探针兜底链、分片、D17/A33）**逐项实测通过**，见下。文档抽查发现 3 处非阻断偏差，列在建议里。

## 基线实测

按 `docs/build/baseline.md` 的复跑方法，**逐套单跑、按进程退出码**判绿（不做文本匹配）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"   # v24.21.0
Get-ChildItem test -Filter *.mjs |
  Where-Object { $_.Name -notin @('_setup.mjs','s1-waterfall.test.mjs','s3-loop.mjs') } |
  Sort-Object Name |
  ForEach-Object { & $node $_.FullName; if ($LASTEXITCODE -ne 0) { "RED: " + $_.Name } }
```

实测输出：

```
=== TOTAL=56 GREEN=56 RED=0 ===
```

- `test/*.mjs` 共 **59** 个；排除 `_setup.mjs`、`s1-waterfall.test.mjs`（真 cordis）、`s3-loop.mjs`（真实通道）= **56**，与 `baseline.md` 的 `TOTAL=56 GREEN=56 RED=0` **逐数一致**。
- 绿不是"空壳绿"：抽查 `test/s52-presence.mjs`、`test/s53-gating-pages.mjs` 均为 `check()` 累积 + `process.exit(failures.length===0?0:1)`，断言失败必然非零退出。
- 未复跑 3 个豁免套件（s1-waterfall 需 Electron / s3-loop 需真实通道），其豁免理由与 `baseline.md` 一致，属合理排除。
- 结论：**基线可复现**。此项不阻断。

## 门控覆盖表（推送点 → 是否被门控 → 判断）

`#present()`（`src/app/bridge.js:1193`）的三种取值：`pc` → 在场、`away` → 离开、`auto` → `presence.state === 'present'`。
`presence` 只在 `tick()`（`:1312`，生产由 `lib/index.js:143` 每 60s 调一次）里采样，其余路径只读状态。

**全部主动推送点（17 个 + 1 个被动回复对照）**：

| # | 推送点 | 行 | 是否过 `#present()` | 判断 |
|---|---|---|---|---|
| 1 | 断网摘要（`ready` + `failedSends>0`） | `:221` | **否** | ❌ **漏点**：同段代码里紧邻的「重连提示」是门控的（`:225`），两条同胞通知一半门控一半不门控 |
| 2 | 重连提示（`recovered`） | `:225` | 是 | ✅ |
| 3 | 重启后待答点作废（`onReady`） | `:283` | **否** | ❌ **漏点** |
| 4 | 审批/提问卡片（`#queueCard`） | `:556-564` | 是（在场置 `pushedToQQ=false` 并返回） | ✅ |
| 5 | 合并窗口冲刷（`#flushCards`） | `:573-581` | 入队时已判 | ✅（窗口 1.5s，可忽略） |
| 6 | 离开补推（`#flushPending`） | `:1167-1175` | 不适用（由 `away` 转换触发） | ✅ 实测发出 |
| 7 | 跑完通知（`turn/end`） | `:1138-1139` | 是 | ✅ |
| 8 | 停滞一级 | `:1331-1332` | 是 | ✅ |
| 9 | 停滞二级 | `:1325-1326` | 是 | ✅ |
| 10 | 30 分钟催办 | `:1347-1348` | 是 | ✅ |
| 11 | 10 分钟催办 | `:1357-1358` | 是 | ✅ |
| 12 | **5 分钟兜底** | `:1363-1370` | **否（有意）** | ✅ 设计如此：`/pc` 回执（`:346`）与手册 `:125` 都写明「审批 5 分钟没人答仍会推」。实测发出 |
| 13 | `/say` 回执（分片首片） | `:1396` | **否** | △ 可接受：由手机端 `/say` 触发，属"被请求的回复"，不静音合理 |
| 14 | 审批「已在电脑端处理」 | `:1539` | **否** | ❌ **漏点**（最严重的一条，见下） |
| 15 | 提问「已在电脑端答复」 | `:1634` | **否** | ❌ **漏点**（同上） |
| 16 | 咨询 5 分钟无追问自动结束 | `:849-851`（`endConsult`，`data=null`） | **否** | ❌ **漏点** |
| 17 | 退出通知 `sayGoodbye` | `:1683` | **否** | △ 可接受（"我下班了"是终止告知）；建议：在场时可省 |
| — | `/why` 咨询答复 | `:1097` | 不适用（被动回复 `msgId=data.id`，超窗转主动） | ✅ 无需门控 |

**漏点 = 5 条（#1、#3、#14、#15、#16）**，其中 #14/#15 是本轮让"在场不打扰"失效的主路径：GUI 答题正是"人在电脑前"时才会发生的事，却每条都往手机推一条。

实测（`.tmp/r10-gate.mjs`：把 `presence` 钉成 `present` 后逐个触发）：

```
=== 1) 断网摘要（ready / failedSends>0） ===
PUSHED（未静音）  断网摘要
    A:断网期间有 3 条没送达，最早一条在 03:12。要逐条补发请说一声，否则只给这条摘要。

=== 2) 重连提示（recovered） ====
muted（已静音）  重连提示

=== 3) 重启作废通知（onReady） ===
PUSHED（未静音）  重启作废通知
    A:我重启过。上次非正常结束时，有 2 个待答请求已作废（不会重放），请重新触发。

=== 4) GUI 端先答审批 ===
  返回值 = allowed-once
muted（已静音）  卡片本身
PUSHED（未静音）  “已在电脑端处理”通知
    A:已在电脑端处理（allowed-once），这条不用再回手机。

=== 5) GUI 端先答提问 ===
  返回值 = {"answers":[{"id":"q1","selected":["A"]}]}
muted（已静音）  提问卡片
PUSHED（未静音）  “已在电脑端答复”通知
    A:已在电脑端答复（A），这条不用再回手机。

=== 6) 咨询 5 分钟无追问自动结束 ===
PUSHED（未静音）  咨询结束通知
    A:咨询已结束（会话 c1，共 2 轮，原因：300s 无追问；归档未成功（拿不到 workspaceController））

=== 7) 退出通知（sayGoodbye） ===
PUSHED（未静音）  退出通知
    A:我下班了（桥接退出）

=== 8) 5 分钟兜底（设计上故意不静音） ===
PUSHED（未静音）  5 分钟兜底
    A:[补发] 你在电脑前但 5 分钟没有处理，这条先推给你 ⏎ [wp-3] 需要你批准：fs.read …

=== 9) 离开补推（#flushPending） ===
  在场时卡片是否发出 = false
PUSHED（未静音）  离开补推
    A:[补发] 你现在离开了，这条先补给你 ⏎ [wp-4] 需要你批准：fs.read …
```

即 #4（修复轮补的"卡片门控"）、#12（5 分钟兜底）、#6（离开补推）三条**主路径行为正确**；漏的是外围通知。

**另记一处静音即消费、离开不补**（不阻断，但建议写进 ADR-30）：`tick()` 在过门控**之前**就把标记置位——
`:1324` `st.notified.stall2 = true`、`:1330` `st.notified.stall1 = true`、`:1344` `meta.remind30 = true`、`:1354` `meta.remind10 = true`。
于是"在场时到点"的 10/30 分钟催办被永久吞掉；用户随后离开，`#flushPending` 又因 `pushedToQQ===true`（`:1171`）跳过该请求。
跑完/停滞通知同理（ADR-30 只说"只补推仍 open 的请求"，所以这与决策一致，只是结果要说清）。

## 其他四项

### 3. `powerMonitor` 兜底链：**探测链本身是通的，但"取不到值"被读成 0（B1）**

实测（`.tmp/r10-probe.mjs`，本机 win32、非 Electron 进程）：

```
platform = win32
versions.electron = (none)
electronIdleProbe() -> null
detectIdleProbe() -> kind = powershell | reason = (none)
  probe() -> 0
  Presence.state -> present | describe = {"state":"present","idleText":"0 分钟"}
powershellIdleProbe() -> function
  pipe-mode value -> 0
  file-mode value -> 118172          ← 同一次进程、同一台机器
```

- `electronIdleProbe()` 在非 Electron 下返回 `null` 是**设计内的**（`presence.js:82-94`，用 `createRequire` 而非裸 `require`，R 前修的"恒为 null"没有复活）。
- `detectIdleProbe()` 在 `win32` 上无条件试 PowerShell（`presence.js:157-166`），**不**以 `process.versions.electron` 为条件——这是上一轮刻意改的，行为正确。
- **应急路径存在但走不到**：文件兜底（`presence.js:130-142`）确实有效（`DSH_IDLE_FORCE_FILE=1` → `118172` / `719`），
  但它前面那道"管道通道"在**取不到输出时也会返回 0**，于是永远轮不到文件通道。

根因（`.tmp/r10-probe2.mjs` 实测沙箱里管道被禁的样子）：

```
[B] 真实探针 body（与 presence.js 完全一致，管道模式）
  status = null | signal = null
  stdout = undefined
  error = EPERM: spawnSync powershell.exe EPERM
  Number(trim(stdout)) = 0

[判定] Number("") === 0 ? true
presence.js 的判据 `Number.isFinite(n) && n >= 0` 对空输出成立 → true
```

`spawnSync` 在 spawn 失败时**不抛异常**，只设 `r.error`；`presence.js:124-125` 的
`Number(String(r.stdout ?? '').trim())` 把空串变成 `0`，`Number.isFinite(0) && 0 >= 0` 成立 → 直接 `return 0`。
`0` 毫秒 = "刚刚动过键盘" = **在场**，于是所有过门控的推送被静音，`kind` 还报 `powershell`（`/mode` 会显示"探针：powershell／空闲 0 分钟"，是假信息）。

真实构造（不注入探针）复现（`.tmp/r10-detect.mjs`）：

```
idleProbeKind = powershell | reason = null
presence.state（两次采样后）= present | idleMs = 0
--- 真实 /mode 回话 ---
模式：自动
判定：在场（不打扰）
依据：空闲 0 分钟
探针：powershell
规则：空闲 < 5 分钟视为在场，≥5 分钟视为离开

DSH_IDLE_FORCE_FILE=1 时探针值 = 719 ms（真实空闲）
```

影响面（按严重度）：跑完/停滞/催办通知**永久丢失**（没有重发机制）；审批与提问卡片**不算丢**，但会退化成"5 分钟兜底"（`:1370` 不门控）——最严重的一条审批路径变成**恒定延迟 5 分钟**。"离开补推"也不再发生（状态永远到不了 `away`）。

现状无测试覆盖：`s52` 全是注入探针（`new Presence({probe})`），`s53` 用 `idleProbe: () => idle`，两条通道的**真实**分支都没有用例。

### 4. `/say` 分片：**正确（含边界）**

实测（`.tmp/r10-shard-d17.mjs`，走真 `onSessionEvent(turn/end)` → `#relaySayResult`）：

| 用例 | 首行 | 含 `/more` | 判定 |
|---|---|---|---|
| 800 字（正好一片） | `会话 shard- 回复：` | 否 | ✅ 不触发分片 |
| 801 字 | `会话 shard- 回复（1/2 片）：` | 是 | ✅ |
| 1600 字 | `（1/2 片）` | 是 | ✅ |
| 2400 字 | `（1/3 片）` | 是 | ✅ |
| 空输出 | `会话 shard- 回复：` | 否 | ✅ 降级成 `（这一轮没有文本输出，工具：这一轮没有工具调用）`，不当空消息发 |
| `sayReplyChars=100` | `（1/3 片）`（450 字按 200 切） | 是 | ✅ 下限 200（`bridge.js:1388` `Math.max(200, …)`），与"再小就没意义"一致 |

`/more` 续取与末片提示（同一脚本连按三次 `/more`）：

```
会话 shard- 回复（2/2 片）： ⏎ AAAA…
已经到最后一片了。
没有可续看的内容（上一轮已看完或还没收到回复）。
```

- 片头/片尾文案：首片 `— 共 N 片；发 /more <短id> 看下一片`（`:1395`），中间片 `— 第 n/N 片；发 /more 继续`，末片 `— 第 n/N 片（已是最后一片）`（`:1418`）——与手册 `:148-151` 的示例一致。
- 越界行为：到底后再按 `/more` 回"已经到最后一片了"并把 `sayPages` 置空，第三次回"没有可续看的内容"。需要多按一次才清空，属 UX 小瑕，不阻断。
- 唯一实质瑕疵（建议）：切分用 `String.prototype.slice`，按 UTF-16 码元切；当第 800 个码元正好落在代理对（emoji / 生僻字）中间时会切出半个字符。修法：`Array.from(full)` 后按码点切，或切点回退一个码元。

### 5. D17 / A33：**与实现完全一致**

实测（同一脚本，`/new` 打桩 `sessionController.create`，读真 `state.newSessions`）：

```
第 1 次: 已在 C:/proj/alpha 新建 new-1（今天第 1/10 个）。用 /say 给它第一句话。
…
第 10 次: 已在 C:/proj/alpha 新建 new-10（今天第 10/10 个）。用 /say 给它第一句话。
第 11 次: 今天在 C:/proj/alpha 已经新建 10 个，到上限了（每工作区 10 个/天）。
state.newSessions = {"w1":{"day":"2026-10-26","count":10}}
重启后 newSessions = {"w1":{"day":"2026-10-26","count":10}}
重启后第 12 次尝试: 今天在 C:/proj/alpha 已经新建 10 个，到上限了（每工作区 10 个/天）。
上限=2 时第 3 次: 今天在 C:/proj/alpha 已经新建 2 个，到上限了（每工作区 2 个/天）。
```

- **默认 10**：`Bridge` 构造 `maxNewPerWorkspacePerDay = 10`（`bridge.js:148`），插件注入 `config.newPerWorkspacePerDay ?? 10`（`lib/index.js:90`）。
- **可配置**：设 2 后上限即 2（上面最后一行），且文案跟着改。
- **第 11 次拒绝**：判据是 `used >= max`（`:875`），`used` 只在成功创建后 +1，因此第 11 次（不是第 10 次）被挡——与 A33 原文"第 11 次 → 拒绝"一致。
- **计数落盘、重启不清零**：`state.newSessions[workspaceId] = {day, count}`（`:888`，`#persist` 整体存 `state`）；同 `statePath` 新建实例后仍是 10，且立即生效。
- 文档侧：`docs/build/qq-bridge.md:319`（D17=10 可配）、`:338`（A33 第 11 次）、手册 `:134`、frame `## 偏离` 2026-10-25 行四处口径一致。
- 说明：`docs/build/qq-bridge.md:388` 仍写"D17 每工作区每天 ≤3"，但那是 **S9（2026-10-24）历史小节**里对 v6 签字内容的记录，同文档 `:319`/`:677` 已是 10，不算冲突（建议在那行加"（后由 `## 偏离` 改为 10）"）。

### 6. 文档抽查（README / 手册 / 01 / 02 / 03 / blackbox 各一处）

| 文档 | 抽查点 | 结论 |
|---|---|---|
| `README.md:64` | "系统空闲 < 5 分钟视为在场，审批/跑完/停滞不推 QQ（DSH 自己弹窗）；离开后只补『等你决定』的请求" | ✅ 与实现一致（这三类确实门控；`#flushPending` 只推 `open`） |
| `README.md:73` | "测试共 56 套（基线取证见 `docs/build/baseline.md`）" | ✅ 与本轮 56/56 一致 |
| 手册 `:123-125` | `/pc` 默认 60 分钟、"静音期间 5 分钟没答会强制兜底推送"、"离开时只补推仍待你决定的请求" | ✅ 与 `:344`/`:1370`/`:1167` 一致 |
| 手册 `:148-151` | "超过 800 字会分片，首片标注 `1/N 片`，用 `/more` 看下一片" + 示例文案 | ✅ 与本轮分片实测逐字一致 |
| `01-architecture.md:5` | "离线测试 56 套全绿" | ✅ 与本轮实测一致 |
| `01-architecture.md:128-156` | 标题写「落盘形状（**按真实文件重写**）」，但目录树**缺 4 个真实存在的源文件**：`src/core/presence.js`、`src/core/events.js`、`src/core/sessions.js`、`src/app/audit.js` | ❌ **与实现冲突**（详见 B3 附表）；同时 01 全文没有 ADR-30/在场门控的落点，§1 的 L2/L3 职责表也没提"谁判在场" |
| `02-contracts.md:23-25` | `WaitPoint` 封闭集、`Delivery` 闸门指针 | ❌ **与实现冲突**（B3） |
| `03-decisions.md:40-41` | ADR-30（单维空闲、<5 分钟在场、离开只补 open、5 分钟兜底）、ADR-31（分片默认 800） | ✅ 与实现一致（ADR-30 未写"采样 60s + 连续 2 次确认"，见建议） |
| `qq-bridge.blackbox.md:459` | "在场门控、`/say` 分片…尚未进入本用例集" | ✅ 如实标注缺口，无冲突（但意味着这轮新增行为**零验收用例**） |
| 全仓 | `DSH_IDLE_FORCE_FILE`（文件通道开关）在 README/手册/01/02/03 中**一处未提** | ⚠ 排障入口只有代码里有 |

## 阻断与建议

### B1（阻断）探针把"取不到空闲值"读成 `0` → 门控把该发的全吞掉

- **文件**：`src/core/presence.js:124-125`（管道通道的取值判据），旁证 `:117-147`、`:157-166`。
- **行为**：`spawnSync` spawn 失败不抛异常（只设 `r.error`），`r.stdout` 为 `undefined`；
  `Number(String(undefined ?? '').trim())` = `Number('')` = `0`，而判据 `Number.isFinite(n) && n >= 0` 对 `0` 成立 → 直接 `return 0`。
  `0` 毫秒被判成"在场"，`#present()` 恒真。
- **证据**（见上）：同一进程内管道通道 `0` / 文件通道 `118172`；`error = EPERM: spawnSync powershell.exe EPERM`；`Number('') === 0 → true`。
- **后果**：`tick()` 的跑完/停滞/10 分钟/30 分钟催办**永久丢失**（无重发）；审批与提问卡片退化为"5 分钟兜底"（`:1370`）→ **每次审批固定晚 5 分钟**；"离开补推"永不触发；`/mode` 报"探针：powershell／空闲 0 分钟"是假信息。
  这恰好是上一轮修 `71f9858`（"管道被沙箱禁止时改读临时文件"）要解决的场景——**新兜底被旧的一行解析挡在门外**。
- **修法**（两行）：管道分支必须同时满足 `!r.error` 且 stdout 是**非空数字串**才采信，例如
  ```js
  const s = String(r.stdout ?? '').trim()
  if (!r.error && /^\d+$/.test(s)) return Number(s)
  ```
  再补一条用例：注入"spawn 失败"（如 `DSH_IDLE_FORCE_PIPE_FAIL=1` 或可注入的 spawn 函数）断言走文件通道、且"两条通道都失败"时返回 `null`（→ 离开，宁可多推）。
- **为什么阻断**：它是"该发却被吞掉"的方向，且与 `presence.js:49`（`拿不到 → 离开`）声明的失败安全相反；`/mode` 同时给出假依据，现场无法自查。

### B2（阻断）5 个主动推送点没有过 `#present()`

- **文件/行**：`bridge.js:221`（断网摘要）、`:283`（重启作废）、`:1539`（审批"已在电脑端处理"）、`:1634`（提问"已在电脑端答复"）、`:851`（咨询自动结束）。
- **行为**：把 `presence` 固定为 `present` 后逐个触发，5 个点都发出了 QQ 主动消息（上表实测输出）。
- **为什么阻断**：
  1. `:1539`/`:1634` 的触发前提就是"你在电脑上把这张卡答掉了"——**人在电脑前是这两条消息的成因**，却正好被推去手机，与 ADR-30 的动机（`03-decisions.md:40`"用户在电脑前时，QQ 推送是纯噪音"）正面冲突，且这是每个审批/提问都会走的常见路径。
  2. `:221` 与 `:225` 是相邻的两条重连类通知，一条门控一条不门控，无法用任何规则解释。
- **修法**：这 5 处统一加 `if (!this.#present())`（`:851` 建议改成"在场时只落审计不推送"）；`#flushPending` 不必动。
  另建议把"门控范围"一次写清：`ADR-30` 现在只枚举"审批/跑完/停滞"，而实现有 17 个主动推送点——建议在 ADR-30 补一行"**除 5 分钟兜底与被请求的回复外，一切主动消息都过门控**"，并把本次 5 处列为例外或不例外。
- **附带（同属该阻断的判定依据）**：`:1324/:1330/:1344/:1354` 在门控**之前**置位，导致"在场时到点的催办"被静音且离开后不补（`#flushPending` 又因 `pushedToQQ===true` 跳过）。要么改成"门控通过后再置位"，要么在 ADR-30 明确"静音即消费"。

### B3（阻断）`02-contracts.md` 的 `WaitPoint` 契约与实现不符

文件：`docs/arch/qq-bridge/02-contracts.md:23`（`WaitPoint` 行）、`:24-25`（`Answer`/`Delivery` 的指针）。实测对照：

| 契约原文 | 实现实测 | 差 |
|---|---|---|
| `kind ∈ {approval, question, idle}`（**封闭**） | `bridge.js:1034` 创建 `kind: 'say'`，`resolveAnswer` 的 `/say` 确认分支（`:419-476`）依赖它；全仓**没有** `kind: 'idle'` | 封闭集缺 1 个真实值、多 1 个不存在的值 |
| `answerMode ∈ {closed, text}` | 全仓 grep 无 `answerMode`（`src/app/bridge.js`、`src/core/wait-point.js` 均为 0 命中） | 契约字段不存在 |
| `dropReason ∈ {turn-end, restart, power-loss}` | 实际出现 `restart`、`cancelled-by-user`（`:425`）、`inject-failed`（`:471`）、`push-quota`（`:1470`）、`answered-on-gui`（`:1524`/`:1626`）、`test-timeout`（`:1559`/`:1663`） | 封闭集少 5 个实际值 |
| 形状指针 `:174-186`（question 映射）/ `:294`（Delivery 闸门） | `:174-186` 现为构造函数/`bindAgent` 区，question 映射在 `:490-515`；闸门在 `:1465-1475` | 两个裸行号指针均已错位（本轮明确要求"指针改为文件/函数名"，此处是漏改） |

- **为什么阻断**：`02` 自称"形状那一栏最终指向代码位置"，而 `WaitPoint` 的**两个封闭集**都被实现突破；按契约写代码的人（或按契约读代码的人）会在 `/say` 与 `dropReason` 上得出错误结论。冻结文件的封闭集失效属契约级缺陷，不是文案。
- **修法**：`kind ∈ {approval, question, say}`（删 `idle`）；`dropReason` 列全 6 个或改成开放集并注明"仅用于排查"；删 `answerMode` 或写明"由 `kind` 推导，不是字段"；两个裸行号换成 `#queueCard` / `Answer` 这样的函数名。同时把 `01-architecture.md:128-156` 的目录树补上 `presence.js`/`events.js`/`sessions.js`/`audit.js`，并在 §1 或 §8 写清"在场判定归 L2"。

### 建议（不阻断）

1. **探针采样节奏没写进文档**：`confirmSamples=2` + 每 60s 采样一次（`presence.js:34`、`lib/index.js:143`）意味着"人回到电脑前"最多要 **2 分钟**才生效，这 2 分钟内仍会推。README/手册只写"空闲 < 5 分钟视为在场"，建议补一句"判定每分钟采样、需连续 2 次确认"。
2. **`/mode` 的"依据"只在 tick 时刷新**：`describe()` 用 `#lastIdleMs`，不 tick 就是 `拿不到空闲时间`。建议 `/mode` 前主动 `sample()` 一次，让排障信息可信。
3. `/say` 分片按 UTF-16 码元切，可能切断代理对（emoji/生僻字）——改按码点切。
4. 门控/分片**零验收用例**：`blackbox.md:459` 已如实标注"尚未进入用例集"。建议补 BB：在场时卡片 0 条 / 离开后补推 1 条 / 5 分钟兜底 1 条 / 800 与 801 字分片边界。
5. `DSH_IDLE_FORCE_FILE=1` 是唯一能绕过管道通道的开关，四份文档都没写；建议写进手册"排障"节。
6. `handleApproval` 在发卡之前就写入 `deliveries`（`:1475`），被门控的新卡也计入"24h ≤3 条"配额；同一 `callId` 重试 4 次后会被判 `push-quota` 直接 `unavailable`。建议只在实际发出时计数。
7. `docs/build/qq-bridge.md:388` 的历史小节仍写"D17 ≤3"，建议加"（后改为 10）"，避免被当成现行口径。

状态：未通过（阻断 3）
