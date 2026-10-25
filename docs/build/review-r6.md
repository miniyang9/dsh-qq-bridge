# 评审 · 轮次 6（终局）

审查对象：`src/**`、`lib/index.js`、`test/*.mjs`，对照 `docs/frame/qq-bridge.md`（A26 :219）、
`docs/arch/qq-bridge/02-contracts.md`（`WaitPoint` :23、`Delivery` :25）、`docs/build/review-r5.md`。

HEAD = `f3795bc`（`fix(r5): N2 GUI 分支尊重 drop 返回值 + s42 竞态覆盖`），评审开始时 `git status --short` 无输出。
本轮改动面 = `src/app/bridge.js`（+14/-2，两处 `drop()` 返回值判断）、新增 `test/s42-race.mjs`（9 条断言）。

验证方式：逐行读改动 + **45 套逐套单跑**（HEAD）+ **字节级换回 `89165be`** 跑 s41/s42（`git checkout
89165be -- src/app/bridge.js`，旧 blob `5d3da3a…`；跑完 `git checkout f3795bc --` 还原，工作树 blob 回到
`815cfbe…`，`git status` 干净）+ 三份自写探针
（`.tmp/r6-probe2.mjs` 时序矩阵与 80/60 次压力、`.tmp/r6-labeled.mjs` 被标注审批、`.tmp/r6-regress.mjs`
回归），探针只调用实现、不改仓库。下文 `PROBE …` 均为实跑输出。

## 交接结论：不可交接（阻断 1）

N2 只关掉了"审计条数"这一半，**"按已生效的结局返回"没有关掉**：

1. GUI 胜出、手机票已先结算时，`bridge.js:1218` 只把 `text === '批准'` 映射成 `allowed`，其余一律
   `rejected`。但审批的手机票有两张合法"批准"面孔：`/ans <id> 1`（`text='批准'`）和 `/yes <id>`
   （`text='yes'`，且**被标注/不可逆请求只认 `/yes`**）。后者走新分支就变成"票是批准、接缝回拒绝"。
   自写探针 **80/80** 复现（`S.mt.yes.wrongOutcome=80`），被标注审批同样复现
   （`LABELED.mt.yes = {labeled:true, seamOutcome:"rejected", pointAnswer:"yes", audits:1}`）。
2. **s42 不是锁**：把 `bridge.js` 整份换回 `89165be`，**s41 9/9、s42 9/9 全绿、0 条红**。
   s42 的两个"同时作答"用例实际都是手机票先赢（用例自己的输出就是 `已收到=1 已在电脑端=0`），
   根本没进 GUI 分支；第三段"反向竞态"在旧代码上本来就过。作者在文件头写的
   "这条用例在 89165be 应当变红"与实际相反。

阻断 1 = **N2（`/yes` 时接缝结局与已生效票相反；且 s41/s42 在旧代码上全绿，修复仍无测试锁）**。
N3 基线继续成立（45 套 / 385 PASS / 0 FAIL）；回归面无新增破坏（见 §回归）。

## N2 复验（含审计条数）

### 1）时序矩阵（HEAD 实跑，`r6-probe2.mjs`）

审批侧：GUI 票 = `allowed`，手机票见场景名；`mt` = GUI 已解析后手机票**晚一个微任务**到达。
"审计内容"是落盘 `outcome` 的原样 JSON。

| 场景 | 接缝返回 | 待答点 | 审计条数 | 审计内容 | 手机"已收到" / GUI"已在电脑端" |
|---|---|---|---|---|---|
| GUI 先答、手机不答 | `allowed` | `dropped` | 1 | `{"via":"gui","outcome":"allowed"}` | 0 / 1 |
| QQ 先答（`/yes`） | `allowed` | `resolved` / `yes` | 1 | `{"text":"yes","by":"u1"}` | 1 / 0 |
| **mt + `/no`** | `rejected` | `resolved` / `拒绝` | **1** | `{"text":"拒绝","by":"u1"}` | 1 / 0 |
| **mt + `/yes`** | **`rejected` ❌** | `resolved` / `yes` | **1** | `{"text":"yes","by":"u1"}` | 1 / 0 |
| mt + `/ans 1` | `allowed` | `resolved` / `批准` | 1 | `{"text":"批准","by":"u1"}` | 1 / 0 |
| sync + `/no` | `rejected` | `resolved` / `拒绝` | 1 | `{"text":"拒绝","by":"u1"}` | 1 / 0 |
| sync + `/yes` | `allowed` | `resolved` / `yes` | 1 | `{"text":"yes","by":"u1"}` | 1 / 0 |
| 反向（手机先、GUI 后） | `allowed` | `resolved` / `yes` | 1 | `{"text":"yes","by":"u1"}` | 1 / 0 |
| 都不答（60ms 测试超时） | `unavailable` | `dropped` | **0** | — | 0 / 0 |

