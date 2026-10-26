# 评审 · 轮次 13

评审对象：R12 判「不可交接（阻断 3）」后的修复提交 `17c85a9`（`fix(r12): 实现 ADR-32 的 /pc 校验；重连即发提示；用例口径同步`）。

评审快照：2026-10-25 20:59 开始，HEAD = `17c85a9`，工作树干净。评审期间仓库被并发推进：`269bd68`（A20 摘要，21:01）、`2448efd`（运行日志 `bridge.log` + 黑盒追加评审段 + `s54-log`，21:06）、`4e73654`（手册门控范围一句，21:08）。报告落笔时 HEAD = `4e73654`，工作树只剩本文件。R12 改动的 `src/transport/qq.js`、`src/transport/envelope.js` 在 `17c85a9..4e73654` 之间**零差异**，`bridge.js` 的 `/pc`、`/away` 行也未动；核销与探针以 `17c85a9` 干净导出为准（`.tmp/r13-head`），并在 `4e73654` 复跑确认（`.tmp/r13-head3`）。基线在 `17c85a9`、`269bd68`、`4e73654` 三处各跑一遍。

评审方式：逐行读 `src/app/bridge.js`（`/pc`／`/mode`／`/away`／咨询链）、`src/transport/envelope.js`、`src/transport/qq.js`；自写假 client + 假 WebSocket 探针（`.tmp/r13-head/probe-*.mjs`）；按 `docs/build/baseline.md` 逐套单跑并只看退出码；`git diff 2da52d8 17c85a9` 逐行核黑盒改动。

## 结论：不可交接（阻断 1）

| 项 | 结果 |
|---|---|
| **R12 #1 `/pc`（ADR-32）** | **已关闭**：`/pc 0`、`/pc abc`、`/pc -5` 3/3 回「无效／正整数」，`/pc 30` 真进静音（`state.mode.until` 已落、`/mode` 显示「静音（还剩 30 分钟）」） |
| **R12 #2 重连提示** | **已关闭**：首次 READY 不发；之后每次 READY 都发 `recovered`；假 WS 走「连接→READY→断开→重连→READY」只发 1 条 |
| **R12 #3 用例口径** | **未闭合**：5 个子项 3 项完成（模式字面、必需四行、条数 24），2 项未完成（BB-102/103 的 C1 取法、文末状态）；另有 BB-96 期望 1) 仍写「离开」而实现回「始终推送」，该条仍必红 |
| **基线** | 56/56（`17c85a9` 与 `269bd68`）；57/57（`4e73654`，含 `2448efd` 新增的 `s54-log`） |
| **回归** | 运行时代码未发现回归；文档侧有 2 处问题（历史状态行被改写、`2448efd` 追加段把未闭合项标成「通过（阻断 0）」） |

阻断只剩 **R12 #3 用例口径**这一组；#1、#2 的代码修复本身是对的。

## 三条核销

### R12 #1 `/pc` 未实现 ADR-32 —— 已关闭

代码（`17c85a9`）：

- `src/transport/envelope.js:24`：`pc: /^\/pc(?:\s+(\S+))?\s*$/i`——参数放宽为任意 token。
- `src/transport/envelope.js:127-132`：纯数字转 `Number`，非纯数字原样下传，不再落 `unknown`。
- `src/app/bridge.js:342-352`：`typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1` 才放行；否则回固定拒绝语；无参仍默认 60。

实测（`.tmp/r13-head/probe-pc.mjs`，假 client 构造 `Bridge`，`idleProbe=30s`、固定 `now`）：

```
/pc 0    → 参数「0」无效：/pc 只接受正整数分钟（例如 /pc 60）。
/pc abc  → 参数「abc」无效：/pc 只接受正整数分钟（例如 /pc 60）。
/pc -5   → 参数「-5」无效：/pc 只接受正整数分钟（例如 /pc 60）。
/pc 30   → 已静音 30 分钟（到期自动恢复）。审批 5 分钟没人答仍会推给你。
```

逐项核对：

