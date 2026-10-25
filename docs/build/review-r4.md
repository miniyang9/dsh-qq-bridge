# 评审 · 轮次 4

审查对象：`src/**`、`lib/index.js`、`test/*.mjs`，对照 `docs/frame/qq-bridge.md`（v7）、
`docs/arch/qq-bridge/02-contracts.md`（v2）、`docs/build/review-r1.md` / `r2.md` / `r3.md`。

HEAD = `89165be`（`fix(r3): B1/B3/B4/N1/N3/N4 + 新增 s40 覆盖提问 next`），工作树干净
（`git status --short` 无输出）。本轮改动面 = `lib/index.js`(+3/-1)、`src/app/bridge.js`(+12/-4)、
`test/bb-batch3.mjs`、`test/bb-batch5.mjs`、新增 `test/s40-question-next.mjs`。

验证方式：逐行读改动 + **43 套逐套单跑** + 两份一次性探针（`.tmp/r4-probe.mjs`、`.tmp/r4-probe2.mjs`，
只调用现有实现，不改代码、不写仓库）。下文 `PROBE …` 均为实跑输出，可原样复现。

## 交接结论：不可交接（阻断 2）

第 3 轮 6 条里 **4 条真的关闭了**（B4 / N1 / B3 / B1），而且 B4 那条最致命的崩溃确实没了：
提问通道在传 `next` 的情况下 QQ 先答、GUI 先答、GUI 回 `unavailable`、GUI 回空答案四种都跑通。
作者顺手把 R3 点名"修 B4 时必须一起修"的 N4 也修了（探针 `N4.abort.nextCalls = 1`）。

但有两件事没变，都属于"提交说明与代码不符"的同一类问题：

- **N2 完全没动**。`89165be` 的改动列表里没有 N2，`git show 89165be -- src/app/bridge.js` 里
  `resolveAnswer`（:443-455）一行没改——R3 关闭清单第 4 条"审计写入以 `points.answer()` 的 `ok` 为条件"
  也没做。"两边都答"的同一请求仍然落 **2 条**审计，第二条是**被丢弃的那一票**，
  手机还被回了一句"已收到"（`PROBE N2.both.*`）。这条在审批侧和提问侧**都**成立。
- **N3 更差了一点**：作者声称全绿，`bb-batch5.mjs` 实际 **20/22、2 条红**，而且红的就是本提交刚改的那两条
  断言（改错了方向）。实际基线 **42/43 套绿、断言级 364 PASS / 2 FAIL**，不是"43/43"。

阻断 2 = **N2（审计不守恒，A26）**、**N3（测试红 + 声明与实际不符）**。
其余 4 条按"已关闭"核销，另记 6 条非阻断残留（见 §剩余风险）。

## 复验表

