# 评审 · 轮次 1

审查对象：`src/**`、`lib/index.js`、`test/*.mjs`、`tools/*.mjs`，对照 `docs/frame/qq-bridge.md`（v7）、
`docs/arch/qq-bridge/02-contracts.md`（v2）、`03-decisions.md`（ADR-01…26）、`docs/build/qq-bridge.md`。

测试基线（我按任务给的 node 实跑，排除 `s1-waterfall.test.mjs` 与 `s3-loop.mjs`）：
**42/42 全绿，0 红**。但绿的原因里有一部分是"断言没验证行为"（见 §建议 S6–S10 与各阻断条的"测试为何没抓到"）。
另：本次评审用 `.tmp/r1-probe.mjs`（一次性探针，只调用现有实现，不改代码）复现了 B1/B2/B3/B5/B6/B7/B8 的可观察后果。

## 结论：不通过（阻断 9）

## 阻断

### B1 [src/app/bridge.js:1100-1109] 推送去重键把"没有 callId"的审批全并进同一个桶 → 当天第 4 个请求被静默拒绝

```
const key = String(request.callId ?? 'no-call')
...
if (pushed.length >= MAX_PUSH_PER_DAY) { ...; return 'unavailable' }
```

- **为什么是缺陷**：ADR-22 记录的审批请求形状是 `{agent, toolName, callId?, reason?, displayReason?, signal}`——`callId` 是可选的。一旦缺失，所有这类请求共用 `'no-call'` 这一个桶，24h 内第 4 个起直接 `return 'unavailable'`，**连卡片都不发**、待答点都不建。而 `'unavailable'` 是 fail-closed（F3/C1），DSH 侧等于"没有 answerer"→ 直接拒绝。契约 `Delivery` 写的是去重键 `request.callId ?? wp.id`（02-contracts.md:25），实现把它改成了 `'no-call'`，正是这条契约要防的碰撞。
- **可观察后果**（探针 (a) 已复现）：同一天第 4 个无 `callId` 的审批，手机上**什么都收不到**，DSH 侧立刻按拒绝处理；日志只有一行"24h 内已推 3 条，不再推"。用户会认为"桥接又挂了"。`deliveries` 是落盘的，重启也不清零，所以一天内多次重启后连一个请求都推不出去。
- **建议怎么改**：按契约回落到本次请求的唯一键（建 wp 之后用 `wp.id`，或先用 `requestId`）；把"已达上限"与"没有 callId"分开处理——上限只该压**同一请求的重复推送**，不该压"新请求"。若确实要限流，超限时应继续等答复（await `wp.promise`）而不是返回 `unavailable`。
- 现有测试为何没抓到：`s4-state.test.mjs:86-96` 用同一个 `callId:'same-call'` 连发 4 次来测阈值，恰好避开了"没有 callId"这一支。

### B2 [src/app/bridge.js:1153-1166；同一段复制到 :1233-1246] 双通道把 `next()` 的兜底 `unavailable` 当成"GUI 已答复" → 无桌面 answerer 时审批秒拒

```
const gui = ... then((v) => ({ by: 'gui', outcome: v }), () => ({ by: 'gui', outcome: null }))
const first = await Promise.race([qq, gui])
if (first !== null && first.by === 'gui' && typeof first.outcome === 'string') {
  this.points.drop(wp.id, 'answered-on-gui')
  this.send(`已在电脑端处理（${first.outcome}），这条不用再回手机。`, null)
  return first.outcome
}
```

