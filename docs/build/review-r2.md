# 评审 · 轮次 2

审查对象：`src/**`、`lib/index.js`、`test/*.mjs`，对照 `docs/frame/qq-bridge.md`、
`docs/arch/qq-bridge/02-contracts.md`（v2）、`docs/build/review-r1.md`。
作者三次提交：`ff7485a`（重建 bridge.js）、`605c755`（B1/B2/B3/B6/B7/B8/B9）、`c04765a`（B4/B5）。

验证方式：读代码 + 逐条实跑；另有一次性探针 `.tmp/r2-probe.mjs`（只调用现有实现，不改代码、不写仓库），
下文所有 `PROBE …` 字样都是它的实跑输出，每条对应一次可复现的调用序列。

测试基线（指定 node，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs`，其余 42 套逐个单跑）：
**40 绿 / 2 红**——`bb-batch3.mjs`、`bb-batch5.mjs` 红（见 N3）。三次提交都写"测试 42/42"，与当前 HEAD 不符。

## 结论：不通过（阻断 8）

阻断 = B1（未关闭）、B3 / B7 / B8 / B9（部分关闭，差的部分仍阻断）、N1、N2、N3。
B2 / B4 / B5 / B6 已关闭（B4、B2 留有非阻断残留，见 §复核附录）。

## 核销表

| 阻断 | 结论 | 依据 |
|---|---|---|
| B1 推送去重键 | **未关闭** | `bridge.js:1122` 改成 `request.callId ?? \`wp-${(this.points.seq ?? 0) + 1}\``，但 `WaitPointStore` **没有 `seq` 属性**（`wait-point.js:7` 是模块级 `let seq`，实例上不暴露）→ 键恒为字面量 `'wp-1'`，仍是所有无 `callId` 审批共用一个桶，第 4 个照旧 `return 'unavailable'`（连卡片都不发）。探针：连发 4 个无 `callId` 审批 → `PROBE B1.deliveryKeys = ["wp-1"]`、`B1.wpCreated = 3`、`B1.cardsSent = 3`、4 次结果全 `unavailable`。与契约 `Delivery`「去重键 `request.callId ?? wp.id`」（02-contracts.md:25）仍不一致：键在 `points.create()` **之前**算，本意是预测下一个 wp id，但预测源不存在。 |
| B2 GUI 兜底 `unavailable` 当已答复 | **已关闭** | `bridge.js:1184-1192` 增加 `first.outcome !== 'unavailable'`。探针：`next()` 解析 `'unavailable'` → `B2.openAfterGuiUnavailable = 1`（待答点仍 open）、`B2.guiAnsweredMsg = 0`（不再发"已在电脑端处理"）、随后手机 `/yes` → `B2.outcome = allowed`。R1 的可观察后果（3ms 秒拒）不再出现。残留（非阻断）：判据仍是 `typeof === 'string'` 而非 `OUTCOMES.has(v)`，`next()` 若回空串/未知串会被当"GUI 已答"，经 `lib/index.js:39 normalize()` 兜成 `rejected`。 |
| B3 卡片 `/why wp-N` 与会话解析 | **部分关闭**：错路由已堵，**卡片提示依旧不可用** | `bridge.js:577-578` 让 `resolveTargetId('wp-N')` 返回 `null`，`ask()` 走 `:605-608` 报"找不到…这个会话"——不再拿 `wp-3` 当会话 id 白开咨询会话（探针：`B3.consultsAfterWhyWp = []`，同一条会话用 `aaaa11` 仍能建咨询 `B3.consultsAfterWhySession = ["session-aaaa1111"]`）。但卡片三处提示**一个都没改**（`envelope.js:62/64/66/67`）：探针 `B3.cardHint = 改：/ans wp-5 1 批准 ｜ /ans wp-5 2 拒绝 ｜ /why wp-5 看现场`，而这条 `/why wp-5` 必然回"找不到 wp-5 这个会话"。R1 给的两种修法（卡片改印会话短 id，或 `ask()` 先把 wp 映射到 `meta.sessionId`）都没采纳，用户被指到一条死命令上。 |
| B4 提问接缝没传 `next`；按字符串判 | **已关闭** | `lib/index.js:103` 已传 `{ next }`；`bridge.js:1269-1287` 按 `{answers:[]}` 形状识别 GUI 答复并原样返回。探针：GUI 先答 → `B4.guiFirstReturn = {"answers":[{"id":"q1","selected":["A"]…}]}`、手机收到"已在电脑端答复"、审计写 1 条；GUI 回 `'unavailable'` → 待答点仍 `open`，手机 `/ans` 后 `B4.qqAfterGuiUnavailable = {"answers":[{"id":"q1","selected":["B"]…}]}`。生产路径上不再"桌面答完仍等手机"。残留（非阻断）：见 N4、N6，以及 GUI 答复的 `requestId` 落成 `wp-N`（提问 `meta` 里没有 `callId`，`bridge.js:1239`）。 |
| B5 `/say <id>` 先要求绑定；短 id 被吞 | **已关闭** | `bridge.js:845-864` 显式 id 时不再要求 `boundAgent`，未加载目标回"先 /wake"；`looksLikeSessionRef`（:819-836）改为异步查会话库。探针四组：未绑定+目标未加载 → `aaaa11 没加载：先 /wake…`、0 个 say 待答点；绑定 B 目标 A 未加载 → 同样回 `先 /wake`、**没有**发给 B（`B5.boundBtargetA.sayPoints = 0`）；未绑定+目标已加载 → `sayPointMeta.sessionId = session-aaaa1111`、注入 A 一次 / B 零次；`/say doctor 指令…` 首词仍作正文（`[wp-9] 将要发送：doctor 指令要执行`）。R1 的 d1/d2 两个后果都不再出现。 |
| B6 提问接受 `/yes` `/no` | **已关闭** | `bridge.js:408-412` 前置拦截。探针：`/yes wp-10` → `B6.yesReply = 这是提问，不是审批…`、`B6.statusAfterYes = open`；`/no wp-10` → 同文案、`statusAfterNo = open`；两次都没写审计（`B6.auditBeforeAnswer = 0`），随后 `/ans wp-10 1` 正常答复。契约矩阵的"—"在代码里成立了。 |
| B7 审计 `requestId` 撞号、`evidenceViewed` 写死 | **部分关闭**：`requestId` 只对"有 callId 的审批"成立；`evidenceViewed` 原样未动；`wpId` 落不了盘 | ① `requestId: String(target.meta?.callId ?? target.id)`（:444）+ `meta.callId`（:1137）→ 有 `callId` 的审批现在记 `call-777`（探针 `B7.entry`）。② 但 `evidenceViewed` 四个写入点仍全是字面量 `false`（:449、:467、:927、:1283），全仓无一处写 `true`；先 `/why` 再批准，仍 `B7.afterWhy.evidenceViewed = false`。③ `Audit.append` 用固定字段解构（`audit.js:20-29`），两处调用点传的 `wpId` 被**静默丢弃**：`B7.hasWpId = false`——"保留 wp-N 便于追溯"这句话没有落地。④ 无 `callId` 时（正是 B1 的场景）仍回落 `wp-N`；提问/GUI 答复（`meta` 无 `callId`）同样记 `wp-N`（`B4.auditAfterGui[0].requestId = "wp-6"`）。 |
| B8 序号解析不过滤咨询会话 | **部分关闭**：只修了其中一条读路径，`/use`、`/wake` 仍指向咨询会话 | `resolveTargetId`（:565-566）与 `looksLikeSessionRef`（:830-831）已同源过滤，探针里 `/list` 首行是任务（`1) aaaa11`）、`B8.resolveTarget1 = session-aaaa1111`、`/progress 1` 也正确。但 **`useSession`（:803）与 `wakeSession`（:755）仍在各自重新读未过滤的 `listStoredSessions`**——R1 点名的两个命令照旧中招：`B8.use1Reply = consul 不在运行中，无法 /say；请在 GUI 里打开它。`（A36 想藏的会话又泄露了）、`B8.wake1Reply = 已唤醒 consul…`。三份重复实现只收拢了一份。 |
| B9 被动回复窗口无校验 | **部分关闭**：窗口锚在"最后一条入站"，不是"这条 msg_id 的年龄"；发送失败仍无主动兜底 | `bridge.js:1336-1337` 加了 `now - lastMsgAt < 55min`，55 分钟外确实转主动：探针 `x3-stale:proactive`；55 分钟内仍是 passive（`x1-within:passive:seq=2`、`x2-within:passive:seq=3`），**正常回复不退化**。但 `lastMsgAt` 只记"最后一次入站"，而 `send(content, msgId)` 的 `msgId` 可能是更老的一条（咨询通道的 `entry.pending.qqMsgId`、`#queueCard` 的 `lastMsgId` 会被新入站顶掉）：探针先入站 `m2` 刷新 `lastMsgAt`，再对 70 分钟前的 `m1` 发被动 → `x4-old-msgid:passive:msg=m1`，平台照样会拒。`send()` 的 `catch` 仍只记日志返回 `null`（:1346-1351），不发主动兜底、调用点（`#queueCard`）也不看返回值，R1 的"静默吞掉"仍在。 |

