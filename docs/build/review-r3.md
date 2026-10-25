# 评审 · 轮次 3（终局）

审查对象：`src/**`、`lib/index.js`、`test/*.mjs`，对照 `docs/frame/qq-bridge.md`（v7）、
`docs/arch/qq-bridge/02-contracts.md`（v2）、`docs/build/review-r1.md`、`docs/build/review-r2.md`。
HEAD = `91b2732`（`fix(r2): B1/B3/B7/B8/B9 + N1/N4/N5/N6`），工作树干净；四次修复提交为
`ff7485a` / `605c755` / `c04765a` / `91b2732`。

验证方式：逐条读代码 + 单跑全部套件 + 三份一次性探针
（`.tmp/r3-probe.mjs`、`.tmp/r3-probe2.mjs`、`.tmp/r3-probe3.mjs`，只调用现有实现，不改代码）。
下文 `PROBE …` 均为实跑输出，可原样复现。

## 交接结论：不可交接（阻断 6）

这一轮不是"还差一点文案"：第 2 轮的修复把**提问接缝整个打崩了**，而且三处提交说明与代码不符
（B3 声称已修、N4 声称已修、测试声称 42/42，三条都不成立）。审批通道大体可用，
但"提问在 PC 或手机上都答不通"这件事本身就把 A21 与"不必回 PC"的目标一起打掉了。

阻断 6 = **B4（回归，提问接缝必抛错）**、**N1（提问侧不落盘/无审计）**、**B3（卡片 `/why` 仍是死命令）**、
**N2（两边都答审计不守恒）**、**N3（测试 40/42，声明 42/42）**、**B1（跨重启撞键，原症状可复现）**。

## 核销总表

### 第 1 轮 9 条