| 项 | 结论 | 依据 |
|---|---|---|
| **B4** `const guiAnswers` 重赋值 / 传 `next` 时提问通道 | **已关闭** | `bridge.js:1301-1306` 拆成 `const rawAnswers` + `const guiAnswers`，不再重赋值。三种时序实跑（`PROBE A.*`）：<br>· QQ 先答（GUI 永不回）：`A.B4.qqFirst.threw = null`、`return = {"answers":[{"id":"q1","selected":["A"],"by":"u1"}]}`、待答点 `resolved`、审计 1 条。R2/R3 的 `TypeError: Assignment to constant variable` 不再出现。<br>· GUI 先答：`A.B4.guiFirst.threw = null`、`return = {"answers":[{"id":"q1","selected":["B"]}]}`、待答点 `dropped`、审计 1 条 `via:gui`、手机收到 1 条"已在电脑端答复"。<br>· 两边都答：见 N2（返回 GUI 那票、只结算一次，但审计 2 条）。<br>另验两条边界：GUI 回 `'unavailable'`（F3 瀑布兜底）→ `A.B4.guiUnavailable.pointBeforeQq = "open"`，随后手机 `/ans` 仍生效；GUI 回 `{answers:[]}` → `A.B4.emptyAnswers.pointBeforeQq = "open"`，`/ans` 仍生效（N6 未复活）。 |
| **N1** 提问侧 GUI 胜出后落盘 | **已关闭** | `bridge.js:1310` 补了 `await this.#persist()`（与审批 :1211 一致）。实跑：`PROBE B.N1.diskPoint = {"status":"dropped","dropReason":"answered-on-gui"}`；同一 `statePath` 新建 Bridge 再 `start()` → `B.N1.restart.interruption = null`、`B.N1.restart.interruptMsgCount = 0`（不再误报"有 1 个待答请求已作废"）、`B.N1.restart.pointStatus = "dropped"`。 |
| **B3** `whyTarget` 进 `renderCard`、`/why` 指向会话短 id | **已关闭** | `bridge.js:1180` 把 `whyTarget: wp.meta.whyTarget` 传进 `renderCard`，`envelope.js:64/66/67` 的 `wp.whyTarget ?? id` 因此生效。实跑卡片：`PROBE C.B3.cardHint = "改：/ans wp-5 1 批准 ｜ /ans wp-5 2 拒绝 ｜ /why aaaa11 看现场"`、`C.B3.hintHasWpId = false`、`C.B3.hintHasShortId = true`。**照着提示发真的能用**：`/why aaaa11 看现场` → 咨询会话键 `C.B3.followHint.consults = ["session-aaaa1111"]`、`createArgs = [{"cwd":"C:\\Project\\WatchDog"}]`、投进去的问题是"关于任务会话 session-aaaa1111（工作区 …）：看现场"、该待答点 `C.B3.followHint.evidenceViewed = true`，随后 `/yes` 的审计 `C.B3.audit.evidenceViewed = true`。旧死命令仍被堵：`/why wp-1` → `C.B3.whyWp.reply = "找不到 wp-1 这个会话…"` 且 `C.B3.whyWp.consults` 没有新增。 |
| **N2** 四种时序审计守恒 | **未关闭** | `PROBE D.N2.approval` / `D.N2.question`（四时序并排）：<br>· QQ 先答：`audits = ["{\"text\":\"yes\",\"by\":\"u1\"}"]`（1 条，内容=生效票）✅<br>· GUI 先答：`audits = ["{\"via\":\"gui\",\"outcome\":\"rejected\"}"]` / `…answers:[B]`（1 条）✅<br>· 都不答：`point = "open"`、`audits = 0` ✅<br>· **两边都答：`audits = 2`** —— 审批 `["{\"via\":\"gui\",\"outcome\":\"rejected\"}","{\"text\":\"yes\",\"by\":\"u1\"}"]`、提问 `["{\"via\":\"gui\",\"answers\":[B]}","{\"selected\":[\"B\"],\"by\":\"u1\"}"]`；待答点 `dropped`、生效票是 GUI 那一条，**第二条是被丢弃的手机票**。同一现象在 `PROBE N2.both.approval.*` / `N2.both.question.*` 复现，且手机同时收到 `已收到：wp-2 → yes` 与 `已在电脑端处理（rejected）…`。<br>根因（R2 已定位、R3 已给修法、本轮未动）：`bridge.js:443` 先 `await this.send("已收到…")`、`:444` 才 `points.answer()`、`:445-455` **无条件** `audit.append`，不看 `res.ok`。 |
| **N3** `test/*.mjs` 实际通过数 | **未关闭** | 43 套逐套单跑：**GREEN=42 / RED=1**，断言级 **PASS=364 / FAIL=2**。红的是 `test/bb-batch5.mjs`（20/22），两条都是本提交刚改的 `:137-138`：<br>`FAIL BB-70 运行中的目标被拒或提示等待 — [wp-4] 将要发送：hi-A`<br>`FAIL BB-70 第二条要么进入确认要么明确拒绝 — 还有待答请求没处理（wp-4），先答复它。`<br>`bb-batch3`（上一轮另一条红）确实转绿（`BB-52` 改用 `requestId ∪ wpId` 判定）。作者的自述是"42 套…全绿"（提交信息）/任务记的"43/43"，两者都与实际不符。 |
| **B1** 跨重启无 `callId` 审批撞键 | **已关闭（症状）** | `bridge.js:1141` 键改成 `auto-${this.startedAt}-${deliverySeq}`（`startedAt` 在 :150 取构造时刻）。同进程 4 个无 `callId` 审批：`PROBE E.B1.sameProcess = {"results":["allowed","allowed","allowed","allowed"],"keys":["auto-1792917818198-1"…-4]}`——R1 的"第 4 个起连卡片都不发"不再出现。**跨重启**：预置上一版落盘的 `{"auto-1":[t,t,t],"auto-2":…,"auto-3":…}` 再重启触发无 `callId` 审批 → `PROBE E.B1.afterRestartCollision = {"pointCreated":"wp-18","cardSent":1,"key":"auto-1792917818326-1"}`、`result = "allowed"`、审计 1 条——R1/R2/R3 那条"预置旧键 → `unavailable`、连卡片都不发"**复现不出来**了。残留（不阻断）：键仍不是契约的 `request.callId ?? wp.id`（02:25），见 §剩余风险 2。 |
| 附：**N4** abort 后二次调用 answerer | **已关闭** | `lib/index.js:104-106` 在 `request?.signal?.aborted` 时直接 `return undefined`。按那两行的判据复刻：`PROBE N4.abort.nextCalls = 1`、`N4.abort.return = undefined`（R3 实测是 2 次）。前提是 seam 交来的是**裸 request**（含 `signal`）——Event 形状 `questionEvent()` 不复制 `signal`，见 §剩余风险 5。 |

