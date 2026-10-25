# 评审 · 轮次 9（终检）

终检对象：`docs/build/review-r7.md`（可交接，阻断 0）+ `docs/build/review-r8.md`（复核通过，阻断 0）+
`docs/build/qq-bridge.md` 新增的「事故与恢复」「评审收敛（R1–R8）」两节。

本轮只做**独立终检**，不重复 R7/R8 的变异实验：确认交接面完整、无回归、基线可复现，并自己抽查
3 条高风险路径。评审开始时 HEAD = `dfbf41e`，`git status --porcelain` 无输出。

验证方式：`git log/diff/hash-object` 对交接面取证 + **47 套逐套单跑两次**（独立进程）+
**3 个自写探针**（`.tmp/r9/*.mjs`，只调用实现、不改仓库）+ 与 R1–R8 报告逐条对数。

## 结论：可交接（阻断 0）

1. **基线可复现**：47 套两次单跑均为 `47 GREEN / 0 RED / 405 PASS / 0 FAIL`，逐套 PASS 数与 R8 记录**逐条相同**。
2. **交接面完整**：HEAD `dfbf41e` 与指定一致；`git log --oneline` 线性可读；`git status` 干净；
   `git diff 5ad602d..HEAD -- src lib` **为空**，`src/app/bridge.js` blob 仍是 `1bf59b6f…`（= R8 时）。
3. **文档自洽**：台账「评审收敛」的 9/8/6/2/1/1/0/0 与 R1–R8 报告标题/正文的阻断数**逐轮一致**；
   R8 行引用的 47 套 / 405 断言与本轮实测一致。
4. **高风险路径抽查通过**：`/yes` 迟到分支、`/say` 确认后注入、`/wake` 失败报错含"可用方法"，
   3 个探针共 **24 条断言全 PASS**（见 §高风险路径抽查）。
5. **剩余风险 13 条，均不阻断**（见 §剩余风险汇总）；其中 R5 的 2 条、R7 的 1 条已被后续补丁关闭，不计入。

## 基线