- **为什么是缺陷**：F3 写明 `approval/request` 的 waterfall **默认回退 `"unavailable"`**。`next()` 在"本条之后没有 answerer"时立刻返回这个兜底值，它是一个字符串，于是被这里判定为"GUI 做了决定"。可 `unavailable` 的语义是"没人接"，不是"拒绝了"。在 profile 没有桌面审批 UI、或桌面端没注册 answerer 的运行形态下（headless / 后台 / 托盘），`next()` 毫秒级返回 `unavailable`，桥接就把自己刚建的待答点 `drop` 掉，并把 DSH 的 fail-closed 结果当成用户的决定返回。
- **可观察后果**（探针 (b) 已复现）：`next()` 返回 `'unavailable'` 时，`handleApproval` 3ms 就返回 `unavailable`，待答点状态 `dropped`，手机先收到卡片、紧接着收到"已在电脑端处理（unavailable），这条不用再回手机"。你还没来得及在手机上按任何东西，请求已被拒。生产上 `mergeMs=1500`，卡片还会在那之后才发出来，看起来像"卡片发了一张已经作废的"。这条直接击穿目标句"不必回 PC"。
- **建议怎么改**：只把 `allowed`/`rejected`/`cancelled`（`SeamOutcome` 的三个真值）当成 GUI 的决定；`unavailable` / `null` / 异常一律视为"GUI 没接"，继续等 QQ。别用 `typeof === 'string'` 当"是否已答复"的判据，用 `OUTCOMES.has(v) && v !== 'unavailable'`。
- 现有测试为何没抓到：`s38-dual.mjs:36` 只喂了 `Promise.resolve('rejected')`，从没喂过 F3 的兜底值。

### B3 [src/transport/envelope.js:62-67 ↔ src/app/bridge.js:587-596，回落分支 :567] 卡片让你 `/why <待答点 id>`，但 `/why` 只按**会话 id** 解析 → 咨询会话建在一个不存在的会话上

- **为什么是缺陷**：卡片三处提示都是 `/why ${id}`，这里的 `id` 是待答点 `wp-N`（envelope.js:62/64/66/67）。而 `ask()` 第一件事是 `resolveTargetId(cmd.id)`（bridge.js:592），它只认会话序号/短 id；认不出来时 **不报错，回落成"就把这串当会话 id"**（bridge.js:567 `return { id: String(idArg), cwd: null, title: null }`）。于是 `/why wp-3 看现场` 会用 `wp-3` 当"目标会话"去起一条咨询会话。会话 id 与待答点 id 两个命名空间就这样被混用了。
- **可观察后果**（探针 (c) 已复现）：`/why wp-3 看现场` 真的建了一条咨询会话（`cwd` 落到 workspaceRoot），`consults` 的键是 `wp-3`；投给它的提示词是"关于任务会话 wp-3"，而这个会话不存在。你会收到一条"看起来查过现场"的回答，但它与那张审批卡片毫无关系——这正好是 C5/A27b 要防的"你以为看全了"。附带代价：按 D19 咨询会话**可写**，为一次错路由白开了一条能改文件的会话。
- **建议怎么改**：二选一并写进契约——(a) 卡片提示改成 `/why <会话短 id>`（`wp.meta.sessionId` 已有，`shortOf` 即可）；或 (b) `ask()` 先按 `points.get(id)` 命中待答点，再用 `wp.meta.sessionId` 当路由键。同时把 `resolveTargetId` 的"认不出就原样当 id"改成显式失败（现在这个回落会把任何拼写错误都变成一条新咨询通道）。
- 现有测试为何没抓到：`bb-batch2.mjs:77,85` 只断言卡片里**字符串** `/why wp-7` 存在，从没真的执行过它；`s12`/`s27` 的 `/why` 用的都是真会话 id。

### B4 [lib/index.js:101-105 ↔ src/app/bridge.js:1233-1247] 提问接缝的双通道是空的：既不把 `next` 传下去，传了也会因形状判断错误而永远等 QQ

```
ctx.on('user-questions/request', async (request, next) => {
  if (bridge === null) return next()
  const answered = await bridge.handleQuestion(request)   // ← 没有 { next }
  return answered ?? next()
})
```
```
if (this.dualChannel && typeof next === 'function') { ... }
if (first !== null && first.by === 'gui' && typeof first.outcome === 'string') {
  ...; return first.outcome                                  // ← 提问的答复不是字符串
}
```