## 回归扫描

这轮只碰了"提问通道、`whyTarget`、去重键、落盘、两条黑盒断言、`lib` 的一行守卫"，逐个确认周边没被带坏：

| 路径 | 结论 | 依据 |
|---|---|---|
| `/list` + `/use` | 正常 | `PROBE R.list.firstLine = "1) aaaa11 · (无标题)｜刚刚｜未加载｜C\\Project\\WatchDog"`；`R.use.reply = "已绑定 aaaa11；…"`、`R.use.bound = "session-aaaa1111"` |
| `/say` 确认卡 → `/ans 1` → 注入 → 回执 | 正常 | `R.say.card = ["[wp-19] 将要发送：改测试","上次停在：还没有 turn 结束记录"]`、`R.say.afterAns1.fed = 1`、`status = "resolved"`、`R.say.relay` 收到"会话回复"（`s5-say`/`s30`/`s32` 也全绿） |
| `/new` | 正常 | `R.new.menu = "在哪个工作区新建？"`；`/new 1` → `{"reply":"已在 C:\\Project\\WatchDog 新建 newwww（今天第 1/10 个）…","created":[{"workspaceId":"w1"}]}`（`s11`、`s36` 绿） |
| `/why` | 正常，且比 R3 更好 | 见 B3：卡片提示可直接执行、`evidenceViewed` 有真来源；`/why wp-N` 仍拒（`C.B3.whyWp.*`） |
| 通知（空闲 / 卡住） | 正常 | `R.notify.idle = ["[bbbb22]","本轮 1 分钟：改完了"]`（`s14`、`s18` 绿） |
| 审计字段 | 未变 | `A.B4.guiFirst.audit` 的键仍是 `requestId / wpId / openid / at / card / evidenceViewed / evidenceMissing / outcome`（`s8` 17 条全绿） |
| 未知命令 / 裸文本 | 未变 | `R.unknown.replyHead = "这条消息没有对应任何命令。"`（D21 语义未动，`s22`、`s23` 绿） |
| 双通道审批 | 未变 | `s38-dual` 7/7 绿；`PROBE D.N2.approval.qqFirst/guiFirst` 与 R3 一致 |