| 检查 | 结果 |
|---|---|
| 前三条含「无效」 | 3/3 含 |
| 前三条含「正整数」 | 3/3 含 |
| 前三条含「参数」 | 3/3 含 |
| 前三条不动 `state.mode` | 3/3 前后均为 `(none)` |
| 第四条进静音 | `state.mode = {"mode":"pc","until":1700001800000}`（= now + 30 分钟）；随后 `/mode` 首行 = `模式：静音（还剩 30 分钟）` |

额外边界：`/pc +5`、`/pc 1.5`、`/pc -0`、`/pc 0x10` 均被拒并带固定语；`/pc 999999999999999999999` 被接受为 `1e+21` 分钟（`Number.isInteger(1e21) === true`）——见「回归」附注，不阻断。

### R12 #2 BB-87「我重连过」不确定 —— 已关闭

`src/transport/qq.js:131-142` 的 READY 分支现为：

```js
if (t === 'READY') {
  this.#attempt = 0
  this.#state = 'ready'
  this.#lastFrameAt = Date.now()
  // 已经 READY 过又回到 READY = 重连成功（普通断网或看门狗触发），都要告知
  if (this.#hadReady || this.#staleClosed) {
    const stale = this.#staleClosed
    this.#staleClosed = false
    this.#emit('recovered', { afterMs: this.#hbMs * 2, stale })
  }
  this.#hadReady = true
  this.#emit('ready', d)
  return
}
```

- 首次 READY：`#hadReady=false`、`#staleClosed=false` → 不发 `recovered`。
- 之后每次 READY（普通断网 close 1006 或看门狗 stale）：`#hadReady=true` → 必发一次；`stale` 字段区分来源。
- 看门狗 `recoverIfStale`（`:179-191`）仍工作，`s18-watchdog.mjs` 5/5 绿，stale 路径没有回归。

假 WebSocket 实测（`.tmp/r13-head/probe-reconnect.mjs`，`heartbeat_interval=1000`、`reconnectBaseMs=5`）：

```
=== 1) 首次连接 → READY ===
ready= 1 recovered= 0 state= ready

=== 2) 断开（close 1006）→ 重连 → READY ===
ready= 2 recovered= 1 [{"afterMs":2000,"stale":false}]
state= ready

=== 3) 再断一次 → 再重连 → READY ===
ready= 3 recovered= 2 [{"afterMs":2000,"stale":false},{"afterMs":2000,"stale":false}]
```

即「连接→READY→断开→重连→READY」这条链只发 **1** 条 `recovered`，且首次 READY 不发。

Bridge 门控侧也复核了（`.tmp/r13-head/probe-gate.mjs`，直接触发 `recovered`）：

| 状态 | 结果 |
|---|---|
| 在场（`idle=30s`） | `sent=[]`（门控吞掉，符合 ADR-30/32） |
| 离开（`idle=10min`） | `sent=["我重连过（连接曾无响应）。"]`（1 条） |

BB-87 的期望 2)/3) 因此可确定性成立：在场段 0 处、离开段 1 处。

### R12 #3 用例口径 —— 未闭合

| 子项 | 现状（`17c85a9`） | 判定 |
|---|---|---|
| `模式：离开` → `模式：始终推送` | BB-96 期望 2) 已改；口径 #3 的取值表已改 | ✅（但期望 1) 仍有同型错字，见下） |
| `/mode` 固定四行 → 必需四行（可能多一行） | 口径 #3（L469）改为「至少四行（实现可能多一行『规则/手动模式』提示）」；FQ-13 与 BB-85/90/93/96 改「必需四行齐备」 | ✅ |
| 条数 23 → 24 | L463/L519/L522/L527 均为 24（BB-85…BB-108）；L545 的「23 条」是轮次 2 建议原文，属历史 | ✅ |
| BB-102/103 补 C1 取法 | `git diff 2da52d8 17c85a9` 共 8 行改动，**不含 FQ-16、BB-102、BB-103**；FQ-16 仍是「该咨询会话的 session id（FQ-10 记的 C-id）」，把 C-id 误当 session id | ❌ 未做 |
| 文末状态 | `17c85a9` 的末行仍是 `状态：增补用例待修订（阻断 9）`；提交改的是 L201——轮次 1（2026-10-24）的收尾状态行，不是文末。`2448efd` 追加的第二轮评审段（L553–L574）把末行改成 `状态：增补用例可用`（L575），但该段结论「通过（阻断 0）」与本轮两处未修冲突（见下） | ❌ 未闭合 |