| 轮次 | 条 | 结论 | 依据 |
|---|---|---|---|
| R1 | B1 推送去重键 | **部分关闭** | 同进程内已不再撞桶：连发 4 个无 `callId` 审批 → `PROBE G.B1.fourNoCallId.cards = 4`、`points = 4`、`keys = ["auto-1","auto-2","auto-3","auto-4"]`。但键仍不是契约的 `request.callId ?? wp.id`（02:25）：`deliverySeq` 只是内存计数（`bridge.js:1138`），`deliveries` 却落盘（`#persist` :218）。重启后计数归零、键从 `auto-1` 重新开始，与盘上的 `auto-1` 相撞 → 预置 `deliveries={"auto-1":[t,t,t]}` 再发一个无 `callId` 审批：`PROBE G.B1.afterRestartCollision.result = \"unavailable\"`、`cards = 0`——**连卡片都不发**，与 R1 那条的症状一模一样（触发条件：24h 内 3 次重启，每次各来 1 个无 `callId` 审批）。修法：`points.create()` 之后再算键（`callId ?? wp.id`），而不是预测一个不落盘的序号。 |
| R1 | B2 GUI 兜底 `unavailable` | **已关闭** | `next()` 回 `'unavailable'` 时待答点仍 `open`、不发"已在电脑端处理"，随后手机 `/yes` 得 `allowed`（`PROBE M.B2.openAfterGuiUnavailable = open`、`guiAnsweredMsg = 0`、`outcomeAfterQqYes = allowed`）。判据仍是 `typeof === 'string'`（:1204），属 R2 已记录的非阻断残留。 |
| R1 | B3 卡片 `/why` 指向 | **未关闭** | 修法只做了一半：`whyTarget` 写进了 `meta`（:1162，探针 `A.B3.whyTargetInMeta = aaaa11`），但**渲染卡片时没传**（`bridge.js:1168-1179` 那个对象字面量没有 `whyTarget`），于是 `envelope.js:64/66/67` 的 `wp.whyTarget ?? id` 全部回落成 `wp-N`。实跑卡片：`PROBE A.B3.cardHintLine = 改：/ans wp-1 1 批准 ｜ /ans wp-1 2 拒绝 ｜ /why wp-1 看现场`；照着这条提示发：`PROBE A.B3.followCardHintReply = 找不到 wp-1 这个会话，发 /list 看序号或短 id。`、`consultsAfterHint = []`。同一张卡片如果真把 `whyTarget` 传进去就正确：`A.B3.renderCardWithWhyTarget = … /why aaaa11 …`。另：`test/bb-batch2.mjs:77` 把 `/why wp-7` 写成期望，**测试把缺陷固化成了规格**，修 B3 时必须同步改这条断言。 |
| R1 | B4 提问双通道 | **未关闭（回归）** | `bridge.js:1298` 是 `const guiAnswers`，`:1303` 又给它赋值 → 只要走双通道分支就 `TypeError: Assignment to constant variable`。而 `lib/index.js:103` **总是**传 `{ next }`，所以生产上**每一个单问题请求都抛错，不管谁先答**：<br>· GUI 先答：`PROBE B.B4.guiFirstQuestion.threw = TypeError: Assignment to constant variable.`，接缝无返回值、待答点仍 `open`、审计 0 条、手机只收到卡片。<br>· QQ 先答（GUI 永不回，最普通的一条路径）：`PROBE K.qqFirstQuestion.seamError = TypeError: …`，待答点 `resolved`、审计 1 条、**接缝仍抛错**——手机上那句答复进了审计却进不了 agent。<br>· 对照组（不传 `next`，正是全部测试的调用方式）：`PROBE P2.questionWithoutNext.seamReturn = {"answers":[{"id":"q1","selected":["A"]}]}` 正常。所以 R1 的"桌面答了仍等手机"不但没修，还变成了"谁答都炸"。这里只有两种可能，两种都不通过：`next` 是函数 → 必崩；`next` 不是函数 → 双通道根本没接上，B4 的原缺陷原样留着。修法：`let guiAnswers` 后重新赋值即可，并补一条**带 `next`** 的提问用例。 |
| R1 | B5 `/say` 显式 id | **已关闭** | 未绑定 + 目标在盘未加载：`PROBE N.B5.unboundExplicitUnloaded.reply = aaaa11 没加载：先 /wake…`、0 个 say 待答点；绑定 B、目标 A 未加载：同样回"先 /wake"，`sayPoints = []`（没有发到 B）。R1 的 d1/d2 两个后果都不再出现。 |
| R1 | B6 提问拒 `/yes` | **已关闭** | `PROBE J.B6.questionYesReply = 这是提问，不是审批：请用 /ans wp-12 …`、`statusAfterYes = open`、`auditAfterYes = 0`。契约矩阵的"—"在代码里成立了。 |
| R1 | B7 审计字段 | **已关闭** | `requestId` 在有 `callId` 时记真值（`PROBE H.B7.afterWhy.requestId = c-h1`），`wpId` 不再被丢弃（`audit.js:20-30`、`H.B7.afterWhy.wpId = wp-10`），`evidenceViewed` 有了真来源：`/why` 命中会话时给该会话的 open 待答点打标（`bridge.js:613-621`），先 `/why aaaa11` 再 `/yes` → `PROBE H.B7.afterWhy.evidenceViewed = true`；不 `/why` 直接 `/no` → `PROBE H.B7.withoutWhy.evidenceViewed = false`。残留（非阻断）：字段名仍是驼峰，frame A27a/A27b 写的是 `evidence_missing` / `evidence_viewed`；且用户能走到的入口只有 `/progress` 提示的短 id——卡片上那条 `/why` 因 B3 仍是死的。 |
| R1 | B8 序号过滤 | **已关闭** | 造一个"咨询会话 mtime 更新"的会话库（`session-consult99` 比 `session-aaaa1111` 新）并把它写进 `state.consults`：`/list` 首行 = `1) aaaa11 …`（`PROBE I.B8.listFirstRow`）、`/use 1` → `已绑定 aaaa11`（`I.B8.use1Reply`）、`/wake 1` → `aaaa11 已经加载着`（`I.B8.wake1Reply`）。R2 点名的两条读路径（`useSession:818-819`、`wakeSession:768-769`）现在与 `listSessions` 同源。 |
| R1 | B9 被动窗口 | **已关闭** | 窗口锚点改到"被回复的那条 `msg_id`"（`bridge.js:1367`，`msgAt` 表 :255-256）：70 分钟前的 `m1` → `PROBE F.B9.oldMsgId = ["proactive:-"]`；窗口内的 `m2` → `F.B9.freshMsgId = ["passive:seq=2"]`（正常回复没退化）；`sendPassive` 被平台拒 → `F.B9.passiveThrows = {"result":"a","attempts":["passive","proactive"]}`（真的转主动兜底了）。残留见 §剩余风险 1。 |

### 第 2 轮 8 条

