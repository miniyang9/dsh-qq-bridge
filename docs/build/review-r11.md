# 评审 · 轮次 11

评审对象：R10 判「不可交接（阻断 3）」后的修复提交 `312743c`（`fix(r10): 探针空 stdout 误判为 0 + 补齐 5 个门控漏点 + 契约对齐`）。评审开始时工作树干净。

评审方式：逐条读 `src/core/presence.js`、`src/app/bridge.js` 的推送路径与 `docs/arch/qq-bridge/01/02/03`；自写探针 `.tmp/r11-probe.mjs`（B1 四条通道）、`.tmp/r11-gate2.mjs`（离开态照发 + 在场态被动回执）；复用 `.tmp/r10-gate.mjs`（在场态 5 个新门控）与 `.tmp/r10-shard-d17.mjs`（分片/D17）；按 `docs/build/baseline.md` 逐套单跑 56 套并取退出码。凡行号均按当前 HEAD 实测。

## 交接结论：不可交接（阻断 1）

| 项 | 结果 |
|---|---|
| **B1** 探针把空 stdout 读成 0 | **已关闭**（正常/强制文件/空 stdout 回退/两路失败四种场景实测；附一条文件为空的残留硬化点，不阻断） |
| **B2** 5 个推送点未门控 | **已关闭**（5 处在场全静音、离开全照发；`/pc`、`/say`、`/ans`、`/mode` 被动回执均未被吞） |
| **B3** 契约与 01 目录树 | **未关闭**（`answerMode` 仍在 Answer 行；`dropReason` 列入 2 个全仓不存在的值；01 目录树仍缺 `audit.js`，且新增块造成 3 处重复/缩进错位） |

新门控漏点：**0 个**。本轮代码改动未引入新的“该发被吞”；新问题集中在 B3 的文档面（01 目录树重复与缺项，计入 B3 未关闭）。

## B1/B2/B3 核销

### B1（已关闭）空 stdout 不再被当作 0，失败安全链成立

修复点：`src/core/presence.js:124-127`，管道分支改为 `if (!r.error && /^\d+$/.test(raw)) return Number(raw)`；不满足则落文件通道，文件通道抛错则 `null`。实测（`.tmp/r11-probe.mjs`，本机 win32，非 Electron）：

| 场景 | 注入方式 | 实测 | 判定 |
|---|---|---|---|
| 正常环境 | 不注入 | `normal.value = 27875`，`isFinite = true`，非 0 | ✅ 真实毫秒 |
| 只走文件通道 | `DSH_IDLE_FORCE_FILE=1` | `28313`，`isFinite = true` | ✅ |
| 管道空 stdout（EPERM 形态） | 假 `spawnSync` 第 1 次返回 `error + stdout: undefined` | `54321`，`spawn` 调用 2 次 | ✅ 走文件通道，未返回 0 |
| 管道失败、文件真实执行 | 第 1 次假 EPERM，第 2 次放行真 PowerShell | `28781`，`isFinite = true` | ✅ 回退真实可用 |
| 两路都失败 | 假 `spawnSync` 两次均 `error`，且无文件 | `null`，`spawn` 调用 2 次 | ✅ 返回 null 而非 0 |
| 终点语义 | `new Presence({ probe: () => null })` 两次采样 | `state = away`，`idleMs = null`，`describe = 拿不到空闲时间` | ✅ → 离开 |

结论：R10 指出的“`Number('') === 0` → 永久在场 → 通知永久静音”在管道分支已关闭；文件兜底现在确实能接管。**残留（不阻断）**：文件分支仍用 `Number(trim(fileText))`，若文件被创建但内容为空（如超时被截断、陈旧临时文件），`Number('')` 仍为 0（实测 `.tmp/r11-probe.mjs` 的 `emptyFile.value = 0`）。EPERM 场景下文件不存在、`readFileSync` 抛错 → null，所以不影响本次 B1 结论；建议顺手把文件内容也改成 `/^\d+$/` 校验。

