# 评审 · 轮次 7（终局）

审查对象：`src/app/bridge.js`（be4eff4 的 +19/−2）、新增 `test/s43-vote-map.mjs`，对照
`docs/build/review-r6.md`（阻断 1 = N2：`/yes` 在 GUI 胜出分支被映射成 `rejected`，且 s41/s42 在旧代码上全绿）。

HEAD = `be4eff4`（`fix(r6): 票→结局映射漏掉 yes；抽出 outcomeFromVote/decisionFromOther 并加锁`），
评审开始时 `git status --short` 无输出，`src/app/bridge.js` blob = `1bf59b6…`（`git rev-parse be4eff4:src/app/bridge.js` 相同）。

验证方式：逐行读 diff + **自写探针**（`.tmp/r7/probe.mjs` 时序矩阵、`.tmp/r7/regress.mjs` 25 条回归，
均只调用实现、不改仓库）+ **46 套逐套单跑** + **三次换代码实跑**（`89165be` 旧实现、`f3795bc` 上一轮 HEAD、
以及两次针对 `be4eff4` 的定点变异）。下文 `PROBE …` 均为实跑输出。

## 交接结论：可交接（阻断 0）

R6 的唯一阻断点已关闭，且**已用两种独立方式证明**：

1. **映射修复**：`outcomeFromVote(vote)` 把 `批准` / `yes`（以及 `allow`/`allowed`）映射成 `allowed`，
   GUI 胜出但手机票已先结算时走 `decisionFromOther(other)`（= `outcomeFromVote(other.text)`）。
   我自己复跑的 `mt + /yes` 场景：**接缝 `allowed`、审计 1 条、审计票 `{"text":"yes","by":"u1"}`、
   待答点 `resolved`/`yes`，三者一致**；被标注（labeled）审批同一结果。`mt + /ans 1`、`mt + /no` 均正确。
2. **测试锁成立**：`git checkout 89165be -- src/app/bridge.js` 后 s43 **变红（exit 1）**，原因是
   **模块缺少导出**（`TypeError: outcomeFromVote is not a function`，一条断言都没跑）；为排除"只锁住导出名"，
   我又把 `outcomeFromVote` 改回旧映射（导出仍在），s43 **3 条断言失败**（断言级变红）。
   两种都算锁住，且第二种证明它锁的是映射本身。

基线 46 套 / 399 PASS / 0 FAIL；回归面（`/ans 1`、`/no`、`/say`、`/why`、通知、双通道两个方向）无破坏。
唯一需要交接方知道的是 §剩余风险 1：s43 锁住的是**函数**，不是**调用点的接线**（变异调用点为旧内联映射时
s43/s41/s42 仍全绿）——这是我作为终局评审记录的可改进项，不是当前行为的缺陷。

## 映射复验（含 seam 与审计内容）

探针 `.tmp/r7/probe.mjs`：用命名空间导入（旧实现没有新导出也能跑），对照基准是**契约**里的映射而不是实现里的函数；
`mt` 时序 = `next()` 同步返回 `'allowed'`，并在**同一微任务窗口**里投递手机票，使 `Promise.race` 判给 gui
而待答点已被手机票结算 → 真正进入 `drop() === false` 的迟到分支。探针 monkey-patch 了 `points.drop` 统计返回值，
证明每一格走的是哪条分支（`lateDropLost=1` 即迟到分支，`guiDropWon=1` 即 GUI 正常路径）。

### 1）HEAD（be4eff4）实跑

