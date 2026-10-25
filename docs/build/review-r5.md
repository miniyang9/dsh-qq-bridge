# 评审 · 轮次 5（终局）

审查对象：`src/**`、`lib/index.js`、`test/*.mjs`、`tools/*.mjs`，对照 `docs/frame/qq-bridge.md`（v7，A26 在 :219）、
`docs/arch/qq-bridge/02-contracts.md`（v2，`WaitPoint` :23、`Delivery` :25）、`docs/build/review-r1.md` ~ `r4.md`。

HEAD = `511b14b`（`fix(r4): N2 审计守恒 + N3 基线 + 覆盖缺口`），`git status --short` 无输出（工作树干净）。
本轮改动面 = `src/app/bridge.js`(+7/-1)、`test/bb-batch5.mjs`、`test/s3-order.test.mjs`、`test/s40-question-next.mjs`、
新增 `test/s41-audit-conservation.mjs`。

验证方式：逐行读改动 + **44 套逐套单跑**（两次：HEAD 一次、把 `bridge.js` 换回 `89165be` 再跑一次）+
四份一次性探针（`.tmp/r5-probe.mjs`、`.tmp/r5-probe2.mjs`、`.tmp/r5-probe3.mjs`、`.tmp/r5-probe4.mjs`，只调用现有实现，
不改仓库；探针 3 的"修复前"对照用的是 `.tmp/oldsrc`、`.tmp/revert` 副本）。下文 `PROBE …` 均为实跑输出。

## 交接结论：不可交接（阻断 1）

**N3 这轮真的关掉了**：44 套逐套单跑 **44/44 绿、断言级 376 PASS / 0 FAIL**，与提交信息"44 套逐套单跑全绿"逐字相符
（R4 的 42/43 已成过去）。回归面也没被这轮的顺序调整带坏（确认消息仍在、`/say` `/wake` `/new` `/why` 通知审计都正常）。

**N2 只修好了一半，而且没有任何测试锁住这一半**：

1. R4 举的那个症状在"**同一个 tick 里手机票同步到达**"的时序下确实消失了（`sync` 时序：修复前 2 条 → 现在 1 条）；
2. 但在"**同一个 tick 里手机票晚一个微任务到达**"的时序下，输出与修复前 `89165be` **逐字相同**：
   2 条互相矛盾的审计、接缝返回 `allowed` 而待答点里记的是"拒绝"、手机同时收到"已收到"和"已在电脑端处理"
   （`PROBE HEAD.mt` vs `PROBE 89165be.mt`）。两边只差一个 `Promise.resolve().then(...)`。
3. 根因不是 R4 处方的那个位置，而是 R2 已经点过的第二半：**GUI 分支不看 `points.drop()` 的返回值**
   （`bridge.js:1215`、`:1314`）。`drop()` 在点已 `resolved` 时返回 `false`（`core/wait-point.js:70-77`），
   代码却照样写 GUI 审计、照样回"已在电脑端处理"、照样把 GUI 的票返回给 DSH。
4. 更硬的一条：**把 `src/app/bridge.js` 整份换回 `89165be`（等于撤销本轮 N2 修复），44 套仍然 44/44、
   376 PASS / 0 FAIL**（实测见下）。也就是说这轮唯一的产品修复**零测试覆盖**——s41 在"有 bug 的代码"上同样全绿。
   上一轮的阻断叫"审计不守恒"，本轮交上来的状态是"部分守恒 + 无证据"。

阻断 1 = **N2（审计守恒只覆盖到同步到票的时序；微任务错位时仍 2 条；且该修复不被任何测试锁住）**。
N3 按"已关闭"核销；回归无新增问题；另记 9 条非阻断残留（§剩余风险）。

## N2 复验

### 1）四种时序，两侧并排（HEAD 实跑）

探针 `r5-probe.mjs`：每格是"待答点状态 / 审计条数 / 审计内容 / 手机收到的回执"。

