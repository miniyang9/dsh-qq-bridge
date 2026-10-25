# 评审 · 轮次 8（复核）

复核对象：`docs/build/review-r7.md`（判可交接）+ 作者在其后补的一条覆盖 `test/s44-callsite.mjs`。
本轮只做**独立复核**：确认这枚补丁没有破坏 R7 已通过的结论，并**自己**验证 s44 是否真的锁住调用点。

HEAD = `5ad602d`（`test(r7): s44 锁住调用点接线（R7 残留风险）`），评审开始时 `git status --short` 无输出。
`src/app/bridge.js` blob = `1bf59b6f…`，与 `git rev-parse be4eff4:src/app/bridge.js` **完全相同**：

```
git diff --name-status be4eff4..HEAD
A  docs/build/review-r7.md
A  test/s44-callsite.mjs
```

即本轮补丁**未改动任何源码**（只新增一个测试 + 一份文档）。这一点决定了"破坏已通过结论"的结构性风险为零；
下面仍按任务要求做实测，而不是只靠这个论证。

验证方式：逐行读补丁 + **自写独立探针**（`.tmp/r8/regress.mjs`，只调用实现、不改仓库）+
**47 套逐套单跑** + **三次换代码实跑**（调用点变异、正常路径变异、还原）。

## 复核结论：通过（阻断 0）

1. **补丁不碰源码**：`be4eff4..HEAD` 只有两个新增文件，`bridge.js` blob 一字未变。
2. **基线不变**：47 套 / 405 PASS / 0 FAIL；除新增 s44（6 条）外，46 套的逐套 PASS 数与 R7 记录**逐条相同**。
3. **s44 确实锁住调用点**：把 `:1234` 的 `return decisionFromOther(other)` 改回内联
   `other?.text === '批准' ? 'allowed' : 'rejected'` 后，**全量 47 套里只有 s44 变红**（46 绿 / 1 红），
   s41/s42/s43 全部保持绿 → s44 是这一行接线的**唯一锁**，不是"顺带也红"。还原后 s44 复绿、blob 复归。
4. **回归自洽**：`/yes`（真实 `drop()` 返回 false 的迟到分支）、`/ans 1`、`/no`、GUI 先答、手机先答
   五条路径 25 条断言全绿，结局 / 待答点 / 审计 / 回执四者一致，审计字段仍是 8 键。
5. **同类残留 1 处（非阻断）**：`:1276` 正常路径仍内联双写 `outcomeFromVote`，s44 不覆盖它；
   但它被 s43/s42/s38 端到端锁住（变异实测），属于"可维护性 / 双写漂移"风险，与 R7 风险 2 同一条。

## s44 变异验证

### 变异 A：把调用点改回内联（本轮的核心问题）

改 `src/app/bridge.js:1234` 一处（导出函数 `decisionFromOther` / `outcomeFromVote` 一字不动）：

```js
const other = await qq
return other?.text === '批准' ? 'allowed' : 'rejected'   // 变异后（blob f84a7dd8…）
```

| 套件 | 变异后结果 | 说明 |
|---|---|---|
| **s44-callsite** | **exit 1，5 PASS / 1 FAIL** | FAIL = `调用点按已生效票返回 allowed — rejected` |
| s41-audit-conservation | exit 0，9/9 | 不红 |
| s42-race | exit 0，9/9 | 不红 |
| s43-vote-map | exit 0，14/14 | 不红（它锁的是函数，不是这行调用） |

s44 变红的那一条**正是接线本身**，其余三条断言仍然绿（`审计恰好 1 条`、`审计票为 yes`、
`不发"已在电脑端处理"`）。也就是说：红的不是"审计守恒被破了"，而是"接缝结局与已生效票不一致"——
这正是 R6 那个 bug 的形态，说明 s44 瞄的是对的地方。

为把"唯一锁"证到底（不只抽 4 套），变异下**全量 47 套逐套单跑**：

```
MUTATED: TOTAL=47  GREEN=46  RED=1   ASSERT_PASS=404  ASSERT_FAIL=1
RED 只有 s44-callsite.mjs → FAIL 调用点按已生效票返回 allowed（/yes 不得被判 rejected） — rejected
```

**s41/s42/s43 都不红，且全库再无第二套红** → s44 是这行接线的唯一锁。

### 还原

```
restored blob = 1bf59b6f84858f0e09d0560cc0b1a16bb43619a3
HEAD:src blob = 1bf59b6f84858f0e09d0560cc0b1a16bb43619a3   ← 一致
git status --porcelain → 空
s44 exit=0  PASS=6 FAIL=0
```

### 稳定性（自己加的一格）

s44 用了 `queueMicrotask` 投票 + 两个 `setTimeout` 的时序，最怕偶发绿。连跑 8 次：
**8/8 exit 0、每次 6 PASS**，无抖动（`b.points.drop` 被打成常量 `() => false`，待答点状态只由我们的
`/yes` 改变，所以那条"仍 open"的断言不依赖机器快慢）。