两条顺带核对：

- 本轮**没有把 `bb-batch2:77/85` 的 `/why wp-7` 断言改掉**（R3 提醒过），但也没变成红：那两条断言直接调
  `renderCard({...})` 且**不传 `whyTarget`**，走的是 `envelope.js:64` 的回落分支，`/why wp-7` 仍成立。
  后果是**B3 至今没有测试锁住**——把 `bridge.js:1180` 删掉，43 套照样全绿（只有探针 C 能发现）。
- `s40` 新增的三段是行为级（不是 grep），但**没有覆盖"两边都答"**，也**没有覆盖 N1 的落盘/重启**——
  所以两个阻断里属于产品缺陷的那一个（N2），恰好落在新套件的盲区里（见下节）。

### 假绿复核

- **`s39-guarantees.mjs` 仍是纯源码 grep，一条行为都没有**：`:15-17` 读源码字符串，`:20-61` 全是
  `includes` / 正则（22/22 PASS）。R3 指出的"审批有 `handleApproval(request, { next`，提问一条都没有"
  现在依然如此：`grep -n 'handleQuestion' test/s39-guarantees.mjs` 零命中。它对本轮修好的 B4 加不了分，
  对本轮没修的 N2 也红不了——**仍不能算验收证据**。
- **`s40-question-next.mjs` 让提问通道第一次有了行为级覆盖**（6/6）：三段分别是"传 `next` 时 QQ 先答"、
  "GUI 先答（对象形状）"、"GUI 回空 `answers` → 待答点仍 `open`、QQ 仍可答"。这是本轮最实的进展。
  但三点不足：
  1. `s40:29` 的 `check('传 next 时 handleQuestion 不抛错', true)` 是**恒真**——真正兜住崩溃的是后面的
     `await p`（抛错会让进程红），标签本身不验任何东西，建议改成 `threw === null` 或断言返回值形状；
  2. 没有"两边都答"用例（N2 就活在这里）；
  3. GUI 胜出后**没有断言审计条数、也没有断言落盘/重启**（N1 的行为只在探针里验证过），
     把 `bridge.js:1310` 的 `#persist()` 删掉，s40 照样绿。
- 其余 R1/R2 点过的假绿（`s13:23` 空转、`s21:30-33` 占位、`s33` 按行正则）**原样未动**；
  它们没掩盖本轮缺陷，仍是"建议降级标注"，不阻断。

## 实际测试基线

用任务指定的 `C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`，
`test\*.mjs` 共 45 个，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 后 **43 套**逐套单跑
（每次独立进程，不共享 `.tmp`）：

```
TOTAL=43  GREEN=42  RED=1
断言级：PASS=364  FAIL=2
RED：test\bb-batch5.mjs  exit=1  20/22
     FAIL  BB-70  运行中的目标被拒或提示等待      — [wp-4] 将要发送：hi-A
     FAIL  BB-70  第二条要么进入确认要么明确拒绝  — 还有待答请求没处理（wp-4），先答复它。
```

套件明细（PASS 数）：bb-batch1 12、bb-batch2 12、bb-batch3 11、bb-batch4 3、**bb-batch5 20/22**、
bb-batch6 4、s2-transport 35、s3-label 8、s3-order 9、s3-seq 6、s4-state 14、s5-question 12、s5-say 11、
s6-label 12、s8-audit 17、s10-wake 5、s11-new 7、s12-consult 8、s13-hidden 3、s14-notify 7、s15-writes 5、
s16-progress 6、s17-late 7、s18-watchdog 5、s19-goodbye 4、s20-offline 6、s21-degrade 4、s22-noise 4、
s23-format 9、s26-wake-id 3、s27-idcmds 7、s29-wake-resolve 4、s30-say-text 5、s31-copy 18、s32-relay 7、
s33-prompts 3、s34-deliver 6、s35-title 5、s36-workspace 2、s37-qqtitle 3、s38-dual 7、s39-guarantees 22、
s40-question-next 6。