#### （1）BB-96 期望 1) 仍写「离开」，但 `/away` 的回话没有「离开」

- 用例 L501：`1) /away 回话 1 条含「离开」≥1 处`；期望 2) 已改成 `模式：始终推送`。
- 实现（`bridge.js:357`）：`已切到「始终推送」。（/auto 恢复自动）`——不含「离开」。
- 实测（`.tmp/r13-head/probe-away.mjs`）：

```
/away => "已切到「始终推送」。（/auto 恢复自动）"
/mode => "模式：始终推送\n判定：离开（会推送）\n依据：空闲 0 分钟\n探针：injected\n（手动模式，忽略空闲）"
```

手动 §5（`qq-bridge-manual.md:123`）也写「`/away` 始终推送」。故 BB-96 期望 1) 对正确实现必红；R12 只改了期望 2)，同一句里的「离开」漏改。

#### （2）FQ-16/BB-102/103 的 C1 取法：没补，且现在的写法是错的

- FQ-10（L36）只把「`/why` 首答返回的标识」记为 C-id；实现里该首答用 `shortOf(targetId)`（`bridge.js:1103-1104`），即**任务会话**的 6 位短 id，不是咨询会话 id。
- `/done` 回话同样用 `shortOf(key)`（`bridge.js:854-855`，`key` 是任务会话 id），也不是咨询会话 id。
- 真正进 `archivedSessionIds` 的是 `entry.consultId`（`bridge.js:839-844`，`archiveSession({ sessionId: consultId })`）；它只落在 `state.json.consults`（`bridge.js:781-782`）或 GUI，FQ-10 不记录。
- 因此 FQ-16 现有的写法「该咨询会话的 session id（FQ-10 记的 C-id）」把两个不同对象等同（该句自 `2da52d8` 起未变，`17c85a9` 也未改）；BB-102 期望 3)「数组含 C1 的 session id 1 处（字符差 0）」按此取法必得 0 命中——正确实现会被判红。应补一句：session id 从 `%LOCALAPPDATA%\qq-bridge\state.json` 的 `consults` 数组（或 GUI 会话信息）取，C-id 只用于 `/done` 路由。

#### （3）文末状态

- `git show 17c85a9:docs/build/qq-bridge.blackbox.md` 末行 = `状态：增补用例待修订（阻断 9）`，与 `2da52d8` 完全一致。
- 提交把 R12 状态写到了 L201；L201 是「评审 · 2026-10-24 · 轮次 1」小节的收尾行（该小节起于 L176、下一个 `##` 在 L203），不是全文末行。这既没修文末，又把 2026-10-24 的历史记录改成了 R12 状态。
- `2448efd` 随后把「增补用例评审（v2 · 第二轮）」（L553–L574）与末行 `状态：增补用例可用`（L575）一并提交；但该段自称「结论：通过（阻断 0）」（L556），而 BB-96 期望 1) 与 FQ-16 仍未修。也就是说：文末状态现在**变了**，但变成的结论不成立——不能作为 R12 #3 的闭合证据，反而是新的文档错误（见「回归」）。

## 基线

按 `docs/build/baseline.md` 的复跑方法（逐套单跑、只看进程退出码，node `v24.21.0`）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"  # v24.21.0
$files = Get-ChildItem test -Filter *.mjs |
  Where-Object { $_.Name -notin @('_setup.mjs','s1-waterfall.test.mjs','s3-loop.mjs') } |
  Sort-Object Name