任务指定的 `C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.21.0）。
`test\*.mjs` 共 **49** 个，排除 `s1-waterfall.test.mjs`、`s3-loop.mjs` 后 **47 套逐套单跑**
（每套独立进程；统计行首 `^PASS` / `^FAIL` 行数并核对退出码）。

两次**连续**全量单跑，结果完全一致：

```
RUN1  TOTAL=47  GREEN=47  RED=0   断言级：PASS=405  FAIL=0
RUN2  TOTAL=47  GREEN=47  RED=0   断言级：PASS=405  FAIL=0
```

逐套（PASS 数，两次相同）：

```
bb-batch1 12  bb-batch2 12  bb-batch3 11  bb-batch4 3   bb-batch5 23  bb-batch6 4
s2-transport 35  s3-label 8  s3-order 9  s3-seq 6  s4-state 14
s5-question 12  s5-say 11  s6-label 12  s8-audit 17
s10-wake 5  s11-new 7  s12-consult 8  s13-hidden 3  s14-notify 7  s15-writes 5
s16-progress 6  s17-late 7  s18-watchdog 5  s19-goodbye 4  s20-offline 6
s21-degrade 4  s22-noise 4  s23-format 9  s26-wake-id 3  s27-idcmds 7
s29-wake-resolve 4  s30-say-text 5  s31-copy 18  s32-relay 7  s33-prompts 3
s34-deliver 6  s35-title 5  s36-workspace 2  s37-qqtitle 3  s38-dual 7
s39-guarantees 22  s40-question-next 6  s41-audit-conservation 9  s42-race 9
s43-vote-map 14  s44-callsite 6
```

与 R8 对照：R8 = **47 套 / 405 PASS / 0 FAIL**，逐套数字（含 `s44-callsite 6`）与本轮**完全一致**。
另：`git diff 5ad602d..HEAD -- test` 为空，即 R8 之后没有任何测试改动；本轮结果不是"新测试凑出来的绿"。

## 交接面检查

| 检查项 | 实测 | 判定 |
|---|---|---|
| HEAD | `dfbf41e8ff3552478141d89d0fa1f89089cee3ca`（短 `dfbf41e`） | ✅ 与指定一致 |
| `git log --oneline` | 12 条，线性无 merge；`bd7a445` 事故快照 → `ff7485a` 重建 → R1–R7 逐轮修复 → `5ad602d` s44 → `dfbf41e` 文档 | ✅ 连续可读，每轮可追溯 |
| `git status --porcelain` | 开始时无输出 | ✅ 干净 |
| `git diff 5ad602d..HEAD -- src lib` | **空** | ✅ 源码零改动 |
| `5ad602d..HEAD --name-status` | `M docs/build/qq-bridge.md`、`M docs/build/review-r7.md`、`A docs/build/review-r8.md` | ✅ 只有文档 |
| `src/app/bridge.js` blob | `1bf59b6f84858f0e09d0560cc0b1a16bb43619a3` = `HEAD:src/app/bridge.js` = R8 记录 | ✅ 逐字节一致 |
| `git diff 5ad602d..HEAD -- test` | 空 | ✅ 测试零改动 |
| `.env` | 未被跟踪（`git ls-files .env` 空），`.gitignore` 含 `.env`、`.tmp/` | ✅ 密钥不在库内 |

历史里的两条"非修复"提交（`bd7a445` 截断现场、`ff7485a` 重建）与「事故与恢复」一节逐字对应，
不是不明来源的改动；其余每一条提交信息都能对上 R1–R7 的某一轮。

本轮唯一新增文件是交付物 `docs/build/review-r9.md`；写完后 `git status` 只会多这一条未跟踪文档，
**源码与测试树仍为零改动**。为保持"HEAD 应为 dfbf41e"的核验条件，本轮**不提交**该文档。

## 文档一致性

把台账「评审收敛（R1–R8）」的表格与各轮报告逐一对照（报告标题 + 正文阻断清单）：

| 轮次 | 台账写 | 报告原文 | 报告清单核对 | 一致 |
|---|---|---|---|---|
| R1 | 9 | `## 结论：不通过（阻断 9）` | B1–B9 共 9 条 | ✅ |
| R2 | 8 | `## 结论：不通过（阻断 8）` | 正文列 8 条（B1/B3/B7/B8/B9/N1/N2/N3） | ✅ |
| R3 | 6 | `## 交接结论：不可交接（阻断 6）` | B4/N1/B3/N2/N3/B1 共 6 条 | ✅ |
| R4 | 2 | `## 交接结论：不可交接（阻断 2）` | N2、N3 | ✅ |
| R5 | 1 | `## 交接结论：不可交接（阻断 1）` | N2 | ✅ |
| R6 | 1 | `## 交接结论：不可交接（阻断 1）` | N2（`/yes` → `rejected`） | ✅ |
| R7 | 0 | `## 交接结论：可交接（阻断 0）` | — | ✅ |
| R8 | 0 | `## 复核结论：通过（阻断 0）` | — | ✅ |

其他自洽点：

- **R8 数据行**：台账写"47 套 / 405 断言全绿"，与 R8 报告、与本轮两次实测三方一致。
- **R7 更正**：`dfbf41e` 的消息"更正 R7 的 label 归因"与 R7 文末「更正」段、R8 §附注三方一致
  （labeled 的 `reason` 是 `escalation`，不是 `outside-workspace`）；结论"labeled 只认 `/yes`"未受影响。
- **R3 基线行**：台账"基线 40/42"与 R3 报告"实际 40/42、42 套"一致（不是 42/42）。
- **非阻断文档小瑕**：「事故与恢复」写"当前 1281+ 行"，实测 `src/app/bridge.js` 为 **1427 行**。
  "1281+" 字面不假，但已偏旧；下次动这份台账时建议改成确数，免得后来人低估恢复规模。不影响交接。