## 新发现

- **N1 [bridge.js:1188-1192、:1273-1286] GUI 先答的审批没有任何审计，而且不落盘 → 下次启动误报"待答请求已作废"。** 两个 GUI 分支都是 `points.drop()` 后直接 `return`：审批侧不写 `audit.append`（全仓 `audit.append` 只有 4 处，都在 QQ 路径），两侧都不 `#persist()`。探针（GUI 先答 `rejected`）：`DC.gui.outcome = rejected`、内存 `pointStatus = dropped`，但 `DC.gui.persistedStatus = open`、`DC.gui.auditCount = 0`；用同一个 `statePath` 新建 Bridge 再 `start()`，`DC.gui.afterRestartInterruption = {"dropped":1}`——用户会在下次启动收到"上次非正常结束，有 1 个待答请求已作废"，而那一条其实早在电脑上批过了。A26 的"每次决定都有审计"在桌面路径上是空的。
- **N2 [bridge.js:1188-1192 ↔ :440-452、:1273-1286 ↔ :442] "两边都答"时审计与实际决定不守恒：审批记的是**没被采纳**的那一票，提问会**同一 wp 两条审计**。** 复现时序：手机 `/yes` 已通过 `status === 'open'` 检查、正停在回执 `await this.send(...)` 上（探针用可控阻塞的 client 卡住），此时 GUI 作答 → GUI 分支 `drop` 并返回 GUI 结果；随后 QQ 侧继续执行 `points.answer()`（返回 `ok:false`，因为已 dropped）但**无条件**写审计。探针：
  - 审批：`DC.both.outcome = rejected`（GUI）、`pointReason = answered-on-gui`，审计却只有一条 `{"requestId":"c-both","outcome":"{\"text\":\"yes\"}"}`——落盘的是被丢弃的手机答复，桌面那次批准没有任何记录；同时手机已经收到"已收到：…→ yes"。
  - 提问：`DC.qboth.return = {"answers":[{"id":"q1","selected":["B"]…}]}`（GUI 的 B），审计两条同 `wp-16`：`{"via":"gui",…selected:["B"]}` 和 `{"selected":["A"],"by":"u1"}`。
  - 结论：四种时序下**接缝都只结算一次**（GUI 先答 / QQ 先答 / 两边都答 / GUI 报错，探针各得一个返回值），但"审计恰好一条且内容正确"不成立。根因两处：审计在 `points.answer()` 之后不看 `res.ok`；GUI 分支不看 `drop()` 的返回值/当前状态。