| 轮次 | 条 | 结论 | 依据 |
|---|---|---|---|
| R2 | B1（未关闭） | **部分关闭** | 见上表 R1-B1：同进程 4/4 通过，跨重启仍会撞出 `unavailable`（`PROBE G.B1.afterRestartCollision.*`）。契约 `Delivery` 的键仍不是 `callId ?? wp.id`。 |
| R2 | B3（部分关闭） | **仍未关闭** | 同上：路由已不会误开会话（`wp-N` → `null`，`bridge.js:580`），但卡片提示照旧指向 `wp-N`，用户被指到一条必错的命令（`PROBE A.B3.cardHintLine` / `followCardHintReply`）。 |
| R2 | B7（部分关闭） | **已关闭** | `requestId` / `wpId` / `evidenceViewed` 三项都有真来源（`PROBE H.B7.*`）。 |
| R2 | B8（部分关闭） | **已关闭** | `/list` `/use` `/wake` `/progress` 序号同源（`PROBE I.B8.*`）。 |
| R2 | B9（部分关闭） | **已关闭** | 锚点与失败兜底都落地（`PROBE F.B9.*`）。 |
| R2 | N1 GUI 先答无审计不落盘 | **部分关闭（提问侧仍缺）** | 审批侧已修：GUI 先答 → 1 条 `{"via":"gui","outcome":"rejected"}`、磁盘 `wp-2:dropped`、重启 `interruption = null`（`PROBE L.N1.guiFirstApproval.*`）。提问侧仍不对：`bridge.js:1304-1318` 里 `drop()` 之后**没有 `#persist()`**（审批侧 :1208 有），而且整段现在先被 B4 的 `TypeError` 打断——即使只修崩溃，GUI 答过的提问仍会以 `open` 落盘，下次启动照旧误报"有 1 个待答请求已作废"。 |
| R2 | N2 两边都答审计不守恒 | **未关闭** | 审批：QQ 的回执先 `send`、再 `points.answer`、再**无条件** `audit.append`（:442-454），不看 `res.ok`。卡住手机回执后让 GUI 答 `rejected`：接缝返回 `rejected`、待答点 `dropped`，审计却是 **2 条**——`PROBE C.N2.bothApproval.audits = [{"outcome":"{\"via\":\"gui\",\"outcome\":\"rejected\"}"},{"outcome":"{\"text\":\"yes\",\"by\":\"u1\"}"}]`，第二条是**被丢弃的那一票**。提问：GUI 票因 B4 崩溃根本没记（`PROBE D.N2.bothQuestion.auditCount = 1`，`audits = [{"selected":["A"],"by":"u1"}]`，GUI 的 B 不翼而飞），接缝抛 `TypeError`。修法：`res.ok` 为假就不写审计；GUI 胜出时用 `drop()` 的返回值判断是否真的结算。 |
| R2 | N3 测试红 | **未关闭** | 实跑 **40/42**（详见下节），`bb-batch3`、`bb-batch5` 仍是红的，而 `91b2732` 的提交说明最后一行仍写"测试 42/42"（`ff7485a` 也写过一次）。两条红都不是产品缺陷、是断言没跟着 R1 的改动走：<br>· `bb-batch3.mjs:73-75` 拿 `wp-1/wp-2` 比对 `audit.requestId`，而那里现在按 B7 的要求是 `callId`（`P1/P2`）；`wpId` 已经落盘，断言改用 `e.wpId` 即可。<br>· `bb-batch5.mjs:132-136` 断言 `/say session-hhhh7777 hi-A`（`boundAgent=null`）要被拒，而 B5/D20 之后它正确地进了确认卡片（实测 `[wp-4] 将要发送：hi-A`）。 |

### 提交说明里另外三条自述（不在 8 条内，但决定了本轮结论）

| 条 | 结论 | 依据 |
|---|---|---|
| N5 `Audit.append` 丢 `wpId` | **已关闭** | `audit.js:20-30` 增加 `wpId` 字段；探针里 `wpId = "wp-10"` 落盘。 |
| N6 空 `answers` 不算已答 | **未关闭（改法引入了本轮最大的洞）** | 本意对（`Array.isArray && length > 0`），但写成 `const guiAnswers` 后又赋值（`bridge.js:1298`、`:1303`）→ 只要传了 `next` 就抛错，空答案与正常答案一起废。见 B4。 |
| N4 abort 后双调 `next` | **未关闭** | 语义没变：`answered === undefined ? next() : answered`（`lib/index.js:105`）与 `??` 等价，而 `handleQuestion` 在 `expired` 时仍 `return undefined`（`bridge.js:1333`）→ 外层再调一次。探针里 `next` 共被调用 **2 次**（`PROBE E.N4.nextCallsInsideHandle = 1`、`totalNextCalls = 2`）。当前这条路径被 B4 的崩溃挡在前面，修 B4 时必须一起修，否则会立刻复活。 |