| 时序 | 审批侧 | 提问侧 | 判定 |
|---|---|---|---|
| **QQ 先答**（GUI 永不回） | `A1.qqFirst = {"outcome":"allowed","point":"resolved","audits":1,"outcomes":["{\"text\":\"yes\",\"by\":\"u1\"}"],"acks":1,"requestId":"C-qq"}` | `B1.qqFirst = {"ans":{"answers":[{"id":"q1","selected":["A"],…}]},"point":"resolved","audits":1,"outcomes":["{\"selected\":[\"A\"],\"by\":\"u1\"}"],"acks":1}` | ✅ 恰好 1 条，内容=生效票，`requestId` 是 `callId`（审批侧） |
| **GUI 先答 + 迟到手机票** | `A2.guiFirstLateQQ = {"outcome":"rejected","point":"dropped","auditsBeforeLate":1,"audits":1,"outcomes":["{\"via\":\"gui\",\"outcome\":\"rejected\"}"],"lateAcks":0,"lateReply":"wp-2 已作废（answered-on-gui）——这次答复没有被采纳。"}` | `B2.guiFirstLateQQ = {"ans":{"answers":[{"id":"q1","selected":["B"]}]},"point":"dropped","audits":1,"outcomes":["…via:gui…"],"lateAcks":0,"lateReply":"wp-5 已作废（answered-on-gui）——这次答复没有被采纳。"}` | ✅ 1 条，迟到票**不回**"已收到"（`lib/index.js` 的 `res.ok` 之外，`:337` 的状态闸门也在起作用） |
| **都不答** | `A3.none = {"outcome":"unavailable","point":"dropped","audits":0}` | `B3.none = {"point":"dropped","audits":0}`（返回 `undefined` → 让位给桌面） | ✅ 0 条 |
| **两边都答** | **`sync` 1 条 ✅ / `mt` 2 条 ❌**（见下） | **`mt` 2 条 ❌**（`3.q.mt`） | ❌ 不守恒 |

### 2）"两边都答"钉死：只差一个微任务

探针 `r5-probe2.mjs`，对立票（GUI=`allowed`，手机=`/no` 拒绝），同一套代码只改"手机票什么时候到"：

| 到票方式 | `seamOutcome` | 待答点 | 审计 | 审计内容 | 手机收到 |
|---|---|---|---|---|---|
| `sync`（同一 tick，同步到） | `rejected` | `resolved` / 拒绝 | **1** | `拒绝` | 1 条"已收到" |
| `t0`（`setTimeout 0`） | `allowed` | `dropped` | **1** | `via:gui allowed` | 0 条"已收到" + 1 条"已在电脑端处理" |
| `qqFirst`（先 /no 再放 GUI） | `rejected` | `resolved` / 拒绝 | **1** | `拒绝` | 1 条"已收到" |
| **`mt`（GUI 解析后，手机票在微任务里到）** | **`allowed`** | **`resolved` / 拒绝** | **2** | `拒绝` **和** `via:gui allowed` | **两条都收到** |

`1.mt.distinct` 原文：

```
PROBE 1.mt.distinct = {"mode":"mt","seamOutcome":"allowed","pointStatus":"resolved","pointAnswer":"拒绝",
 "audits":2,"auditOutcomes":["{\"text\":\"拒绝\",\"by\":\"u1\"}","{\"via\":\"gui\",\"outcome\":\"allowed\"}"],
 "acks":1,"guiNotice":1}
```

重复 120 次，**120/120 落 2 条**（`2.stress.mt = {"mode":"mt","n":120,"audits2":120,"audits1":0,"other":0}`；
`sync` 60/60 为 1 条、`t0` 40/40 为 1 条）。提问侧同样：`3.q.mt = {"audits":2,"outcomes":["{\"selected\":[\"A\"],\"by\":\"u1\"}","{\"via\":\"gui\",\"answers\":[…B]}"],"acks":1,"pointStatus":"resolved"}`。