- **为什么是缺陷**：审批那侧传了 `{ next: () => next() }`（lib/index.js:80），提问这侧没传。`handleQuestion` 的 `next` 分支因此是**生产上不可达的死代码**——在那之前桌面 UI（waterfall 里的下一个 answerer）根本不会被调用，问题只能在手机上答。而即便补上 `next`，`typeof first.outcome === 'string'` 这个从审批抄来的判据也不成立：同一个 answerer 接口的返回值就是 `handleQuestion` 自己在 :1271-1278 返回的 `{ answers: [...] }` 对象，不是字符串。于是 GUI 已经答了，代码却走 `settled = await qq`，继续等 QQ 的回答——桌面答完任务仍然不动，直到手机再答一次。
- **可观察后果**：装了桥接以后，**在 PC 上回答问题不能让 agent 继续**（GUI 的 answerer 拿不到调用）；如果按 B4 的修法只补 `next` 而不改判据，则变成"桌面答了、代码还在等手机"，表现是问题无限等待（D10 又没有超时兜底）。
- **建议怎么改**：`lib/index.js:103` 改成 `bridge.handleQuestion(request, { next: () => next() })`；把双通道的"谁先答"判据抽成一个函数，按 **接口形状** 判定（审批看 `OUTCOMES`，提问看 `{answers}` 结构），GUI 胜出时原样返回 GUI 的结果，不要返回字符串。
- 现有测试为何没抓到：`s5-question` 全部调用都不带 `next`；`s38-dual` 只测审批；`s39-guarantees.mjs:35-38` 只 grep 源码里有没有 `next` 和 `answered-on-gui` 这些字样。

### B5 [src/app/bridge.js:825-828、:806-816、:832-843] `/say <id> <文本>`（D20 显式目标）两处走不到目标：未绑定时先被挡，目标未加载时 id 被吞进正文发给"绑定的那个会话"

- **为什么是缺陷**：`startSay` 在解析 `idArg` **之前**就要求 `this.boundAgent` 非空（:825-828）。D20 的显式形式 `/say <id|序号> <文本>` 目的就是"不靠当前绑定"，重启后（`boundAgent` 为空）反而一律被拒。第二处：`onEvent` 用 `looksLikeSessionRef(idArg)` 决定首词是不是 id（:280-283），而这个函数只查 `this.sessions`（进程内**已加载**的 agent，:806-816）。目标会话只是"盘上有、未加载"时，短 id 被判成普通词，于是拼回正文 `"<短id> <文本>"`，再按"没有 id"发给 `boundAgent`——也就是**发给另一个会话**。
- **可观察后果**（探针 (d1)/(d2) 已复现）：
  - `d1`：`/say aaaa11 给我改测试`（未绑定）→ "还没有绑定会话：先 /use…"，明明目标已经写在命令里。
  - `d2`：绑定 B、目标 A 未加载 → 回显 `[wp-5] 将要发送：aaaa11 给我改测试`，确认后消息真的注入到了 **B**，正文里还带着 A 的短 id。指令会落到错误的会话里，而且看起来"发送成功"。
- **建议怎么改**：先解析显式 id（用会话库而不是内存索引判断"像不像 id"），再要求绑定；目标未加载就明确回"先 `/wake`"（:`840-843` 这段逻辑已经写好了，只是走不到）；显式 id 存在时不要把它拼回正文。
- 现有测试为何没抓到：`s27-idcmds.mjs:42-48`、`s30-say-text.mjs:21-26` 的目标会话都在 `b.sessions` 里（已加载），`s30:15` 甚至断言"未加载短 id 要当正文"（它举的例子是 `doctor指令…`，恰好和"短 id 未加载"在代码里不可区分）。

### B6 [src/app/bridge.js:403-416、:434-446] 提问型收到 `/yes`、`/no` 会被当成合法答复注入："yes" 变成自由文本，"/no" 变成"空选择"

- **为什么是缺陷**：答复受理矩阵（02-contracts.md:31-36）对"提问（有选项/无选项）"在 `yes <id>` 一列写的是 **"—"**，即不适用。实现没有拦，反而给提问构造了 payload：`confirm` → `{ custom: 'yes' }`（:415），`reject` → `{ selected: [] }`（:411）。这等于把"命令用错了"翻译成"用户答了 yes / 用户什么都没选"。
- **可观察后果**（探针 (g)/(g2) 已复现）：
  - `/yes wp-3`（wp-3 是提问）→ `{answers:[{id:'q1', selected:[], custom:'yes'}]}`：agent 收到的是自由文本 "yes"，会把它当成对"用哪个方案？"的回答。
  - `/no wp-3` → `{answers:[{id:'q2', selected:[], custom:null}]}`：一道有选项的提问被"答"成空选择，而且 `points.answer` 成功、审计写了一条"决定"。
  审计里两条都会记成用户做出的决定（:436-444），事后无法区分"用户真的这么答"和"命令用错了"。