| 场景 | seam 返回 | 待答点 | 审计条数 | 审计内容 | 手机"已收到" / GUI"已在电脑端" | drop 分支 |
|---|---|---|---|---|---|---|
| **mt + `/yes`** | **`allowed`** | `resolved` / `yes` | **1** | **`{"text":"yes","by":"u1"}`** | 1 / **0** | lateDropLost=1 |
| **mt + `/yes`（labeled）** | **`allowed`** | `resolved` / `yes` | **1** | **`{"text":"yes","by":"u1"}`** | 1 / **0** | lateDropLost=1 |
| mt + `/ans <id> 1` | `allowed` | `resolved` / `批准` | 1 | `{"text":"批准","by":"u1"}` | 1 / 0 | lateDropLost=1 |
| mt + `/no` | `rejected` | `resolved` / `拒绝` | 1 | `{"text":"拒绝","by":"u1"}` | 1 / 0 | lateDropLost=1 |
| GUI 单独作答（无手机票） | `allowed` | `dropped` | 1 | `{"via":"gui","outcome":"allowed"}` | 0 / 1 | guiDropWon=1 |
| 手机先答、GUI 迟到 25ms | `allowed` | `resolved` / `yes` | 1 | `{"text":"yes","by":"u1"}` | 1 / 0 | 未进 GUI 分支 |

被标注审批的那一格 `pointLabeled: true`（`classify` → `outside-workspace`），且 labeled 请求仍然**只认 `/yes`**：
另跑一格 `labeled + /ans <id> 1` → 回复"这是不可逆请求，只认 /yes wp-1（或 /no wp-1）"、点保持 `open`、
最终 `seam=unavailable`、**审计 0 条**（未采纳）。

审计行字段未变（8 键），`requestId` 仍优先用 `callId`：

```
PROBE mt-yes audit = {"requestId":"C-mt-yes","wpId":"wp-1","openid":"u1","at":…,
  "card":{…"labeled":false,"reason":null},"evidenceViewed":false,"evidenceMissing":false,
  "outcome":"{\"text\":\"yes\",\"by\":\"u1\"}"}
```

### 2）三个版本的同一格对照（同一探针、同一时序）

| 代码 | `mt + /yes` 的 seam | 待答点 | 审计条数 | 审计内容 | GUI"已在电脑端" |
|---|---|---|---|---|---|
| `89165be`（修 N2 之前） | `allowed` | `resolved`/`yes` | **2** ❌ | `{"text":"yes"}` + `{"via":"gui","outcome":"allowed"}` | **1** ❌ |
| `f3795bc`（R6 判为阻断） | **`rejected`** ❌ | `resolved`/`yes` | 1 ✅ | `{"text":"yes","by":"u1"}` | 0 ✅ |
| `be4eff4`（HEAD） | **`allowed`** ✅ | `resolved`/`yes` | **1** ✅ | `{"text":"yes","by":"u1"}` | **0** ✅ |

即：探针在 `f3795bc` 上 1:1 复现了 R6 报的那一格（`seam=rejected` 而票是 `yes`），在 HEAD 上消失；
同时没有退回 `89165be` 的"2 条审计 + 通知手机已在电脑端"形态。labeled 审批在 `f3795bc` 上同样是 `rejected`，HEAD 上 `allowed`。

## 测试锁（旧代码 / 新代码）

方法：`git checkout 89165be -- src/app/bridge.js`（旧 blob `5d3da3a…`，`git hash-object` 核对），跑 s43；
跑完 `git checkout be4eff4 -- src/app/bridge.js` 还原，工作树 blob 回到 `1bf59b6…` 且与 `git rev-parse be4eff4:src/app/bridge.js`
一致，`git status --short` 为空。另做两次**定点变异**（同一份 HEAD 只改一处），用来判断锁的"成色"。

| 代码 | s43 结果 | 变红原因 |
|---|---|---|
| `be4eff4`（新） | **14 PASS / 0 FAIL，exit 0** | — |
| `89165be`（旧） | **exit 1，0 条断言执行** | **模块缺少导出**：`TypeError: outcomeFromVote is not a function`（s43:16） |
| `be4eff4` + 把 `outcomeFromVote` 改回旧映射（`v === '批准'` 一项） | **exit 1，3 FAIL** | **断言失败**：`yes → allowed`、`手机已 yes → allowed`、`/yes 审计票与结局一致` |
| `be4eff4` + 把正常路径 `:1276` 的内联映射去掉 `'yes'` | **exit 1，2 FAIL** | **断言失败**：`/yes → allowed`、`/yes 审计票与结局一致`（端到端那一格走的就是正常路径） |