两条红的性质：**不是产品缺陷，是断言写错了对象**。`BB-70` 的两条 `/say` 里，第一条
（`session-hhhh7777`，已加载且空闲）在 B5/D20 之后**本来就该进确认卡**（实测 `[wp-4] 将要发送：hi-A`），
作者却把它写成"应被拒/应提示等待"；第二条（`session-iiii8888`，运行中）被前一个待答点挡住，
回的是"还有待答请求没处理（wp-4）"，也不在断言的正则里。修法：把 `:137` 的期望改成"第一条进确认卡"，
`:138` 期望改成"第二条要么被运行中拒绝、要么被 open 待答点挡住"（或先 `drop` 掉 wp-4 再发第二条，
才回到原测试意图"运行中被拒"）。**但这仍是交接门禁要挡的**：提交信息写"42 套逐套单跑，全绿"，
实际 42/43，台账会被这句话污染——上一轮 N3 就是因为同一个原因被计为阻断。

## 剩余风险（不阻断）

1. **N2 的修法只有两行**：`bridge.js:444` 之后用 `res.ok` 决定是否 `audit.append`；并把 :443 的
   `已收到` 挪到 `res.ok === true` 分支里（现在被丢弃的那票也会收到"已收到"）。R3 已给同样处方，本轮漏做。
2. **B1 的键仍不合契约**：02:25 要求 `request.callId ?? wp.id`，实现是 `auto-<startedAt>-<seq>`。
   症状（撞键）没了，但代价是：① 无 `callId` 的请求**永远无法去重**，A6 的"同键 24h ≤3 条"对它们失效；
   ② `deliveries` 每来一个无 `callId` 审批就多一个永久键并落盘，无裁剪（`Audit.prune` 同样无调用点）；
   ③ 键取 `Date.now()` 而非注入的 `this.now()`，同一毫秒内构造的两个 Bridge 仍会撞（生产重启不会这么快，
   但测试里可复现）。
3. **提问侧审计的 `requestId` 仍是 `wp-N`**：`bridge.js:1313` 用 `wp.meta?.callId ?? wp.id`，而提问的
   `meta`（:1271）没有 `callId`，`unwrap` 取到的 `requestId` 也没存。A26 要"能对上 DSH 那次请求"，
   提问侧仍对不上（`PROBE A.B4.guiFirst.audit` 里 `requestId = "wp-2"`）。R2 已记过，未修。
4. **字段名与 frame 不齐**：A27a/A27b 写 `evidence_missing` / `evidence_viewed`，落盘是驼峰（`audit.js:27-28`）。
5. **N4 的守卫只认裸 request**：`lib/index.js:105` 读 `request.signal`；若 seam 改走 Event 形状，
   `questionEvent()`（`core/events.js:41-47`）不复制 `signal`，`handleQuestion` 也拿不到 abort——
   这条守卫和 DSH 侧中止在 Event 形状下同时失效。另：signal 已 abort 时即使 QQ 已经答完也会
   `return undefined`（答案被丢弃），属粗粒度取舍。
6. **`/why` 成功时仍无即时回话**（R1 S5）：探针 C 里投完问题后最后一条消息还是那张卡片，要等
   `turn/end` 才有回复；A18/A19 的"≤10s 有人感"仍靠咨询轮次。

## 复跑方式

```
$node = C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个单跑 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）→ 42 通过 / 1 失败（bb-batch5 20/22）
$node .tmp\r4-probe.mjs   → A.B4 / B.N1 / C.B3 / D.N2 / E.B1 / R.* 各行
$node .tmp\r4-probe2.mjs  → N4.abort / N2.both.* 各行
```

状态：未通过（阻断 2）