- **建议怎么改**：按矩阵做前置校验：`answerMode === 'closed'`（审批）只接受 option/confirm/reject；提问只接受 option（有选项时）和 answerText，其余回"该请求不接受这种答复"并保持 `open`（契约 `Answer` 的原文要求就是这个）。
- 现有测试为何没抓到：`s5-question` 只测了 `/ans … 2` 与自由文本；`s3-label` 的矩阵只覆盖审批。

### B7 [src/app/bridge.js:436-444、:454-461、:901-908；src/app/audit.js:20-29] 审计的两个关键字段是假的：`requestId` 存的是 `wp-N`，`evidenceViewed` 三处全写死 `false`

- **为什么是缺陷**：A26 要的是 `requestId`（DSH 的请求标识）+ 是否调过 `/why`。实现把**待答点 id** 塞进了 `requestId` 字段（`requestId: target.id`，即 `wp-N`）；而 `wp-N` 是 `wait-point.js:13` 的进程内自增，重启从 `wp-1` 重来。`evidenceViewed` 在三个写入点（选项答复 :441、文本答复 :459、咨询写操作 :906）都是字面量 `false`，`grep` 全仓没有任何一处写 `true`。`/why` 已经实现了（v7/D18），所以 01 §9 债 5 里"`/why` 未实现所以恒为 false"的解释已经不成立了。
- **可观察后果**（探针 (f) 已复现）：一条真实批准记录的落盘是
  `{"requestId":"wp-6","openid":"u1","at":...,"card":{…},"evidenceViewed":false,"evidenceMissing":false,"outcome":"{\"text\":\"yes\"}"}`。
  ①"仅凭该条目重建当时"可以（卡片原文在），但**无法把它和 DSH 会话日志里的那次工具调用对上**——`wp-6` 在 DSH 侧不存在；重启后 `wp-6` 还会指向前一个请求（撞号）。②你明明先 `/why` 再批，审计永远写着"没查看现场"；A27b 的判定对象因此不存在，C4 的"审计不可抵赖"只剩一半。
- **建议怎么改**：`meta` 里保留 `request.requestId`/`callId`（契约 02:23 明确说 wp id 不落进 meta，但**没禁止**记 DSH 的 requestId），审计写它；`evidenceViewed` 需要一条真实来源——例如 `ask()` 命中某会话时给该会话当前的 open 待答点打 `meta.evidenceViewedAt`，答复时读取。顺手把字段名与 frame 对齐（A27a/A27b 写的是 `evidence_missing`/`evidence_viewed`，`audit.js` 产出的是驼峰）。
- 现有测试为何没抓到：`s8-audit.test.mjs:47` 的断言是 `all.every((e) => 'evidenceViewed' in e)`——**只验字段存在**，值永远是 false 也绿。

### B8 [src/app/bridge.js:496-515 ↔ :554-568、:742-753、:789-798] `/list` 隐藏了咨询会话，但序号解析没隐藏 → `/use 1`、`/wake 1`、`/say 1` 绑到的是咨询会话

- **为什么是缺陷**：`listSessions()` 先 `filter((x) => !hidden.has(x.id))`（:498）再切片编号（:501），而 `resolveTargetId`（:556）、`wakeSession`（:742）、`useSession`（:790）各自重新读**未过滤**的 `listStoredSessions`，按同一个下标取。咨询会话是新建的（mtime 最新），在未过滤列表里通常排第 1。同一份"序号"在 `/list` 与其余命令里指的**不是同一个会话**。这是三份重复实现（`resolveTargetId`/`wakeSession`/`useSession`）各自漂移的直接后果，也是本轮"短 id/序号"语义里唯一会指向错误对象的地方。
- **可观察后果**（探针 (e) 已复现）：`/list` 第一行是 `1) task11 · …`，紧接 `/use 1` 回的是 `consul 不在运行中，无法 /say；请在 GUI 里打开它。`——它绑上并暴露出的是被隐藏的咨询会话；`resolveTargetId('1')` 返回 `session-consult99-0000`。之后所有不带 id 的 `/say` 都会对着这条咨询会话发；`/wake 1` 也会去挂一条咨询会话。附带把 A36 想藏起来的会话泄露到了回话里。
- **建议怎么改**：把"列表 + 编号 + 解析"收成一处（例如 `resolveTargetId` 内部就用 `listSessions` 的同一份过滤后数组），三处命令共用；`/list` 的序号定义要写进 02。
- 现有测试为何没抓到：`s13-hidden.mjs:23` 见 S7（断言空转）；`s27`/`s36` 的会话库里没有咨询会话。