结论：**s43 锁住了映射**——旧代码上因缺少导出而红；导出名保留、映射改坏时按断言红；连"正常路径那份内联映射"
也在覆盖范围内（s43 的端到端 `/yes` 用例打的就是它）。

但要说清 s43 **没有**锁住什么（见 §剩余风险 1）：把**调用点**改回旧的内联写法
（`return other?.text === '批准' ? 'allowed' : 'rejected'`，导出函数保持正确），
**s43 14/14 全绿、s41 9/9、s42 9/9 全绿**，而探针立刻复现 `mt + /yes → rejected`。
换句话说，s43 锁的是"函数"，不是"GUI 迟到分支里那行调用"。

## 实际基线

任务指定的 `C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0），
`test\*.mjs` 共 48 个，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 后 **46 套逐套单跑**（每次独立进程，
用 `Start-Process`/逐进程调用并统计 `^PASS`、`^FAIL` 行，同时核对退出码）：

```
TOTAL=46  GREEN=46  RED=0   断言级：PASS=399  FAIL=0
```

逐套（PASS 数）：bb-batch1 12、bb-batch2 12、bb-batch3 11、bb-batch4 3、bb-batch5 23、bb-batch6 4、
s2-transport 35、s3-label 8、s3-order 9、s3-seq 6、s4-state 14、s5-question 12、s5-say 11、s6-label 12、
s8-audit 17、s10-wake 5、s11-new 7、s12-consult 8、s13-hidden 3、s14-notify 7、s15-writes 5、s16-progress 6、
s17-late 7、s18-watchdog 5、s19-goodbye 4、s20-offline 6、s21-degrade 4、s22-noise 4、s23-format 9、
s26-wake-id 3、s27-idcmds 7、s29-wake-resolve 4、s30-say-text 5、s31-copy 18、s32-relay 7、s33-prompts 3、
s34-deliver 6、s35-title 5、s36-workspace 2、s37-qqtitle 3、s38-dual 7、s39-guarantees 22、
s40-question-next 6、s41-audit-conservation 9、s42-race 9、**s43-vote-map 14**。

与 R6 对照：R6 是 45 套 / 385 PASS；本轮 +s43（14 条）= **46 套 / 399 PASS**，逐套数字与 R6 完全一致（s43 之外无变动）。

## 回归

探针 `.tmp/r7/regress.mjs` 共 **25 条断言，全 PASS**（另外 §映射复验 里的两格也属于回归面）：

| 路径 | 结论 | 依据（实跑） |
|---|---|---|
| **`/ans <id> 1`** | 正常 | `seam=allowed`、审计 1 条、审计票 `{"text":"批准","by":"u1"}` |
| **`/no <id>`** | 正常 | `seam=rejected`、审计 1 条 |
| **`/say`** | 正常 | 先回显"将要发送/上次停在"、确认前注入 0 次、`/ans 1` 注入 1 次且文本等于 `userMessage('继续做第二步')`、待答点 `resolved` |
| **`/why`** | 正常 | 问题投进咨询会话（注入 1 次）、建 1 条通道、答话"它在等一次权限确认"回传 QQ、`/done` 带"共 1 轮" |
| **通知** | 正常 | 5 分钟 0 条；10 分钟"没有新输出"1 条；30 分钟"可能卡住"1 条；`turn/end` "它停了"1 条 |
| **双通道 · GUI 先答** | 正常 | `allowed`、审计 1 条 `{"via":"gui","outcome":"allowed"}`、发"已在电脑端处理"、点 `dropped` |
| **双通道 · 手机先答** | 正常 | `allowed`、审计 1 条 `{"text":"yes","by":"u1"}`、**不**发"已在电脑端处理" |
| **被标注审批受理面** | 未变 | labeled 只认 `/yes`/`/no`：`/ans 1` 被明确拒绝、点不结算、审计 0 条 |
| **审计字段** | 未变 | 8 键（`requestId/wpId/openid/at/card/evidenceViewed/evidenceMissing/outcome`） |

## 剩余风险（不阻断）

1. **s43 不锁调用点接线**（本轮唯一实质发现）。把 `bridge.js:1234` 的 `return decisionFromOther(other)`
   改回 `return other?.text === '批准' ? 'allowed' : 'rejected'`（导出函数一字不改）后：
   `s43 14/14 PASS`、`s41 9/9`、`s42 9/9`，而 `mt + /yes` 立刻退回 `seam=rejected`（审计 1 条、
   票 `yes`，与 R6 报的形态完全相同）。建议把探针 `.tmp/r7/probe.mjs` 的 mt 构造搬进 s43，作为第 4 段
   集成用例：`next()` 里 `queueMicrotask(() => inbound(b, '/yes '+wp.id))`，断言
   `seam==='allowed' && audits===1 && JSON.parse(rows[0].outcome).text==='yes'` 且**不发**"已在电脑端处理"。
   当前行为正确，因此不阻断；但"R6 那类回归"目前仍只能靠人看代码发现。
2. **两份映射并存**：迟到路径用 `decisionFromOther → outcomeFromVote`，正常路径 `:1276` 仍是内联的
   `settled.text === '批准' || 'yes' || settled.selected?.[0] === '批准'`（比导出函数多一条 `selected` 判据）。
   本轮两处都被 s43 的两种用例分别覆盖（见 §测试锁），但将来改一处忘另一处仍可能漂移；建议正常路径也走
   `outcomeFromVote`（`selected` 判据需一并考虑）。
3. **提问侧迟到路径仍返回 `{answers: []}`**（`bridge.js:1340`，R6 风险 1 未变）：`drop()` 失败且对方不是
   `resolved`（`expired`/`dropped`）时，上层拿到"空答案对象"而不是 `undefined`，语义上应让位桌面。
   本轮未构造出可观测危害。
4. 新分支早退时仍未移除 `request.signal` 的 abort 监听、也不 `#persist()`（点已由手机票结算并落盘，
   当前无害；清理项）。