### B2（已关闭）5 个推送点已门控，且没有吞掉被动回执

5 处新增门控（均在 `src/app/bridge.js`）：

| # | 推送点 | 行 | 改法 | 在场实测 | 离开实测 |
|---|---|---|---|---|---|
| 1 | 断网摘要（`ready` + `failedSends>0`） | `:221` | `if (!this.#present()) this.send(...)` | muted | 发出 |
| 2 | 重启后待答点作废（`onReady`） | `:283` | `if (!this.#present()) await this.send(...)` | muted | 发出 |
| 3 | 咨询 5 分钟无追问自动结束 | `:851` | `else if (!this.#present()) await this.send(...)`，仅 `data=null` 主动分支 | muted | 发出（`/done` 的被动回话不受影响） |
| 4 | 审批「已在电脑端处理」 | `:1539` | `if (!this.#present()) this.send(...).catch(...)` | muted | 发出 |
| 5 | 提问「已在电脑端答复」 | `:1634` | 同上 | muted | 发出 |

- 在场态实测（`.tmp/r10-gate.mjs`）：上述 5 条 + 原有卡片/重连/停滞/催办全部 `muted`。
- 离开态实测（`.tmp/r11-gate2.mjs`）：5 条新门控全部 `true`（断网摘要、重连、重启、审批已答、提问已答、咨询结束）。
- **没有吞掉该发的**：同在在场态下，`/pc 60` 回执「已静音 60 分钟」、`/say` 确认回执「[wp-3] 将要发送…」、`/ans` 回执、`/mode` 回执、`sayGoodbye` 均照发；`/pc` 的被动回执走 `data.id`，不经过 `#present()`，与设计一致。
- 5 分钟兜底（`:1370`）仍故意不门控；离开补推（`:1175`）仍按 `away` 转换触发。

结论：R10 的 5 个漏点全部关闭，没有新增“该发被吞”的门控。R10 另记的“静音即消费、离开不补”（`:1324/:1330/:1344/:1354` 先置位后门控）本轮未改，也未写进 ADR-30；属既有行为，非本轮引入，作为非阻断观察保留。

### B3（未关闭）契约与 01 目录树仍有三处实质性不符

已关闭的两项：

- `02-contracts.md:23` 的 `WaitPoint.kind` 已改为 `{approval, question, say}`，删掉不存在的 `idle`；实现实测为 `approval`（`bridge.js:1447`）、`question`（`:1585`）、`say`（`:1034`）。
- 两个裸行号指针已换成函数名：`Answer` → `answerWithText / resolveAnswer`，`Delivery` → `handleApproval / #queueCard`。

仍未关闭的三项：

| # | 位置 | 现状 | 与实现对照 | 判定 |
|---|---|---|---|---|
| 1 | `02-contracts.md:24`（`Answer` 行） | 仍写 “`option` 只对 `answerMode=closed` 有效，`text` 只对 `text` 有效” | 全仓 `src/`、`test/` 无 `answerMode`；实现按 `target.kind` 与 `meta.labeled` 分支（`bridge.js:419-513`） | ❌ `answerMode` 仍是一个不存在的字段；R10 要求“删掉或写明由 kind 推导”，此处两件都没做 |
| 2 | `02-contracts.md:23`（`WaitPoint` 行） | 把 `dropReason` 的“实际取值”写成 `turn-end`/`restart`/`power-loss`/`answered-on-gui`/`cancelled-by-user`/`inject-failed`/`push-quota`/`test-timeout` | 全仓 `turn-end`、`power-loss` **0 命中**；实际出现的只有 `restart`（`bridge.js:250`）、`cancelled-by-user`（`:425`）、`inject-failed`（`:471`）、`push-quota`（`:1470`）、`answered-on-gui`（`:1524`/`:1626`）、`test-timeout`（`:1559`/`:1663`），共 6 个 | ❌ 从“少了 5 个实际值”变成“混入 2 个不存在值”；作为“实际取值”清单仍不成立 |
| 3 | `01-architecture.md:128-146` | 仍缺 `src/app/audit.js`；新增块把 `label.js`、`store.js`、`wait-point.js` 各列了两遍（`:141/:145`、`:143/:146`、`:142/:144`），`:138`/`:144` 缩进断裂 | 真实文件 `src/app/audit.js` 存在（`bridge.js:204` 使用 `Audit`）；R10 点名的 4 个文件只补了 presence/events/sessions 3 个 | ❌ 目录树仍不是“按真实文件重写”，且本轮新增了重复项 |