## 实际测试基线

用任务指定的 `C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`，
逐个单跑 `test\*.mjs`（排除 `s1-waterfall.test.mjs`、`s3-loop.mjs`，共 **42** 套）：

```
TOTAL=42  GREEN=40  RED=2
断言级：PASS=357  FAIL=2
RED：test\bb-batch3.mjs  → FAIL BB-52「审计里两个 id 各一条」（实得 requestId = P2,P1）
     test\bb-batch5.mjs  → FAIL BB-70「2/2 都是拒绝」（实得 [wp-4] 将要发送：hi-A）
```

**"42/42"不可复现，实际 40/42**，且这个数字与 R2 实测完全一致——本轮提交没有再碰 `test/`（`git show --stat 91b2732` 只有 `docs/`、`lib/index.js`、`src/`）。两条红的性质见 N3：断言过期，不是产品缺陷；但提交信息与基线不一致这件事本身就是交接门禁要挡的（台账会被"42/42"污染）。

另需记一笔：**42 套全绿也证不了提问通道**。全部套件里没有一处给 `handleQuestion` 传 `next`（`grep handleQuestion\( test/` 只有 `s5-question` 的 4 处，都不带 `next`），所以 B4 那个"生产必崩、测试全绿"的分裂能一直存在。

## 审计守恒（三问之二）

同一请求是否**恰好一条**审计、内容是否对应**真正生效**的那一票：

| 时序 | 接缝返回 | 待答点 | 审计 | 结论 |
|---|---|---|---|---|
| QQ 先答（审批） | `allowed`（`M`）/ `rejected`（`P4`） | `resolved` | 1 条，`requestId=callId`，内容=手机那票 | **守恒** |
| GUI 先答（审批） | `rejected` | `dropped` 且落盘 | 1 条 `via: gui`（`L`） | **守恒**（N1 审批侧已修） |
| 两边都答（审批） | `rejected`（GUI） | `dropped` | **2 条**：`via gui` + 被丢弃的 `yes`（`C`） | **不守恒**（N2） |
| 都不答（审批） | 挂起（D10 无超时） | `open` | 0 条（`P1`） | 正确 |
| QQ 先答（提问） | **`TypeError`** | `resolved` | 1 条（`K`） | 接缝崩，票进不了 agent |
| GUI 先答（提问） | **`TypeError`** | `open` | 0 条（`B`） | 崩 + 不落盘 |
| 两边都答（提问） | **`TypeError`** | `resolved` | 1 条（QQ），GUI 票无记录（`D`） | GUI 那一票消失 |
| 都不答（提问） | 挂起 | `open` | 0 条 | — |

审批侧 4 种时序里 3 种守恒，**"两边都答"违反 A26**；提问侧 4 种里 **0 种成立**，因为接缝在结算前就抛错。不满足 A26 的"每次决定都有审计、且能对上真正生效的那一票"。

## 剩余假绿（三问之三）

- **s39 掩盖了真实缺陷（不是"断言不够严"）**：`test/s39-guarantees.mjs` 22 条全是源码 `includes/regex`，标题写着"谁改坏了，这里先红"，但本轮提问通道**整体抛错**时它 22/22 全绿——它只 grep 了审批的 `handleApproval(request, { next`（:38），从来没有一条对应 `handleQuestion` 的双通道。这正是"文献级保证"替代行为验收的样子。**算阻断证据（计入 B4/N3）。**
- **没有套件给 `handleQuestion` 传 `next`**：覆盖洞里直接长出了 B4 的崩溃。修 B4 时必须补一条"GUI 先答 / QQ 先答 / 两边都答"的提问用例。**算阻断证据。**
- `test/bb-batch2.mjs:77`（及 `:85`）：把 `/why wp-7` 当成"卡片有 `/why` 提示"的正例——**反向锁定了 B3 的缺陷**。修 B3 时这条必须改，否则"修好即变红"。**计入 B3 的处置要求。**
- `test/s8-audit.test.mjs:47`：仍是 `all.every((e) => 'evidenceViewed' in e)`，只验字段存在，`requestId` 的值也没验。但 `evidenceViewed` 现在真有来源（探针 H 已验证），**没掩盖缺陷** → 建议：补"做过 `/why` → `true` / 没做 → `false`"成对断言，并把 `requestId === callId`、`wpId` 落盘纳入。
- `test/s13-hidden.mjs:23`：依旧空转（咨询会话从未在 `sessionsRoot` 落成目录，删掉 `hidden` 过滤也绿）。但 B8 已被探针 I 独立验证为真，**没掩盖缺陷** → 建议：把 `consult-1` 真的写成会话目录，并断言 `/use 1` `/wake 1` 也不指它。
- `test/s21-degrade.mjs:30-33`：`const ap = '…' // 占位`、`check(entries > 0)` 原样未动，审计文件从未被读。代码侧 `evidenceMissing` 的取值看起来正确，**没掩盖缺陷** → 建议：读审计断言 `evidenceMissing === true` 且批准不被阻拦。
- `test/s33-prompts.mjs:25-31`：按行正则过滤源码的文案检查，作为"文案静态检查"可以留，**不能算验收证据**；`needsCmd` 为空时自动通过 → 建议降级标注。