- **N3 [test/bb-batch3.mjs:73-75、test/bb-batch5.mjs:132-136] 测试套件是 40/42，不是 42/42。** 单跑确认（指定 node，排除 s1/s3-loop 后逐个执行）：
  - `bb-batch3` BB-52「审计里两个 id 各一条」红：测试拿 `wp-1/wp-2` 去比对 `audit.requestId`，而 B7 之后那里是 `callId`（`P1/P2`）；同时 N5（`wpId` 被丢）让它连"退回 wp id"的对照也拿不到。
  - `bb-batch5` BB-70「2/2 都是拒绝」红：测试断言 `/say session-hhhh7777 hi-A`（`boundAgent = null`）要被拒，而 B5 之后它按 D20 正确进了确认卡片（实测输出 `[wp-4] 将要发送：hi-A`）。
  - 两条都是"被测行为按 R1 要求改了、断言没跟着改"，但作者三次提交都写"测试 42/42"，台账会被这句话污染。
- **N4 [lib/index.js:101-104 ↔ bridge.js:1300-1309] 请求被 abort 时桌面 answerer 会被调两次。** `handleQuestion` 在 `settled.status === 'expired'` 时 `return undefined`，外层 `return answered ?? next()` 于是**再调一次** `next()`——第一次调用还在 pending（桌面弹窗正等人答）。探针复刻这两行并 abort：`DC.abort.nextCalls = 2`。B4 之前 `next` 根本没传，这条路径不可达；补上 `next` 后新暴露。
- **N5 [src/app/audit.js:20-29] `Audit.append` 用固定字段解构，`wpId`（以及任何新字段）静默丢失。** 两处调用点都传了 `wpId`（`bridge.js:445`、`:1279`），但落盘条目里没有它：`PROBE B7.hasWpId = false`。这让 B7 的"保留 wp-N 便于本地追溯"变成空头承诺，也是 N3 里 BB-52 变红的直接原因之一。
- **N6 [bridge.js:1269-1273] 提问的 GUI 判据把 `{answers: []}` 也当成"已答"。** `Array.isArray(outcome.answers)` 不校验非空：桌面 answerer 若以空答案（比如弹窗被关）返回 `{answers: []}`，桥接会 `drop` 待答点、回手机"已在电脑端答复（已答）"，并把空答案交给 DSH——与 B2 同类的"形状对了就算决定了"。低概率，但和 B2 是同一个判据缺陷的残留。
- **N7 [bridge.js:1336、:1346-1351] B9 的窗口判断锚错对象，且失败无兜底。** 见核销表 B9：`lastMsgAt` 是"最后入站时刻"，被回复的 `msg_id` 可能更老（`x4-old-msgid:passive`）；`sendPassive` 真被平台拒时仍只 `this.log.error` + `return null`，卡片调用点不看返回值，DSH 继续无限等（D10 没有超时）。窗口只关掉了"一直无入站"的那一半。