提问侧（GUI 选 B，手机 `/ans 1` 选 A；`mt` 同理）：

| 场景 | 接缝返回 | 待答点 | 审计条数 | 审计内容 |
|---|---|---|---|---|
| GUI 先答、手机不答 | `{answers:[{selected:["B"]}]}` | `dropped` | 1 | `{"via":"gui","answers":[…B]}` |
| QQ 先答（`/ans 1`） | `{answers:[{selected:["A"]}]}` | `resolved` | 1 | `{"selected":["A"],"by":"u1"}` |
| **mt + `/ans 1`** | `{answers:[{selected:["A"]}]}` | `resolved` | **1** | `{"selected":["A"],"by":"u1"}` |
| **mt + `/ans 2`**（GUI=A，手机=B） | `{answers:[{selected:["B"]}]}` | `resolved` | **1** | `{"selected":["B"],"by":"u1"}` |
| sync + `/ans 1` | `{answers:[{selected:["A"]}]}` | `resolved` | 1 | `{"selected":["A"],"by":"u1"}` |
| 反向（手机先、GUI 后） | `{answers:[{selected:["A"]}]}` | `resolved` | 1 | `{"selected":["A"],"by":"u1"}` |
| 都不答（60ms 测试超时） | `undefined`（让位桌面） | `dropped` | **0** | — |

结论：

- **审计条数、两条回执互斥、提问侧结局这几项都对了**：mt 时序下 1 条审计、只发手机那条"已收到"、
  不发"已在电脑端处理"；提问侧返回的 `selected` 就是生效票。
- **审批侧 `/yes` 这一格不对**：审计与待答点都记着"批准"，接缝却回 `rejected`。这正是 N2 要求
  "按已生效的结局返回"的反例。

### 2）R5 的 `1.mt.distinct` 复跑（同一构造：GUI=`allowed` 先解析、手机 `/no` 晚一个微任务）

```
PROBE A.mt.no = {"seamOutcome":"rejected","pointStatus":"resolved","pointAnswer":"拒绝",
  "audits":1,"auditContents":[{"text":"拒绝","by":"u1"}],"acks":1,"guiNotice":0}
```

即：**审计 1 条，内容 = 手机那票 `{"text":"拒绝","by":"u1"}`；无 GUI 审计、无"已在电脑端处理"、
接缝返回 `rejected` 与待答点一致** —— R5 报的 `1.mt.distinct`（2 条、`allowed` vs `拒绝` 自相矛盾）
在这一格已消失。对照换回 `89165be` 的同一探针：

```
PROBE A.mt.no = {"seamOutcome":"allowed","pointStatus":"resolved","pointAnswer":"拒绝",
  "audits":2,"auditContents":[{"text":"拒绝","by":"u1"},{"via":"gui","outcome":"allowed"}],
  "acks":1,"guiNotice":1}
PROBE S.mt.no = {"n":80,"audits1":0,"audits2":80,...}      ← 旧代码 80/80 落 2 条
PROBE Q.mt.ans1 = {…,"audits":2,"outcomes":[…A…, …via:gui B…]}
PROBE S.q.mt = {"n":60,"audits1":0,"audits2":60,...}       ← 旧代码 60/60 落 2 条
```

### 3）阻断点：mt + `/yes`（HEAD，80/80 + 被标注审批）

```
PROBE A.mt.yes = {"seamOutcome":"rejected","pointStatus":"resolved","pointAnswer":"yes",
  "audits":1,"auditContents":[{"text":"yes","by":"u1"}],"acks":1,"guiNotice":0}
PROBE S.mt.yes = {"phoneCmd":"/yes","n":80,"audits1":80,"audits2":0,"wrongOutcome":80,"contradict":80}
PROBE LABELED.mt.yes = {"labeled":true,"seamOutcome":"rejected","pointStatus":"resolved",
  "pointAnswer":"yes","audits":1,"auditContents":[{"text":"yes","by":"u1"}],"guiNotice":0}
```