### B9 [src/app/bridge.js:160、:253-254、:1289-1299；:1141] 60 分钟被动窗口没有校验：`lastMsgAt` 记了但没人用，过期后卡片静默丢失，DSH 无限等

```
this.lastMsgAt = 0            // :160
...
this.lastMsgId = data.id      // :253
this.lastMsgAt = this.now()   // :254  ← 之后全仓没有任何读取
...
if (msgId && used < 4) res = await this.client.sendPassive({ ... })   // :1293
else res = await this.client.sendProactive({ ... })
```

- **为什么是缺陷**：F6 明确"被动回复需 `msg_id`，单聊 **60 分钟内有效**、每条最多 4 次"。`send()` 选被动还是主动只看"有没有 msgId"和"这个 msg_id 用了几次"，**不看这条 msg_id 有多老**；`lastMsgAt` 被记录后从未被读，说明这层判断本来就该有、在重建里掉了。超过 60 分钟后被动回复会被平台拒绝 → `send()` 的 `catch` 只记日志、返回 `null`（:1302-1306），`#queueCard` 的返回值被忽略（:1141），`handleApproval` 继续 `await wp.promise`——而 D10 规定审批没有超时。
- **可观察后果**：这正是产品的主场景。你离开 PC，两小时后某个工具触发审批：`lastMsgId` 是你两小时前那句 "go"，卡片按被动回复发出→平台拒绝→手机上**永远收不到卡片**，日志里只有一行"发送失败"，DSH 侧无限等（不是 fail-closed，是挂着）。`failedSends` 累计到下次重连才转成一句"断网期间有 N 条没送达"，而那时光凭 id 也补不回来（另见 S2）。
- **建议怎么改**：`send()` 增加窗口判断——`now - lastMsgAt > 55*60_000` 或 `sendPassive` 失败时改用 `sendProactive`（主动消息已实测可用，台账·依赖盘点）；被动失败也要在卡片的调用点可见（至少把 `null` 变成"改用主动发一次"），不能静默吞掉。
- 现有测试为何没抓到：`s4-state.test.mjs:99-110` 只测"没有 msgId → 主动"，从没测"有 msgId 但很旧"；`s2`/`s3-seq` 用的是假 transport。

## 建议（不阻断）