## 复核附录

### 双通道四种时序（只结算一次？审计恰好一条？）

| 时序 | 接缝返回值 | 待答点 | 审计 | 结论 |
|---|---|---|---|---|
| GUI 先答 | 1 个（GUI 的 `rejected` / `{answers}`） | `dropped(answered-on-gui)`，但**磁盘仍 open** | 审批：**0 条**；提问：1 条（`requestId=wp-N`） | 结算次数对；审计缺（N1） |
| QQ 先答 | 1 个（`allowed`） | `resolved`，磁盘 `resolved` | 1 条（`callId`） | 正确；GUI 之后作答被安静丢弃（符合"谁先答用谁"） |
| 两边都答 | 1 个（GUI 的那一票） | `dropped(answered-on-gui)` | 审批：1 条但内容是**被丢弃**的手机答复；提问：**2 条**同 wp | 违反 A26（N2） |
| GUI 报错 | 1 个（QQ 的 `rejected`） | `resolved` | 1 条 | 正确（与 `s38` 第 3 例一致） |

### 假绿复核（作者声称只修了 s8）

- **（a）s8 只改了一半。** 新增的集成段（`s8-audit.test.mjs:58-85`）确实读了审计文件并断言了**内容**（卡片原文、`openid`），这比 R1 的"只验字段存在"前进了一步；但 `:47` 仍然是 `all.every((e) => 'evidenceViewed' in e)`，`evidenceViewed` 的取值没有任何断言，也没有 R1 要求的"做过 `/why` → `true` / 没做 → `false`"成对断言，`requestId` 的值同样没验，`entries.length >= 1` 连"重复写了两条"都挡不住。B7 的第二半（`evidenceViewed` 恒 false）在 s8 上仍然是绿的。
- **（b）其余假绿仍在：**
  - **s13:23 依旧空转**：`sessionsRoot` 里从头到尾只写了 `sess-user1`（`s13:6-7`），`/why` 建的 `consult-1` 只存在 `consults` 数组里、没有落成会话目录，`listStoredSessions` 根本读不到它——把 `listSessions` 里的 `hidden` 过滤整段删掉，这条断言照样绿。新加的 `:21`「咨询会话 id 落盘」是真断言，但验的不是 A36。
  - **s21:30-33 原样未动**：`const ap = '…' // 占位`、`const entries = sent.length`、`check(entries > 0, '仍然可以批准（不阻拦）')`——审计文件从头到尾没被读，A27a 的 `evidenceMissing` 删掉也绿。
  - **s39 仍整套源码 grep**（`:20-61`）：`bridge.includes('answered-on-gui')`、`/handleApproval\(request, \{ next/`、`/\/ans \$\{wp\.id\} 1 发送/` 这些断言在 B1/B2/B4/B6 坏着的时候全绿，现在也照样绿——它对 B1 的键、B2 的判据、B6 的矩阵一个字都没验。
  - **s33 未改**：`:25-31` 仍是按行正则过滤源码的文案检查（`needsCmd` 为空时自动通过）。作为"文案静态检查"可以留，但不能算行为证据。