## 高风险路径抽查（自写探针，24 条断言）

探针在 `.tmp/r9/`（被 `.gitignore` 忽略），只 import 实现并驱动公开接口，不改仓库源码。

### 1）`/yes` 迟到分支 —— `probe-yes-late.mjs`（9 条）

与 s44 的关键区别：**不打桩 `points.drop`**，而是包一层记录返回值的**真 `drop()`**；用微任务次序
构造"GUI 赢得 `Promise.race`，但手机 `/yes` 已在 `drop()` 之前结算该点"。

| 断言 | 实测 |
|---|---|
| 确实进入迟到分支（真 `drop()` 返回 false） | `dropRet=[false]` |
| 接缝结局按已生效票 | `allowed` |
| 待答点 | `resolved` / `yes` |
| 审计条数 | **1**（未追加 GUI 第二条） |
| 审计内容 | `{"text":"yes","by":"u1"}` |
| `requestId` 优先取 callId | `C-r9-yes` |
| 审计字段 | 8 键（`requestId/wpId/openid/at/card/evidenceViewed/evidenceMissing/outcome`） |
| 是否发"已在电脑端处理" | **不发** |

即 R6 那个阻断的形态（票 `yes`、接缝 `rejected`）没有复活；且这次是真实交错下的独立旁证。

### 2）`/say` 确认后注入 —— `probe-say.mjs`（10 条）

| 断言 | 实测 |
|---|---|
| 确认前只回显"将要发送" | 回执含 `[wp-1] 将要发送：…`，不含注入 |
| 确认前注入次数 | **0** |
| 待答点 | `say` / `open`，回执给出 `/ans wp-1 1` |
| 确认后注入次数 | **1** |
| 注入目标 | `session-r9-say` |
| 注入文本 | = `userMessage(text)` 的 `content[0].text` |
| 角色 | `role: 'user'` |
| 待答点结局 | `resolved` / `via: 'say'` |
| 确认后回执 | "已发送：…" |

### 3）`/wake` 失败报错含"可用方法" —— `probe-wake.mjs`（5 条）

用一个"有会话可唤醒、但服务既无 `resolveAgent` 也无 `resume/claim`"的 `NoWakeService` 触发失败分支：

```
唤醒失败：这个服务没有 resolveAgent/resume。可用方法：hello, ping
```

断言：含"唤醒失败"、含"可用方法："、列出原型方法（`hello`/`ping`）、**不误报"已唤醒"**；
反向对照（同一场景换成有 `resolveAgent` 的服务）正常回"已唤醒"，证明这句报错不是无条件出现。

## 剩余风险汇总（不阻断）

汇总 R5–R8 报告记录的非阻断项（去重后 **13 条**），全部**不影响本次交接**。
先记已关闭、不再计入的 3 条：

| 已关闭项 | 关闭依据 |
|---|---|
| R5-1「手机票在 GUI 答复解析后的同一 tick 到达」窗口 | `f3795bc` 起 GUI 分支判断 `drop()` 返回值；本轮探针用真 `drop()=false` 复验 |
| R5-2「N2 修复零覆盖」 | `s43-vote-map`（映射）+ `s44-callsite`（调用点）已补，R8 变异实测 s44 独锁 |
| R7-1「s43 只锁函数、不锁调用点」 | `5ad602d` 的 `s44-callsite`；R8 变异 A 实测全量只有 s44 变红 |