- **S1 [src/app/bridge.js:1135 + src/transport/envelope.js:53] 卡片的"可撤回"仍是从 `labeled` 反推的假事实**：`reversible: label.labeled ? false : undefined`，于是命中白名单/提权的动作一律显示"可撤回：否"。`LabelPolicy` 只产出 `{labeled, reason}`，没有任何字段能推出"可撤回"；arch review 的"新问题 3"采纳的修法正是"不知道就写未判定"。探针 (h)：`git push` 显示"可撤回：否"。改写为 `undefined`（未判定），或在 02 里定义真正的取值来源。
- **S2 [src/app/bridge.js:174-182] 断网恢复的消息承诺了一个不存在的能力**：文案是"要逐条补发请说一声"，但 `parseCommand` 没有"补发"类命令，摘要里也没有任何 id，且 `Delivery` 契约写明"重试未实现"。断网期间丢失的审批因此**无法人工补**（`/progress` 只给计数、`/list` 只列会话），只能重启作废。建议：摘要带上未送达卡片的 `wp id + 工具名`（不重放也能手工处理），或删掉"说一声"这句。
- **S3 [src/app/bridge.js:450-464] 重建留下的第二份文本答复实现是死代码**：`answerWithText()` 全仓无调用点（`answerText` 走的是 `resolveAnswer`），两份实现并存，改一份另一份会静默过期。同类痕迹还有：`probeServices`（:125/:136 存了从不读）、`NOT_YET = {}` 空兜底表（:322-325）、未使用的 `approvalEvent/questionEvent` 导入（:13）、生产路径不用的 `looksLikeCommand`（:109）、只写不读的 `lastMsgAt`（见 B9）。建议删或接上，别留"看起来还有一条路径"的假象。
- **S4 [src/app/bridge.js:403-406] 被标注请求的 `/ans <id> 2` 也被拒**：矩阵（02:34）写的是"被标注审批：回 2 → 拒绝"，实现把 `option` 一律拒掉并回"只认 /yes"。实际影响小（卡片提示的是 `/no`），但与冻结矩阵不一致。
- **S5 [src/app/bridge.js:587-647] `/why` 成功路径没有任何即时回话**：`ask()` 只在出错时 `send`，问题投进去后手机端静默，要等那一轮 `turn/end` 才回一条。A18/A19 是 ≤10s/≤60s 的人类可感时延，建议先回"已起咨询（会话 xx，第 N 轮），查完给你"。
- **S6 [src/transport/envelope.js:27-42] 提问卡片缺 QqEnvelope 要求的字段**：02:27 写"卡片必含 id、可撤回性、`/why` 提示"，`renderQuestionCard` 只有 id 与选项，没有可撤回性、没有 `/why`。另外 A1 要求卡片含"影响范围"，`renderCard` 只在 `outside-workspace` 时才输出这一行（:52），工作区内审批的卡片缺这个字段。建议要么补字段（"影响范围：工作区内/未判定"），要么在 02 里把这两条要求收窄。
- **S7 [test/s13-hidden.mjs:23] 假绿（A36 没有被验证）**：`check(!sent.at(-1).includes('consult-1'), '咨询会话不出现在 /list（A36）')`。但 `sessionsRoot` 里从头到尾只写了 `sess-user1` 一个会话目录（:6-7），`listStoredSessions` 读的是盘，`consult-1` 根本不在盘上——**把 `listSessions` 里的 `hidden` 过滤整段删掉，这条断言照样绿**。要真验 A36，得把 `consult-1` 的会话目录写进 `sessionsRoot`。
- **S8 [test/s21-degrade.mjs:30-33] 假绿（A27a 的审计断言没写）**：注释说"审计记 evidenceMissing"，实际是 `const ap = '…' // 占位`、`const entries = sent.length`、`check(entries > 0, '仍然可以批准（不阻拦）')`。`entries > 0` 因为卡片本身发过而恒真；审计文件从未被读。把 `audit.append` 里的 `evidenceMissing` 删掉，这条仍绿。
- **S9 [test/s8-audit.test.mjs:47] 假绿（A26 的 evidenceViewed 只验存在）**：`all.every((e) => 'evidenceViewed' in e)`——三个产物点都写死 `false` 也能过。应断言成对的行为："做过 `/why` 再批 → `evidenceViewed === true`"，"没做 → `false`"。
- **S10 [test/s39-guarantees.mjs:20-61、test/s33-prompts.mjs:17-35] 整个套件是源码 grep，不是行为断言**：例如 `:36 check('GUI 先答会清理待答点', bridge.includes('answered-on-gui'))`、`:38 /handleApproval\(request, \{ next/`、`:54 /\/ans \$\{wp\.id\} 1 发送/`。字面量在、行为坏了（B2/B4/B6）它全绿；`s33:26` 的"无裸数字引导"也只是按行正则过滤。这类断言可以留作"文案/形状的静态检查"，但**不能算验收证据**，台账里"42 套全绿"不应被读成"这些行为已验证"。
- **S11 [docs/build/qq-bridge.md:609-618 与 docs/arch/qq-bridge/01-architecture.md:104-112] 台账记录的 `/doctor` 在代码与 02 里都不存在**：台账写"`/doctor` 已补 02（命令集 + 版本 v3）、01 §8、03 ADR-24"，`tools/audit-docs.mjs:14` 也把它列入命令集并专门豁免解析器不认识它；但 `envelope.js:12-24` 的命令封闭集里没有 `/doctor`，`bridge.js` 也没有实现。要么是重建时丢了（那一整块能力连同文档一起丢），要么是文档回溯时写进了没有落地的东西。建议本轮先据实修正台账与 01 §8（或补实现），否则下一轮会拿"台账说做过"当证据。
- **S12 [src/app/bridge.js:434-446] 并发下同一条入站重复答复时审计与回话会各记一次**：`send('已收到…')` 先于 `points.answer`，且 `points.answer` 的返回值 `res.ok` 只用于日志（:445）。两条几乎同时到达的消息（或手滑双击）都能通过 :334 的 `status !== 'open'` 检查，各发一条"已收到"、各写一条审计；只有一条真正生效。建议把"检查 + 置状态"做成一步原子操作：先同步"占位"（把该 wp 从 `open` 摘掉、但不 resolve），再回"已收到"，最后按占位结果决定是否 `resolve`——这样既保住 `s3-order` 要求的"确认先于 resolve"，也不会让第二条消息冒充成功。