**这就是 R4 报的那个症状**（"两边都答：`audits = 2`、生效票是 GUI 的、第二条是被丢弃的手机票、手机同时收到两条"）。
它能出现的前提是：处理手机票时点仍 `open`（否则 `:337` 的状态闸门先把它挡掉），也就是两边真的同时作答。
HEAD 把 `points.answer` 从 `await this.send` 之后挪到前面，"同一 tick 同步到票"这一格因此从 2 条变 1 条；
但只要手机票晚一个微任务到，GUI 仍能在 `Promise.race` 里胜出，而 GUI 分支不看 `drop()` 的返回值 → 又回到 2 条。
**真正多余的是 GUI 那条审计**，`res.ok` 管不到它（手机票确实结算成功，`res.ok === true`）。

### 3）与修复前逐字对跑（`r5-probe3.mjs`）

`.tmp/oldsrc` = 89165be 的 `bridge.js` + 当前其余源码；同一探针跑两遍：

```
PROBE HEAD.lateAfterGui    = {…,"audits":1,…}      PROBE 89165be.lateAfterGui = {…,"audits":1,…}   ← 顺序型本来就守恒
PROBE HEAD.mt              = {"outcome":"allowed","point":"resolved","pointAnswer":"拒绝","audits":2,…}
PROBE 89165be.mt           = {"outcome":"allowed","point":"resolved","pointAnswer":"拒绝","audits":2,…}  ← 与 HEAD 完全相同
PROBE HEAD.sync            = {"outcome":"rejected","point":"resolved","audits":1,"outcomes":["{\"text\":\"拒绝\"…}"]}
PROBE 89165be.sync         = {"outcome":"allowed","point":"resolved","audits":2,…}                     ← 这一格本轮修好了
```

结论：本轮改动**确实**收紧了"同步到票"那一格——旧代码在 `points.answer` 之前多一个 `await this.send`，
把这次 await 让给了 GUI 的答复链，于是 GUI 在 `Promise.race` 里胜出；此时点已被手机票结算，`drop()` 返回
`false`，但旧代码照样写 GUI 审计 → 2 条。HEAD 把答案前移后这一格只剩手机那 1 条；但"微任务错位"那一格
（GUI 先胜出、手机票随后结算成功）没有任何变化。

### 4）修复是否被测试锁住：把 `bridge.js` 换回 89165be（`.tmp/revert` 副本，整树复制）

```
REVERTED-BRIDGE TOTAL=44 GREEN=44 RED=0 PASS=376 FAIL=0
（s41 / s3-order / s40 / s38-dual / bb-batch5 / s8-audit 全部绿）
```

即：**撤销 N2 修复，44 套照样全绿**。N2 的修复当前是"无证据的修复"——这本身足以让"审计守恒"无法被记入台账。

### 5）根因与修法（两处，两行）

```js
// bridge.js:1215 与 :1314，两处同形
this.points.drop(wp.id, 'answered-on-gui')   // 返回值被丢弃
…
await this.audit.append({ …, outcome: JSON.stringify({ via: 'gui', … }) })   // 无条件写

// 建议
if (!this.points.drop(wp.id, 'answered-on-gui')) {
  // 点已被另一端结算：不写审计、不发"已在电脑端处理"，按点的真实结局返回（或 await qq 那一路）
  return settledFromPoint(wp)      // 审批侧；提问侧同理
}
```

两句修完，`mt` 时序自然变成 1 条（此时该写的是手机那条，GUI 那条不再重复），`PROBE 1.mt` 的
`seamOutcome=allowed` 与 `pointAnswer=拒绝` 的自相矛盾也一并消失。
配套测试（必须能对 `89165be` 变红）：s41 里加一条"GUI 解析后，手机票从微任务到达"，断言 `audits === 1`
且 `outcome`/`pointAnswer` 一致；提问侧同理加一条。

## N3 实际基线

用任务指定的 `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`，
`test\*.mjs` 共 46 个，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 后 **44 套**逐套单跑（每次独立进程）：