### 被动窗口是否让"正常 60 分钟内的回复"退化

没有退化：55 分钟内仍走 `sendPassive` 且 `msg_seq` 正确递增（探针 `x1-within:passive:seq=2`、`x2-within:passive:seq=3`），只把 55–60 分钟这一段改成主动消息（`x3-stale:proactive`）——消息仍送达，区别只是不再挂在用户那条消息的回复串上，属可接受的保守余量。真正没修的是窗口的**锚点**与**失败兜底**（N7）。

### 顺带核对、确认没问题的点

- `resolveAnswer` 的 `status !== 'open'` 前置检查仍在（`bridge.js:334-342`），重复答复第二条只回"已处理过"、不改状态（`BB-51` 绿）。
- `/say` 的确认卡仍先回显"将要发送 + 上次停在"，`/ans <id> 1/2` 分工未变（`s5-say`、`s30` 绿）。
- B5 的改动没有破坏"首词不是会话引用时当正文"（`s30` 第 13-15 行用例仍绿）。
- 咨询通道 `/why`/`/done` 对真会话 id 的行为未回退（探针 `B3.consultsAfterWhySession`、`s12` 绿）。
- `expired` 仍只来自 DSH 侧 abort（`bridge.js:1167-1171`、`:1251-1255`），桥接自己不产生 `expired`。
- `A25` 五词表：两张卡片仍返回 `leakedRating`，本次改动未引入评级词。

### 复跑方式

```
$node = C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个执行 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）→ 40 通过 / 2 失败
$node .tmp\r2-probe.mjs → 见正文 PROBE 行
```