结论：B3 未关闭。它的剩余项不是文案润色：`Answer` 行仍指向不存在的字段，`dropReason` 的“实际取值”仍包含代码里根本不产生的值，01 的落盘形状仍缺一个真实文件并有重复项。按 R10 的同一把尺子（冻结文件的封闭集/形状必须与实现一致），这三项仍属契约级缺陷。

## 门控复查（17 个主动推送点）

`#present()` 定义在 `bridge.js:1193`：`pc` → 在场，`away` → 离开，`auto` → `presence.state === 'present'`。本轮只改了 B2 的 5 处，其余未动；逐点复列如下：

| # | 推送点 | 当前行 | 是否过 `#present()` | 判定 |
|---|---|---|---|---|
| 1 | 断网摘要 | `:221` | 是（本轮新增） | ✅ |
| 2 | 重连提示 | `:225` | 是 | ✅ |
| 3 | 重启后待答点作废 | `:283` | 是（本轮新增） | ✅ |
| 4 | 审批/提问卡片（`#queueCard`） | `:558`（入队） | 是 | ✅ 入队时判定；`mergeMs` 窗口内（默认 1.5s）存在极窄竞态，与 R10 一致 |
| 5 | 合并窗口冲刷（`#flushCards`） | `:573-581` | 入队时已判 | ✅ 不在冲刷时二次判定，窗口 1.5s 可忽略 |
| 6 | 离开补推（`#flushPending`） | `:1167-1175` | 不适用（由 `away` 转换触发） | ✅ 实测发出 |
| 7 | 跑完通知（`turn/end`） | `:1138-1139` | 是 | ✅ |
| 8 | 停滞一级 | `:1331-1332` | 是 | ✅ |
| 9 | 停滞二级 | `:1325-1326` | 是 | ✅ |
| 10 | 30 分钟催办 | `:1347-1348` | 是 | ✅ |
| 11 | 10 分钟催办 | `:1357-1358` | 是 | ✅ |
| 12 | 5 分钟兜底 | `:1370` | **否（有意）** | ✅ 设计例外：`/pc` 回执与手册都写明“5 分钟没人答仍会推” |
| 13 | `/say` 回执首片 | `:1396` | **否** | ✅ 被请求的回复，不是主动通知；本轮实测在场照发 |
| 14 | 审批「已在电脑端处理」 | `:1539` | 是（本轮新增） | ✅ |
| 15 | 提问「已在电脑端答复」 | `:1634` | 是（本轮新增） | ✅ |
| 16 | 咨询自动结束 | `:851`（`data=null` 分支） | 是（本轮新增） | ✅ `/done` 的被动回话不受影响 |
| 17 | 退出通知 `sayGoodbye` | `:1683` | **否** | △ 终止告知，非“打扰”；R10 判可接受，本轮未变 |

**新漏点 = 0。** 5 处 `if (!this.#present())` 的位置均在“发送动作”外层、副作用（drop/persist/audit/清理 consultation）之后，没有把状态变更一起吞掉；也没有任何被动回执（带 `data.id`）走门控。

## 基线

按 `docs/build/baseline.md` 的复跑方法，逐套单跑、按进程退出码（不做文本匹配）：

```powershell
$node = "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"   # v24.21.0
Get-ChildItem test -Filter *.mjs |
  Where-Object { $_.Name -notin @('_setup.mjs','s1-waterfall.test.mjs','s3-loop.mjs') } |
  Sort-Object Name |
  ForEach-Object { & $node $_.FullName *> $null; if ($LASTEXITCODE -ne 0) { "RED: " + $_.Name } }
```