```

| 快照 | 范围 | 结果 |
|---|---|---|
| `17c85a9` 干净导出（`.tmp/r13-head`） | baseline.md 的 56 套 | `TOTAL=56  GREEN=56  RED=0` |
| `269bd68` 干净导出（`.tmp/r13-head2`） | baseline.md 的 56 套 | `TOTAL=56  GREEN=56  RED=0` |
| `4e73654` 干净导出（`.tmp/r13-head3`，当前 HEAD） | 57 套（`2448efd` 新增 `s54-log`） | `TOTAL=57  GREEN=57  RED=0` |

关键套件单跑（`269bd68`）：`s18-watchdog` 5/5、`s2-transport` 35/35、`s53-gating-pages` 11/11。

注意：56/56 全绿**不覆盖** R12 的两项新行为——`s2` 没有 `/pc 0|abc|-5` 用例，`s53` 只测 `/pc 60`；`s18` 只测 stale 恢复，不测「普通断网 READY 也发 recovered」。两项都靠本轮探针取证。R11 建议的「把 BB-85… 进 test/」仍未落地。

## 回归

### 运行时代码

未发现回归：

- `/pc` 解析放宽只影响 `kind==='pc'`；`s2` 的既有 parse 全绿，`/yes`、`/ans`、`/why`、`/say`、`/list`、`/progress` 等未受影响。
- READY 分支新增 `#hadReady` 只加一条「第二次及以后 READY 发 recovered」；stale 路径、`ready` 事件、重连计数、`s18` 全部保持。
- 门控只压推送：`recovered` 在在场时 0 条、离开时 1 条，符合 ADR-30/32。

### 文档/用例侧（本轮要交接的实质问题）

1. **BB-96 期望 1) 仍红**（上节）——R12 #3 的「模式字面」只改了一半。
2. **FQ-16/BB-102/103 的 C1 取法未补且写错**（上节）——R12 #3 明确要求的子项，`git diff` 里 0 行改动；提交信息却称已补。
3. **文末状态**：`17c85a9` 未改（改到了 L201 的历史小节）；`2448efd` 追加段把末行改成「增补用例可用」，但同段「通过（阻断 0）」的结论与 1、2 冲突。建议把该段改为「通过（阻断 2：BB-96 期望 1、C1 取法）」或先修文本再改状态。

### 附注（不阻断）

1. **`/pc` 超大数**：`/pc 999999999999999999999` 被接受（`1e+21` 分钟，到期时间溢出到 `6.00000000000017e+25`）。建议 `Number.isSafeInteger` 加一个上限（如 1e6 分钟），否则会落一个不可达的 `until`。
2. **`recovered` 文案**：`bridge.js:225` 现在对普通断网也回「我重连过（连接曾无响应）」；`stale=false` 时「无响应」不成立。`recovered` 已带 `stale` 字段，建议按它分支（stale 保留括号，非 stale 只回「我重连过」）。同理 `afterMs` 固定写 `hbMs*2`，普通断网 3 秒也报 82.5s；当前无消费者，属隐患。
3. **固定提示带尾缀**：ADR-32 说「回固定提示」，实现是 `参数「x」无效：/pc 只接受正整数分钟（例如 /pc 60）。`——前缀完全一致，但多了示例；BB-95 按「含」判可以通过。若将来要逐字比对，建议 ADR 与实现二选一对齐。
4. **L 证据的生产者仍缺**：`17c85a9` 没有 `bridge.log` 写入；`2448efd` 加的 `BridgeLog` 只在 `send()` 成功/失败写 `out`/`err`，没有 `in`、重连、归档行。故 BB-87 期望 5)「两段内 L 重连记录 =2 行」和 BB-102/103 的「L 归档行」仍无字面定义/生产者；本轮不把它计入三条阻断，但交接前应补日志行或改用 R/ST 判据。
5. **并发编辑**：21:01 工作树 WIP 期间 `Bridge` 构造一度因 `opts.logFile` 抛 `ReferenceError`（当时全仓测试会全红），21:03 改为 `logFile` 形参后恢复，`2448efd` 已把修正后的版本提交；`4e73654` 全绿。这不是 `17c85a9` 的回归，但说明交接前应把改动收敛并复跑基线。
6. **`baseline.md` 落后一拍**：`docs/build/baseline.md` 仍写 `TOTAL=56` 并称「唯一权威基线」，但 `2448efd` 新增 `test/s54-log.mjs` 后按同一排除规则实际可跑 **57** 套（本轮 57/57）。按文档复跑会漏 s54；建议同步为 57 并注明 s54 是 `2448efd` 新加的日志套件。

状态：未通过（阻断 1）