### 覆盖边界（自己加的一格，用来判断 s44 会不会给人虚假安全感）

反向变异：改坏**正常路径** `:1276`（把 `settled.text === 'yes'` 去掉，模拟"改一处忘另一处"）：

| 套件 | 结果 |
|---|---|
| s44 | **exit 0，6/6 绿**（它只走迟到分支） |
| s43 | exit 1，12 PASS / **2 FAIL**（`/yes → allowed`、`/yes 审计票与结局一致`）|
| s42 | exit 1，7 PASS / **2 FAIL**（`审批：结局与生效票一致`、`反向：结局与手机票一致`）|
| s38 | exit 1，5 PASS / **2 FAIL**（`QQ 先答 → allowed`、`无 next 时行为不变`）|

结论：两条路径**各有人守**——迟到分支由 s44 独锁，正常路径由 s43/s42/s38 端到端锁。
s44 补上的是"原来只有人看代码才能发现"的那一半，没有和既有锁重叠，也没有留下无人守的一半。

## 实际基线

任务指定的 `C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0）。
`test\*.mjs` 共 **49** 个，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 后 **47 套逐套单跑**
（每次独立进程；统计行首 `^PASS` / `^FAIL` 行数并核对退出码）：

```
TOTAL=47  GREEN=47  RED=0   断言级：PASS=405  FAIL=0
```

逐套（PASS 数）：bb-batch1 12、bb-batch2 12、bb-batch3 11、bb-batch4 3、bb-batch5 23、bb-batch6 4、
s10-wake 5、s11-new 7、s12-consult 8、s13-hidden 3、s14-notify 7、s15-writes 5、s16-progress 6、
s17-late 7、s18-watchdog 5、s19-goodbye 4、s2-transport 35、s20-offline 6、s21-degrade 4、s22-noise 4、
s23-format 9、s26-wake-id 3、s27-idcmds 7、s29-wake-resolve 4、s30-say-text 5、s31-copy 18、s32-relay 7、
s33-prompts 3、s34-deliver 6、s35-title 5、s36-workspace 2、s37-qqtitle 3、s38-dual 7、s39-guarantees 22、
s3-label 8、s3-order 9、s3-seq 6、s4-state 14、s40-question-next 6、s41-audit-conservation 9、s42-race 9、
s43-vote-map 14、**s44-callsite 6**、s5-question 12、s5-say 11、s6-label 12、s8-audit 17。

与 R7 对照：R7 = 46 套 / 399 PASS；本轮 = 46 套 / 399 PASS（逐条数字与 R7 **完全一致**）+ s44 6 条
= **47 套 / 405 PASS**。即补丁没有增删改任何既有断言的结果。

## 回归（`/yes` / `/ans 1` / `/no` / GUI 先答 / 手机先答）

探针 `.tmp/r8/regress.mjs`（自己写的，与 R7 的 `.tmp/r7/*` 无共用代码），
每格都核对"接缝结局 / 待答点状态与票 / 审计条数与内容 / 发给手机的回执"四件事是否互相自洽：

| 路径 | 接缝结局 | 待答点 | 审计 | 审计内容 | 回执 |
|---|---|---|---|---|---|
| **`/yes`（labeled，迟到分支）** | `allowed` | `resolved`/`yes` | **1** | `{"text":"yes","by":"u1"}` | 不发"已在电脑端处理" |
| **`/ans <id> 1`** | `allowed` | `resolved`/`批准` | 1 | `{"text":"批准","by":"u1"}` | — |
| **`/no <id>`** | `rejected` | `resolved`/`拒绝` | 1 | `{"text":"拒绝","by":"u1"}` | — |
| **GUI 先答（无手机票）** | `allowed` | `dropped` | 1 | `{"via":"gui","outcome":"allowed"}` | 发"已在电脑端处理（allowed）" |
| **手机先答、GUI 迟到** | `allowed` | `resolved`/`yes` | 1 | `{"text":"yes","by":"u1"}` | 不发"已在电脑端处理" |

`REGRESS TOTAL=25 PASS=25 FAIL=0`（exit 0）。

两条值得单独说明的实跑细节：

1. `/yes` 那一格**没有**像 s44 那样把 `drop` 打成常量，而是包了一层记录返回值的真 `drop()`：
   实测 `dropRet=[false]` —— 请求确为 labeled（`meta.card.labeled=true`），确实走进了 `drop()===false` 的
   迟到分支，且结局 `allowed`、审计 1 条、票 `yes`。**这是对 s44 那格"打桩式时序"的独立旁证**：
   真实交错下的行为与 s44 断言的一致。
2. 落盘审计行仍是 **8 键**，`requestId` 仍优先取 `callId`（`C-yes`）：
   `requestId, wpId, openid, at, card, evidenceViewed, evidenceMissing, outcome`。

## 同类残留扫描

扫 `src/app/bridge.js` 全部 9 个顶层导出：`outcomeFromVote`、`decisionFromOther`、`userMessage`、`isBusy`、
`lastStop`、`unwrap`、`writeTargetOf`、`deliverToAgent`、`looksLikeCommand`，逐个查"导出纯函数 →
调用点是否仍保留内联实现"。

**判为同类残留：1 处。**

### 残留 1（同类，非阻断）：`outcomeFromVote` 在正常路径仍被内联双写

`:1276`：

```js
const yes = settled.text === '批准' || settled.text === 'yes' || settled.selected?.[0] === '批准'
const outcome = yes ? 'allowed' : 'rejected'
```

这正是"函数抽出来了、调用点没接线"的同一种形态，**s44 不覆盖它**（s44 只打迟到分支）。
它与 R7 风险 2 是同一条。判**不阻断**的依据是实跑：改坏它之后 s43 红 2 条、s42 红 2 条、s38 红 2 条
（见 §s44 变异验证 · 覆盖边界），即行为已被端到端守住，只是代码层面仍有两份映射，
将来改一处忘另一处会漂移。建议把 `selected` 判据并进 `outcomeFromVote` 后让正常路径也走它。

### 反方向的同形残留（非阻断，非本轮引入）：`looksLikeCommand` 被测试锁住却零调用点

`looksLikeCommand`（`:125`）被 `test/s3-order.test.mjs:41-43` 直接断言，但**生产代码里没有任何调用点**——
真正的命令闸门是 `envelope.parseCommand()`（`:276` 起按 kind 分派）。这与 s44 处理的问题正好相反：
不是"函数对、接线错"，而是"函数被锁、接线根本不存在"，测试绿与真实行为可能各自漂移而不报警。
本轮未引入，也不是缺陷，记录备查。

### 已排除（人工核对无内联副本）

| 导出 | 调用点 | 判定 |
|---|---|---|
| `decisionFromOther` | `:1234` | 本轮由 s44 独锁（变异已验证） |
| `unwrap` | `:1145`、`:1286` | 无内联副本（grep 无 `?? rawRequest` / `rawRequest?.request`）|
| `writeTargetOf` | `:940` | 单一调用点，无副本 |
| `deliverToAgent` | `:398`、`:689` | 两处均走函数；`agent.inject/followup/send` 只在函数体内出现一次 |
| `userMessage` | `:398`、`:689` | 无第二处 `role:'user'` 消息构造（`:48` 是唯一构造点）|
| `isBusy` | `:536`、`:564`、`:804`、`:904` | 无 `=== 'running'` 之类的内联 busy 判定 |
| `lastStop` | `:910` | 无内联副本 |

### 相邻但不算本类（1 处）

提问侧迟到分支 `:1337` 仍是内联的 `if (other?.status === 'resolved')`，以及 `:1340` 的 `{answers: []}`
兜底（= R7 风险 3）。提问侧**没有**对应的导出纯函数，所以不构成"双写"，仍是语义问题（该让位桌面却给了
空答案对象）。本轮未构造出可观测危害。

**同类残留数：1 处**（`:1276`；另有 1 处反向同形 `looksLikeCommand`、1 处相邻非本类），均不阻断。

## 附注（非阻断，1 条文档更正）

R7 §映射复验 写 labeled 那格是"`classify` → `outside-workspace`"。实测
`classify({ toolName:'fs.write', args:{ sandbox_permissions:'x' } })` 返回
`{ labeled:true, reason:'escalation' }`（`label.js` 第一条分支先判 `args.sandbox_permissions`）。
s44 与我的探针用的都是这份 args，落盘审计里也是 `"reason":"escalation"`。
`labeled=true` 与"labeled 只认 `/yes`"的结论都不受影响，只是原因名不符，建议下一轮顺手改正，
免得后来人按 `outside-workspace` 去找代码。

## 复跑方式

```
$node = C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个单跑 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）
  → 47/47 绿，405 PASS / 0 FAIL
$node .tmp\r8\regress.mjs
  → /yes（迟到分支，真实 drop 返回 false）/ /ans 1 / /no / GUI 先答 / 手机先答 = 25 条全 PASS
# 变异 A（调用点改回内联）→ 47 套里只有 s44 红（5 PASS / 1 FAIL），s41/s42/s43 全绿
# 变异 B（正常路径 :1276 去掉 'yes'）→ s44 仍绿；s43/s42/s38 各红 2 条
git hash-object src/app/bridge.js   # 复原后应为 1bf59b6f84858f0e09d0560cc0b1a16bb43619a3
git status --porcelain              # 应为空
```

状态：通过（2026-10-25）