```
TOTAL=44  GREEN=44  RED=0
断言级：PASS=376  FAIL=0
（明细落盘：.tmp\r5-baseline.txt）
```

与上一轮对照：R4 是 43 套 / 364 PASS / 2 FAIL；本轮 +s41（9 条）+BB-70 一条 = 376。
**提交信息"44 套逐套单跑全绿"属实**，N3 关闭。

套件明细（PASS 数）：bb-batch1 12、bb-batch2 12、bb-batch3 11、bb-batch4 3、**bb-batch5 23**、bb-batch6 4、
s2-transport 35、s3-label 8、s3-order 9、s3-seq 6、s4-state 14、s5-question 12、s5-say 11、s6-label 12、s8-audit 17、
s10-wake 5、s11-new 7、s12-consult 8、s13-hidden 3、s14-notify 7、s15-writes 5、s16-progress 6、s17-late 7、
s18-watchdog 5、s19-goodbye 4、s20-offline 6、s21-degrade 4、s22-noise 4、s23-format 9、s26-wake-id 3、s27-idcmds 7、
s29-wake-resolve 4、s30-say-text 5、s31-copy 18、s32-relay 7、s33-prompts 3、s34-deliver 6、s35-title 5、
s36-workspace 2、s37-qqtitle 3、s38-dual 7、s39-guarantees 22、s40-question-next 6、**s41-audit-conservation 9**。
（合计 376，与断言级计数一致。）

`bb-batch5` 的 BB-70 重写按 D20 判据是**对的**：第一条 `/say`（空闲且已加载）现在断言"进入确认"
（`r1.includes('将要发送')`），清掉 wp 后再发第二条（运行中）断言 `/正在跑|运行中/` 且不进确认（`:140-142`）。

## 回归扫描

这轮只动了 `resolveAnswer` 的回执/结算顺序、两条黑盒断言、一条 s40 断言和新增 s41。逐项确认周边：

| 路径 | 结论 | 依据 |
|---|---|---|
| **确认消息是否还能可靠看到** | **能，但顺序变了**（先结算后回执） | `F.order = {"outcome":"allowed","order":["resolve","send:已收到：wp-1"],"hasAck":true}`；`G.ackVsNotify = {"msgs":["[wp-14] 需要你批准…","已收到：wp-14 → yes","[sess-o]\n本轮 1 分钟：…"],"ackPresent":true}`——即便"结算即触发 turn/end 通知"，确认仍先于通知被 `send` 出去。代码上 `:449` 的 `await this.send('已收到…')` 在 `res.ok === true` 分支里**无条件**执行，`send()` 内部自捕获异常（`bridge.js:1370-1398`），没有早退路径能跳过它。 |
| 有没有"更快路径"导致确认丢失 | 没有新的丢法；**但有一条被有意改掉的路**：`res.ok !== true` 时不再回"已收到"，改回"已被处理（reason）"，并且**不再写审计**。这正是 N2 要的语义，不是缺陷。`H.lateVotes` 三种迟到入口（`/ans <id> <文本>`、`/ans <id> 1`、`/yes <id>`）各回一条"已作废…没有采纳"，`lateAcks = 0`、`audits` 仍为 1。 |
| `s3-order` 断言放宽的后果 | 可接受，但**"顺序"这条不变量从此没人守** | 新断言是 `resolveIdx >= 0 && confirmIdx >= 0`（`:65`）。上面"把 `bridge.js` 换回 89165be"的实验里 s3-order 仍 9/9 绿——说明它已不能区分两种顺序。原意（确认不能丢）由 `:62` 的 `check(confirmIdx >= 0, '确认消息已发出')` 保留了一半。 |
| `/say` 确认卡 → `/ans 1` → 注入 → 回执 | 正常 | `I.say.confirm = {"card":"[wp-16] 将要发送：改测试","id":"wp-16"}`；`I.say.afterAns = {"fed":1,"status":"resolved","reply":"已发送：改测试"}`；`s5-say` 11/11、`s30` 5/5、`s32` 7/7 绿 |
| `/wake` | 正常 | `I.wake = {"reply":"已唤醒 aaaa11（aaaa11），状态「空闲」，可以 /say。"}`；`s10` / `s26` / `s29` 全绿 |
| `/new` | 正常，`workspaceId` 仍传 | `I.new = {"reply":"已在 . 新建 newwww（今天第 1/10 个）。用 /say 给它第一句话。","createdArgs":{"workspaceId":"w1"}}`；`s11` 7/7、`s36` 2/2 绿 |
| `/why` | 咨询键仍是会话短 id；**成功时仍无即时回话**（R4 残留 6，未变） | `I.why = {"consults":["session-aaaa1111"]}`，`sent2` 里没有新增回话；`s12` 8/8 绿 |
| 通知（空闲 / 卡住 / 完成） | 正常 | `s14-notify` 7/7（10 分钟停滞、30 分钟升级、turn/end "它停了"、不重复） |
| `/list` `/use` | 正常 | `I.list` 仍是"任务列表（按修改时间倒序）：… 用 /use <序号\|短id> 绑定；…"；`I.use = {"reply":"已绑定 aaaa11；「空闲」时可用 /say，运行中会等它结束。"}`；`bb-batch1/2/3` 全绿 |
| 审计字段 | 未变（仍是 8 键） | `J.auditFields.keys = ["requestId","wpId","openid","at","card","evidenceViewed","evidenceMissing","outcome"]`，`requestId = "C-fields"`（callId），`card.text` 是卡片原文（A26 五字段里的"卡片事实快照"在） |
| 未知命令 / 裸文本 | 未变 | `s22` 4/4、`s23` 9/9 绿 |
| 双通道（GUI 胜出） | 未变，落盘仍在 | `A2`/`B2` 的 `point = "dropped"`；`s38-dual` 7/7 绿 |