## 我核对过、确认没问题的点

- **D10 / ADR-18（审批不设桥接侧超时）**：生产路径 `lib/index.js:80` 只传 `{ next }`，`bridge.js:1169`/`:1249` 只在显式传了 `timeoutMs` 时才赛跑，`timeoutMs` 未进任何配置默认值；提问接缝同理。这条没有返工痕迹。
- **D21（全命令化）/ 解析失败不推定**：`parseCommand` 对不带 `/` 的文本、`1`、`yes wp-1` 一律返回 `unknown`（envelope.js:81-84），`onEvent:264-273` 只回状态提示、不动状态；命令集是封闭表（:12-24），`/ans` 的"序号 vs 文本"判定（:92-98）与契约一致。
- **A25（五词表）**：两张卡片都返回 `leakedRating`，且 `renderCard`/`renderQuestionCard` 的输出里没有评级措辞；`s2-transport.test.mjs:37` 与 `bb-batch2.mjs:80-82` 断言了 0 命中（`s3-label` 未断言这一条，属覆盖缺口，但不是缺陷）。
- **ADR-21（`msg_id` + `msg_seq`）**：`send()` 按 `msg_id` 记账、逐条递增，满 4 次转主动（bridge.js:1289-1299）；`s3-seq` 覆盖。
- **待答点状态机与重启回填顺序**：`answer()`/`drop()`/`expire()` 都先验 `status === 'open'`（wait-point.js:60-85）；`#loadState` 先把 open 改 `dropped(restart)`、先 `restore()` 再 `#persist()`（bridge.js:199-214），符合 02:38-39 的"回填在首次落盘之前"。
- **`expired` 只来自 DSH 侧**：只有 `request.signal` 的 abort 会调 `points.expire`（:1145-1149、:1225-1229），桥接自己不产生 `expired`；测试超时走 `drop('test-timeout')`。
- **LabelPolicy（标注三判据）**：`classify` 的 reason 是封闭三值、输出只有 `{labeled, reason}`，没有"是否允许"（label.js:16-23）；判据 1/3 的参数按 `callId` 从 `tool/call` 反查（label.js:52-69），符合 ADR-22；卡片按 `labeled` 切换成只认 `/yes`，与 02:34 一致。
- **`/new` 只接受已知工作区**：清单来自 `workspace.json` 的 `tables.workspaces`，只接受序号，自由文本/越界/小数一律拒绝（bridge.js:683-698），`bb-batch2` 的 6 条非法参数用例覆盖；每工作区每日上限默认 10 且可配（lib/index.js:68），计数落盘不过重启清零（:716-717）。
- **短 id 规则**：`shortOf()` = 剥 `session-` 后前 6 位（:17-19），`/list` 行首用同一函数，`/use`/`/wake`/`/progress`/`/why` 都能按前缀命中（`s27` 覆盖已加载会话）。
- **`/say` 的 A23 语义**：先回显"将要发送 + 上次停在"（`lastStop` 从尾部找 `turn/end`），`/ans 1` 才注入、`/ans 2` 取消且 `dropped`（`s5-say` 4 组用例）；未绑定时不注入。
- **咨询通道 D18/D19/A34/A35**：路由键=目标会话 id、同 id 复用同一会话（`consults` Map）、`/done` 与 300s 定时两条结束路径都回话且带"会话 + 共 N 轮"、写操作聚合进审计并在回话里给"改动 N 次 + 路径"（bridge.js:666-680、:870-918）。
- **A5（非白名单）**：`seen` 去重与白名单检查都在任何 `send` 之前（:244-251），非白名单用户得不到任何回显。
- **ADR-20（多问题让位）**：`questions.length !== 1` 直接 `return undefined`，不伪造答案（:1205）。
- **测试基线**：按指定 node 跑除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 外的 42 套，**全绿 0 红**（其中 2 套是必须真机/Electron 的，未在本次范围内）。