同一格旧代码是 `seamOutcome:"allowed"`、2 条审计（`{"text":"yes"}` + `{"via":"gui","outcome":"allowed"}`）。
本轮把"2 条审计"改成了"1 条审计 + 错误结局"：审计守恒了，但**接缝与生效票相反**，而且 `/yes`
是被标注/不可逆请求唯一受理的批准形式。修法只需把 `:1218` 的映射与正常路径对齐
（`text === '批准' || text === 'yes'`，或直接复用一个映射函数）。

### 4）反向竞态与"都不答"

- 反向（手机先 `/yes`、GUI 20ms 后才 resolve）：`audits=1`、`seamOutcome=allowed`、无"已在电脑端处理"。
- 都不答（`timeoutMs=60`）：审批 `unavailable`、`audits=0`；提问 `undefined`、`audits=0`。
- 提问侧反向（手机先 `/ans 1`、GUI 后答）：`audits=1`、返回 `selected:["A"]`。

## 测试锁验证（旧代码/新代码）

方法：`git checkout 89165be -- src/app/bridge.js`（旧实现，blob `5d3da3a…`；
`git diff 89165be -- src/app/bridge.js` 为 0 行），分别跑 s41、s42；再 `git checkout f3795bc --
src/app/bridge.js` 还原，工作树 blob `815cfbe49da2744f145282257423b665f6de12da` 与
`git rev-parse f3795bc:src/app/bridge.js` 相同，`git status --short` 为空（只余本文档的 `??`）。

| 代码 | s41 | s42 |
|---|---|---|
| `89165be`（修 N2 之前） | **9 PASS / 0 FAIL，exit 0** | **9 PASS / 0 FAIL，exit 0** |
| `f3795bc`（HEAD） | 9 PASS / 0 FAIL，exit 0 | 9 PASS / 0 FAIL，exit 0 |

**结论：未锁住。** 两种代码都绿，s41/s42 都区分不了旧实现；作者在 s42 头注释里写的
"这条用例在 89165be 应当变红"不成立。

为什么 s42 锁不住：

- 用例 1/2 的 GUI 答复是 `next: () => new Promise(r => queueMicrotask(() => r(...)))`，而测试在
  `await Promise.resolve()` 之后就同步 `await inbound(...)`。`next()` 是在一个微任务里被调用的，
  它的 `queueMicrotask` 排在手机票的微任务**之后** → `Promise.race` 由 qq 先结算，走的是正常
  手机票路径，**GUI 分支一次都没进**。用例自己打印的明细就是证据：
  `已收到=1 已在电脑端=0`（若 GUI 胜出，旧代码会写 `已在电脑端=1` 且落 2 条审计）。
- 用例 3"反向竞态"是手机先结算、GUI 后 resolve；旧代码在这个路径上本来就只写 1 条，
  它锁的是 R5 早已通过的那一格，不是被修的那两行。
- 三条用例都只断言 `rows.length` 与回执，不断言 `rows[0].outcome` 与接缝返回值是否一致；
  即使条数对，"审计记录批准、接缝返回拒绝"也照样绿（本轮 `/yes` 反例正是这种情况）。

对照：把**同一构造**换成"GUI 先 resolve、手机票微任务到达"（`.tmp/r6-probe2.mjs` 的 `mt` 模式），
旧代码 80/80 落 2 条、新代码 80/80 落 1 条——说明这个竞态是可测的，只是 s42 的时序没打到它。

## 实际基线

用任务指定的 `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`
（v24.21.0），`test\*.mjs` 共 47 个，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 后 **45 套**逐套单跑
（每次独立进程；`spawnSync` 的管道在本沙箱不可用，改用 PowerShell 逐进程调用并统计 `^PASS/^FAIL`）：

```
TOTAL=45  GREEN=45  RED=0
断言级：PASS=385  FAIL=0
```

逐套（PASS 数）：bb-batch1 12、bb-batch2 12、bb-batch3 11、bb-batch4 3、bb-batch5 23、bb-batch6 4、
s2-transport 35、s3-label 8、s3-order 9、s3-seq 6、s4-state 14、s5-question 12、s5-say 11、s6-label 12、
s8-audit 17、s10-wake 5、s11-new 7、s12-consult 8、s13-hidden 3、s14-notify 7、s15-writes 5、s16-progress 6、
s17-late 7、s18-watchdog 5、s19-goodbye 4、s20-offline 6、s21-degrade 4、s22-noise 4、s23-format 9、
s26-wake-id 3、s27-idcmds 7、s29-wake-resolve 4、s30-say-text 5、s31-copy 18、s32-relay 7、s33-prompts 3、
s34-deliver 6、s35-title 5、s36-workspace 2、s37-qqtitle 3、s38-dual 7、s39-guarantees 22、
s40-question-next 6、s41-audit-conservation 9、**s42-race 9**。