### 假绿抽查

- **`s39-guarantees.mjs` 仍是纯源码 grep，一条行为都没有**：`:15-17` 读源码字符串，`:20-61` 全是
  `includes` / 正则（22/22 PASS）。R3 指出的"审批有 `handleApproval(request, { next`，提问一条都没有"
  **依然如此**（`grep handleQuestion` 零命中）。它对本轮 N2 加不了分。
- **`s40-question-next.mjs:29` 的恒真断言换了皮，还是恒真**：`check('传 next 时 handleQuestion 不抛错',
  p instanceof Promise && typeof p.then === 'function')`——`handleQuestion` 是 `async`，返回值**必然**是 Promise。
  真正兜住崩溃的是后面的 `await p` 与返回值形状断言（`:33`）。这次改动是文字修改，不是覆盖增强。
- **`s41` 并没有覆盖"四时序"**（9 条断言，4 段）：
  - 段 1（`:25-41`，标"两边都答"）实际是"**GUI 先答并已 `await p` 结算完**，手机票**之后**才到"——
    测的是迟到票路径，不是同时作答；且它依赖的是 `:337` 的状态闸门，与 N2 修的那两行无关
    （证据：换回 89165be 它照样绿）。
  - 段 2（`:43-56`，标"QQ 先答"）里 `next: () => new Promise(() => {})`——GUI 永不答，是单通道路径；
    断言只有 `audits === 1` 与 `openid === 'u1'`，没有断言审计内容=手机那一票。
  - 段 3（`:58-66`）超时 0 条；段 4（`:68-76`）是 N1 的重启误报，不属于四时序。
  - **提问侧一条用例都没有**（R4 的 N2 证据里提问侧同样是 2 条）；**没有"GUI 解析后手机票微任务到达"**这一格
    ——这正是唯一还红的那一格。
  - 净效果：`s41` 在"撤销 N2 修复"的代码上 9/9 全绿（实测），不能作为 N2 的验收证据。

## 剩余风险（不阻断）