5. `outcomeFromVote` 额外接受 `allow`/`allowed`，当前没有任何生产者会产出这两个词（防御性写法，
   与 02 契约的"批准/yes"表述不完全对应；建议在契约或注释里写明）。
6. R5 的非阻断残留未变：提问审计 `requestId` 仍是 `wp-N`（`:1345`）、frame 字段名与落盘驼峰不齐、
   `Delivery` 去重键仍是 `auto-…`、`answerWithText()` 仍是死代码、`/why` 成功时仍无即时回话、
   N4 守卫只认裸 `request.signal`。本轮未引入新问题，也未修这些。

## 复跑方式

```
$node = C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个单跑 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）→ 46/46 绿，399 PASS / 0 FAIL
$node .tmp\r7\probe.mjs   → mtYes / mtLabeledYes / mtAns1 / mtNo / guiOnly / phoneFirstYes
$node .tmp\r7\regress.mjs → /ans 1 / /no / /say / /why / 通知 / 双通道（25 条）
git checkout 89165be -- src/app/bridge.js && $node test\s43-vote-map.mjs   # exit 1，缺导出
git checkout be4eff4 -- src/app/bridge.js                                  # 还原；blob 应为 1bf59b6…
```

状态：可交接（2026-10-25）

---

## 更正（2026-10-25，由 R8 指出）

上文把 labeled 那格写成 `classify → outside-workspace`。实测带 `sandbox_permissions` 的参数返回
`{ labeled: true, reason: 'escalation' }`（`label.js` 第一条分支先判 `sandbox_permissions`）。
结论（labeled 只认 `/yes`）不受影响，此处仅更正归因，避免后来者误读。