| # | 风险 | 来源 | 现状 / 为什么不阻断 | 影响交接 |
|---|---|---|---|---|
| 1 | 正常路径 `bridge.js:1276` 仍内联双写 `settled.text === '批准' \|\| 'yes'`，未走 `outcomeFromVote` | R7-2 / R8-残留 1 | 行为被 s43/s42/s38 端到端锁住（R8 变异：各红 2 条）；是"改一处忘另一处"的维护性风险 | 否 |
| 2 | 提问侧迟到分支返回 `{answers: []}` 而非 `undefined`（`:1340`，`expired`/`dropped` 时） | R6-1 / R7-3 / R8 相邻项 | 语义上该让位桌面；本轮仍未构造出可观测危害 | 否 |
| 3 | 提问审计 `requestId` 仍是 `wp-N`（`:1345`，提问 `meta` 无 `callId`） | R5-3 | 与 A26"能对上 DSH 那次请求"有差距；审批侧已正确 | 否 |
| 4 | 审计/frame 字段名不齐：frame 写 `evidence_missing`/`evidence_viewed`，落盘是驼峰 | R5-4 | 文档口径问题，读取方已按驼峰实现 | 否 |
| 5 | `Delivery` 去重键仍是 `auto-<startedAt>-<seq>`，非契约的 `request.callId ?? wp.id` | R5-5 / R4 残留 | 撞键症状已消失；无 `callId` 请求无法真去重、`deliveries` 键只增不裁 | 否 |
| 6 | `answerWithText()` 是死代码（全仓无调用点），且保留"先回执、无条件 answer/审计"旧语义 | R5-6 | 谁把它接回去 N2 会复活；建议删除，别留第二条看起来能用的路径 | 否 |
| 7 | `bridge.js:477` 日志三元已死（`res.ok` 在早退分支后恒为 true） | R5-7 | 纯日志/可观测性小瑕 | 否 |
| 8 | `/why` 成功时仍无即时回话，要等咨询轮次结束才有内容 | R5-8 | A18/A19"≤10s 有人感"仍依赖咨询轮次；本轮 `/why` 未被抽查路径覆盖 | 否 |
| 9 | N4 守卫只认裸 `request.signal`；`questionEvent()` 不复制 `signal`（`lib/index.js:105`） | R5-9 | Event 形状下守卫与 DSH 中止可能同时失效；生产目前走裸 request | 否 |
| 10 | GUI 胜出早退分支未移除 `request.signal` 的 abort 监听、迟到分支未 `#persist()` | R6-3 / R7-4 | 点已由另一端结算并落盘，当前无害；清理项 | 否 |
| 11 | `s42-race` 两个"同时作答"用例的时序实际未打到 GUI 分支，且未校验审计内容 | R6-2 | 属测试覆盖观感问题；映射与调用点已分别由 s43/s44 锁住 | 否 |
| 12 | `looksLikeCommand` 被 `s3-order` 直接断言，但生产代码零调用点（真闸门是 `parseCommand`） | R8 | 反向同形残留：测试绿与真实行为可能各自漂移；非缺陷 | 否 |
| 13 | `outcomeFromVote` 额外接受 `allow`/`allowed`，当前无生产者会产出这两个词 | R7-5 | 防御性写法，与 02 契约"批准/yes"表述不完全对应；建议写进契约或注释 | 否 |

**交接判断**：13 条中没有一条会改变已验收行为——基线 405 条断言与 3 个高风险探针都指向
"双通道结局 / 审计守恒 / 确认后注入 / 唤醒报错"四条主路径正确。建议交接后按 #1、#6、#2、#3 的顺序清理
（前两条是"将来容易改坏"的坑，后两条是契约对齐）。

## 复跑方式

```
$node = C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
逐个单跑 test\*.mjs（排除 s1-waterfall.test.mjs、s3-loop.mjs）
  → 两次均 47/47 绿、405 PASS / 0 FAIL
$node .tmp\r9\probe-yes-late.mjs   → 真 drop()=false 的迟到分支，9/9 PASS
$node .tmp\r9\probe-say.mjs        → 确认前 0 注入 / 确认后 1 注入，10/10 PASS
$node .tmp\r9\probe-wake.mjs       → "可用方法：hello, ping" + 正常唤醒对照，5/5 PASS
git diff 5ad602d..HEAD -- src lib  # 空
git hash-object src/app/bridge.js  # 1bf59b6f84858f0e09d0560cc0b1a16bb43619a3
git status --porcelain             # 开始时为空（评审后仅多本文件）
```

状态：可交接（2026-10-25）