> 关于 N2 的两处未闭合点（`mt` 时序、修复零覆盖），见 §N2 的 2）与 4），这里不重复。

1. **N2 的残留窗口今天是否可达**：需要"手机票在 GUI 答复解析后的同一 tick 里、由微任务派发"。生产路径上
   QQ 事件是同步派发的（`transport/qq.js:108-152` 的 `#onFrame` 由 ws `message` 监听同步调用，`:141`
   直接 `#emit('event')`），所以今天不可达；一旦入站派发改成 promise 化（去重队列、限流、`await` 预处理
   这类常见改法），立刻变成可达。这也是"必须补 `drop()` 返回值判断"而不是"只能靠调度假设"的理由。
2. **本轮 N2 修复零覆盖**：`s41` 与全部 44 套在 89165be 上同样全绿；s3-order 也不再守顺序。
   建议把"先结算再回执"与"`res.ok` 才写审计"各锁一条（前者可用 `send` 与 `points.answer` 的调用序，
   后者可用"到票时点已 resolved"的构造）。
3. **提问侧审计的 `requestId` 仍是 `wp-N`**：`bridge.js:1318` 用 `wp.meta?.callId ?? wp.id`，
   而提问的 `meta`（`:1276`）没有 `callId`，`unwrap` 取到的 `requestId` 也没存。实测
   `PROBE question.qqFirst.audit.requestId = "wp-1"`、`PROBE question.guiFirst.audit.requestId = "wp-2"`
   （审批侧同一请求是 `"C-qq"`）。A26 要"能对上 DSH 那次请求"，提问侧仍对不上（R2 已记，未修）。
4. **字段名与 frame 不齐**：frame A27a/A27b 写 `evidence_missing` / `evidence_viewed`，落盘是驼峰
   （`audit.js:27-28`），本轮未动。
5. **`Delivery` 去重键仍不合契约**：02:25 要求 `request.callId ?? wp.id`，实现是 `auto-<startedAt>-<seq>`；
   症状（撞键）早没了，但无 `callId` 的请求永远无法去重，且 `deliveries` 每来一个就多一个永久键、无裁剪。
6. **`answerWithText()` 仍是死代码，且保留着"先回执、无条件 `points.answer`、无条件审计"的旧语义**
   （`bridge.js:466-480`，全仓无调用点）。谁把它接回去，N2 立刻复活——建议删掉，别留第二条看起来能用的路径。
7. **`bridge.js:461` 的日志三元已死**：早退分支在前，到这里 `res.ok` 恒为 `true`，`res.reason` 永不会打印。
8. **`/why` 成功时仍无即时回话**（R1 S5 / R4 残留 6）：探针 `I.why` 投完问题后没有新增消息，
   要等咨询轮次结束才有内容；A18/A19 的"≤10s 有人感"仍靠咨询轮次。
9. **N4 守卫只认裸 request**（R4 残留 5，未变）：`lib/index.js:105` 读 `request.signal`，
   `questionEvent()` 不复制 `signal`，Event 形状下这条守卫与 DSH 侧中止会同时失效。

## 复跑方式

```
$node = C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个单跑 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）→ 44/44 绿，断言级 376 PASS / 0 FAIL
$node .tmp\r5-probe.mjs    → A1/A2/A3、B1/B2/B3、C.guiThenQq*、D.question.race、E.abort、F.order、G.ackVsNotify、H.lateVotes、I.*、J.auditFields
$node .tmp\r5-probe2.mjs   → 1.*.distinct、2.stress.{mt,sync,t0}、3.q.*、4.list/new/wake
$node .tmp\r5-probe3.mjs   → HEAD.* 与 89165be.* 六行对照（mt 那两行逐字相同）
$node .tmp\r5-probe4.mjs   → PROBE question.qqFirst.audit / question.guiFirst.audit（提问侧 requestId=wp-N）
（可选）把 .tmp\revert\src\app\bridge.js 换成 89165be 版本再跑全量 → 仍 44/44、376/0
```

状态：未通过（阻断 1）