## 剩余风险（不阻断）

1. **B9 的最后一格：双通道都失败时仍静默**。`send()` 的兜底只在"被动失败 → 主动"这一跳；主动也失败就 `return null`（`bridge.js:1384-1389`），而卡片调用点 `#queueCard`（:478/:492）从不看返回值 → `handleApproval` 继续 `await wp.promise`，D10 又没有超时，于是 **DSH 挂住、手机什么都没有**。探针：`PROBE F.B9.bothFail = {"result":null,"failedSends":1}`。断网恢复那句"要逐条补发请说一声"仍然没有任何补发实现（R1 S2 未动），摘要里也没有 `wp id + 工具名`。
2. **N4 的双调 `next`** 仍在（见上），修 B4 时一并处理，否则崩溃一修好它立刻复活。
3. **审计保留期没执行**：`Audit.prune` 注释说"由 doctor 或升级时调用"（`audit.js:46`），但全仓没有调用点，也没有 `/doctor` 命令——Q19 的 180 天只增不减不裁剪。
4. **审计字段名与 frame 不齐**：frame A27a/A27b 写 `evidence_missing` / `evidence_viewed`，落盘是驼峰；A26 的"五个字段"里还缺独立的"时间精度/来源"约定（现状用 `at` 毫秒数，够用但不显式）。
5. **待答点 `meta` 落盘被裁剪**（`#persist:220-224` 只留 `toolName/labeled`）：重启后 `callId`、`card`、`sessionId`、`evidenceViewed` 都没了。因为 open 一律改 `dropped(restart)`，不影响结算；但会让"凭审计重建当时"在跨重启场景少掉可对账的 `callId`。
6. **`deliverySeq` 不落盘** 是 B1 的另一半（见阻断清单）。
7. **流程风险**：本轮提交说明与代码有 3 处不符（B3 已修 / N4 已修 / 测试 42/42），下一轮若继续以提交说明为证据，会重复这两轮的错误。

## 复跑方式

```
$node = C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个执行 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）→ 40 通过 / 2 失败
$node .tmp\r3-probe.mjs、.tmp\r3-probe2.mjs、.tmp\r3-probe3.mjs → 见正文 PROBE 行
```

**交回作者时的最小关闭清单（按修复成本排序）**：
1. `bridge.js:1298` `const` → `let`（一行，提问通道立刻恢复）；
2. 提问的 GUI 胜出分支补 `await this.#persist()`（与审批 :1208 对齐）；
3. `renderCard({ … })`（:1168-1179）补 `whyTarget: wp.meta.whyTarget`，并改 `bb-batch2:77/85`；
4. 审计写入以 `points.answer()` 的 `ok` 为条件（:443-454），GUI 胜出以 `drop()` 返回值为条件；
5. 去重键改成 `points.create()` 之后的 `request.callId ?? wp.id`；
6. `next` 的二次调用：`lib/index.js:103-105` 要记住"`next` 已在竞速里被调用过"，`expired` 时不要再调第二次（或把传下去的 `next` 包成幂等）；别只把 `??` 改写成三元——两者等价，N4 没被修；
7. 更新 `bb-batch3:73-75`（用 `wpId`）与 `bb-batch5:132-136`（B5 之后显式 id 应进确认卡片），再补一条带 `next` 的提问用例。

状态：未通过（阻断 6）