与 R5 对照：R5 是 44 套 / 376 PASS；本轮 +s42（9 条）= 45 套 / 385 PASS。
**注意：这 385 条里有 9 条来自 s42，而 s42 在旧代码上同样全绿，不能当作 N2 的证据。**

## 回归

| 路径 | 结论 | 依据 |
|---|---|---|
| **QQ 先答** | 正常 | `PROBE A.qqFirst = {"seamOutcome":"allowed","audits":1,"acks":1,"guiNotice":0}`；`/yes` 的审计内容 `{"text":"yes","by":"u1"}`；s41 的 QQ 段绿 |
| **GUI 先答正常路径** | 正常 | `PROBE A.guiFirstNormal = {"seamOutcome":"allowed","pointStatus":"dropped","audits":1,"auditContents":[{"via":"gui","outcome":"allowed"}],"guiNotice":1}`；提问侧同形；s38-dual 7/7 |
| **`/say`** | 正常 | 回归探针：先回显"将要发送/上次停在"、确认前 0 注入、`/ans 1` 注入 1 次且文本正确、`/ans 2` 不注入；s5-say 11/11、s30 5/5、s31 18/18、s32 7/7 |
| **`/why`** | 正常 | 问题投进咨询会话、答话回传 QQ（"它在等一次权限确认"）、`/done` 带"共 1 轮"；s12-consult 8/8 |
| **通知** | 正常 | 回归探针：10 分钟"没有新输出"、30 分钟"可能卡住"、`turn/end` "它停了" 各 1 条；s14-notify 7/7 |
| **提问 QQ 先答 / GUI 先答** | 正常 | 见 §N2 表；s40 6/6、s5-question 12/12 |
| **审计字段** | 未变 | 8 键（`requestId/wpId/openid/at/card/evidenceViewed/evidenceMissing/outcome`）；s8-audit 17/17 |

本轮改动只在 `handleApproval` / `handleQuestion` 的 GUI 胜出分支，回归面没有新增破坏。

## 剩余风险（不阻断）

1. **提问侧 `drop()` 失败且点不是 `resolved` 时返回 `{answers: []}`**（`bridge.js:1325`）。
   若点是 `expired`（DSH 中止）或 `dropped`（测试超时），`lib/index.js:103-106` 拿到的是
   "空答案对象"而不是 `undefined`，上层可能当成"桌面答了但没选"。本轮未构造出可观测危害，
   但语义上应返回 `undefined` 让位桌面（或 `next()`）。
2. **s42 不校验审计内容/接缝一致性**，且两个"同时作答"用例时序没打到 GUI 分支；建议改成
   "先 `resolveGui(...)` 再 `Promise.resolve().then(() => inbound(...))`"，并断言
   `audits===1`、`outcome` 与 `rows[0].outcome` 指向同一票（覆盖 `/yes` 与 `/ans 1` 两种批准形态）。
3. 新分支早退时没有移除 `request.signal` 的 abort 监听、也没有 `#persist()`（点已由另一端
   结算并落盘，当前无害；属于清理项）。
4. R5 的非阻断残留未变：提问审计 `requestId` 仍是 `wp-N`（`:1330`）、frame 字段名与落盘驼峰不齐、
   `Delivery` 去重键仍是 `auto-…`、`answerWithText()` 仍是死代码且保留旧语义、
   `/why` 成功时仍无即时回话、N4 守卫只认裸 `request.signal`。本轮未引入新问题，也未修这些。

## 复跑方式

```
$node = C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个单跑 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）→ 45/45 绿，385 PASS / 0 FAIL
$node .tmp\r6-probe2.mjs   → A.* / Q.* / S.mt.no / S.mt.yes / S.q.mt（本轮时序矩阵与压力）
$node .tmp\r6-labeled.mjs  → LABELED.mt.yes
$node .tmp\r6-regress.mjs  → /say / /why / 通知 / 两条正常路径
git checkout 89165be -- src/app/bridge.js && $node test\s41-audit-conservation.mjs && $node test\s42-race.mjs
git checkout f3795bc -- src/app/bridge.js   # 还原；hash 应为 815cfbe…
```

状态：未通过（阻断 1）