实测：

```
TOTAL=56  GREEN=56  RED=0
```

- `test/*.mjs` 共 59 个；排除 `_setup.mjs`、`s1-waterfall.test.mjs`（需 Electron）、`s3-loop.mjs`（需真实通道）= 56，与 `baseline.md` 的 56/56 逐数一致。
- 未发现“空壳绿”：抽查的 `s52-presence.mjs`、`s53-gating-pages.mjs` 都是 `check()` 累积失败后 `process.exit(failures.length === 0 ? 0 : 1)`。
- 结论：**基线可复现，GREEN 56 / RED 0**。

## 回归抽查

| 回归面 | 用例/探针 | 实测 | 判定 |
|---|---|---|---|
| `/mode` 与 `/pc` | `test/s53-gating-pages.mjs`；`.tmp/r11-gate2.mjs` | `S53 PASS (0)`；在场态 `/pc 60` 回「已静音 60 分钟」、`/mode` 回「模式：静音（还剩 60 分钟）」 | ✅ |
| `/say` 分片与 `/more` | `.tmp/r10-shard-d17.mjs`；`test/s53-gating-pages.mjs`；`test/s5-say.test.mjs`、`s30-say-text.mjs`、`s32-relay.mjs` | 800 字 1 片；801/1600 字 2 片；2400 字 3 片；450 字 + `sayReplyChars=100` 夹到 200 → 3 片；`/more` 依次 2/2、末片提示、越界提示；S5/S30/S32 全 PASS | ✅ |
| `/done` 归档 | `test/s48-archive.mjs` | `S48 PASS (0)`：归档成功路径回「已归档」、无 `workspaceController` 时回「归档未成功」且不谎报 | ✅ |
| D17 / A33 | `.tmp/r10-shard-d17.mjs`；`test/s50-a6-a11-d16.mjs` | 默认 10：前 10 次成功、第 11 次拒绝（含「10 个」）；计数落盘，重启后第 12 次仍拒绝；`newPerWorkspacePerDay: 2` 时第 3 次拒绝；s50 全 PASS | ✅ |

本轮改动只涉及 `presence.js` 的解析分支、`bridge.js` 的 5 个门控与文档，没有触碰 `/mode`、`/say` 注入、`/done` 归档、`newSession` 的实现；上述抽查未发现回归。

## 建议（不阻断）

1. **B3 收尾**：删掉 `02-contracts.md:24` 的 `answerMode=closed`（改成“由 `kind` 推导：approval/say 只受 option，question 受 option/text”）；把 `dropReason` 清单改成实际 6 个，或写成开放集并注明“仅用于排障”；把 `src/app/audit.js` 补进 01 目录树，删掉重复的 `label.js`/`store.js`/`wait-point.js` 并修正缩进。
2. **B1 文件分支同款硬化**：`fs.readFileSync` 后加 `/^\d+$/` 校验，避免“文件存在但为空”再次得到 `Number('') === 0`。
3. **补自动化用例**：目前 B1 的 EPERM 回退与 B2 的 5 个门控都只有 blackbox 文档（BB-85…BB-107）和临时探针，没有进 `test/`；至少把“空 stdout → 文件通道 → 5000+”“两路失败 → null”“在场 5 条静音 / 离开 5 条照发”固化成退出码用例。
4. **ADR-30 的例外写全**：`03-decisions.md:40` 的“不推全部主动通知”建议补一句“被请求的回复（`/say` 回执）与终止告知（`sayGoodbye`）不在此列”，避免读者把 `/say` 回执也当成应静音的主动通知。
5. **静音即消费**：R10 提到的 `:1324/:1330/:1344/:1354` 先置位后门控仍未处理；若保持现状，建议在 ADR-30 明写“在场期间到点的催办/停滞只消费不补发”，否则现场会把“离开后没收到 10/30 分钟提醒”当成丢消息。

状态：未通过（阻断 1）
