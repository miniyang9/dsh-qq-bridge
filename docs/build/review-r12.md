# 评审 · 轮次 12

评审对象：R11 判「不可交接（阻断 1）」之后的两个提交面——`48b09f1`（`fix(r11): 关闭 B3 残留 + presence 文件分支同样严格`）与 `d80ed22`/`ad28a4f`/`2da52d8`（ADR-32/33、门控对象扩为全部主动通知、BB-80 注）。HEAD = `2da52d8`，评审开始时工作树干净。

评审方式：逐行读 `02-contracts.md`、`01-architecture.md` 目录树、`03-decisions.md` ADR-30/32/33、`qq-bridge.blackbox.md` L455–L551、`src/app/bridge.js`、`src/core/presence.js`、`src/core/wait-point.js`、`src/transport/*`；grep 核对 `drop()` 第二参数、`answerMode`、`turn-end`/`power-loss`、`recovered`；自写探针 `.tmp/r12-probe.mjs`（`/pc` 三参数、`/mode` 三种模式、presence 文件分支四条）；按 `docs/build/baseline.md` 逐套单跑 56 套并取退出码。凡行号均按当前 HEAD 实测。

## 结论：不可交接（阻断 3）

| 项 | 结果 |
|---|---|
| **B3 三项** | **全部关闭**（`answerMode` 已删；`dropReason` 只列 6 个真实值；01 目录树含 `audit.js`、无重复、缩进一致） |
| **用例修订** | 指定 11 条抽查 **9 通过 / 2 未通过**（BB-87、BB-95）；另在 9 条阻断的关联用例里查出 BB-96 未通过 |
| **基线** | `TOTAL=56 GREEN=56 RED=0`（node v24.21.0） |
| **presence 文件分支** | 空文件 → `null`、非数字 → `null`、数字 → `54321`、真实探针 → `812`；不再出现 0 |

阻断集中在「文档先走、代码没跟上」与「字面钉错」两类，不是 B3 的残留：

| # | 位置 | 事实 | 判定 |
|---|---|---|---|
| 1 | ADR-32（`03-decisions.md:43`）× BB-95 | ADR-32 钉死 `/pc` 的 0／负数／非数字「一律拒绝并回固定提示」；实测 `/pc 0` 被接受并回「已静音 0 分钟（到期自动恢复）…」，`/pc abc`、`/pc -5` 落 `unknown` 回通用帮助（不含『无效』『正整数』『参数』）。BB-95 期望 1)「3/3 为拒绝且含固定词表」、2)「静音启动 =0 次」对当前实现必红 | ❌ 用例已按 ADR-32 改对，但 ADR-32 没落进代码（与 R11 B3 同型：文档与实现不符） |
| 2 | 增补口径 #3（L469）× BB-96 | 口径把 `模式` 取值钉成 `自动｜静音｜离开`；实测 `/away` 后 `/mode` 输出 `模式：始终推送`，全仓无 `模式：离开`；手册 L123 也写「`/away` 始终推送」。BB-96 期望 2)「`模式：离开` 1/1」必红 | ❌ B7 的收尾只做了一半：判据钉死了，但钉的是一个不存在的字面 |
| 3 | BB-87（L492）期望 3)/5) | 「我重连过」只在 `recovered` 事件发（`qq.js:136`），而该事件要求 `#staleClosed`（`qq.js:179`）——只由 `recoverIfStale` 在「连续 2 个心跳周期（41.25s×2≈82.5s）收不到任何帧」时置位（`lib/index.js:144` 每 10s 调）。BB-87 离开段用的是「断网 30s」：正常报错走 `close → scheduleReconnect → READY`（`qq.js:154-169`），不发该提示；30s 也凑不满 82.5s 无帧。故 30s 断网不能确定性产生「我重连过」，正确实现合法地 0 条。期望 5)「L 重连记录 =2 行」另无字面定义（实现只有 `ws open`/`reconnect in` 行，没有 recovered/stale 行） | ❌ B2 的修订把「0 处」改成「离开段 1 处」，但没给可确定性触发该事件的手段，改成了假失败 |

## B3 核销

R11 B3 的三项逐条核销（当前 HEAD）：

| # | R11 的要求 | 现状 | grep/实测 | 判定 |
|---|---|---|---|---|
| ① | `02-contracts.md` 删掉不存在的 `answerMode` | `:24` 已改为「`option` 只对审批/确认类（approval、say）有效，`text` 只对提问（question）有效」；`answerMode` 仅存于 `review-r1/r10/r11` 三份历史评审 | 全仓 `answerMode` 0 命中（除历史评审文档） | ✅ 关闭 |
| ② | `dropReason` 的「实际取值」只列实现里真实存在的值 | `:23` 现为「实现中的取值：`restart`/`cancelled-by-user`/`inject-failed`/`push-quota`/`answered-on-gui`/`test-timeout`；`turn-end`/`power-loss` 未实现，勿引用」 | `drop(` 第二参数实测 6 处：`cancelled-by-user`（`:425`）、`inject-failed`（`:471`）、`push-quota`（`:1470`）、`answered-on-gui`（`:1524`/`:1626`）、`test-timeout`（`:1559`/`:1663`）；`restart` 在 `:250` 以 `w.dropReason='restart'` 直接赋值。`.js` 全仓 `turn-end`/`power-loss` **0 命中** | ✅ 关闭（两个不存在值已移出清单并标「未实现，勿引用」） |
| ③ | `01-architecture.md` 目录树含 `src/app/audit.js`、无重复、缩进正常 | `:130-149` 树列为 `package.json`、`cordis.patch.yml`、`lib/index.js`、`src/app/{bridge,audit}.js`、`src/core/{presence,events,sessions,label,wait-point,store}.js`、`src/transport/{auth,qq,envelope}.js` | `Get-ChildItem src -Recurse -File` 实测 11 个 `.js`，与树 11/11 一一对应、无多无漏；`audit.js` 在 `:137`；无重复条目；`:135-148` 缩进统一为 `│  │  ├─`/`│  │  └─`。`01:124` 的「已落地 `src/app/audit.js`」与树一致 | ✅ 关闭 |

附注（不阻断）：

- `restart` 是直接赋值而不是 `drop()`，但契约原句「作废进 `dropped` 并记 `dropReason`」在该路径同样成立（`:249-251` 同时置 `status='dropped'`），不需要改。
- 目录树现在只覆盖运行文件，不再列 `test/`、`tools/`、`docs/`（旧版列过一份已过期的 `test/` 清单）。标题是「落盘形状」，删掉过期清单可以接受，但严格说它已不是全仓形状——建议标题改为「运行文件形状」或补一句「仅列运行文件，`test/` 见 `baseline.md`」。

## 用例修订抽查

抽查范围：任务指定的 9 条阻断对应用例（BB-87、89、90、94、95、99、102/103、108）+ 2 条一般用例（BB-85、BB-104）；另对 B7 点名的 BB-96 顺带复核（不在指定名单内）。判定尺子：ADR-30/32/33、增补口径 #1–#8（L465–L474）、`/mode` 四行口径（#3）。

| 用例 | 对应阻断 | 修订核对（现状 vs 上一轮要求） | 判定 |
|---|---|---|---|
| BB-89 | B1+B4+B7 | B1：前置补「**组内不执行 FQ-0**：不退出桥接、不清 `state.json`；通道就绪由 `/mode` 与 `/list` 各 1 条复核」；B4：期望 1)/3) 改为「按 L 补推分类行计，A6 提醒行剔除不计」「同一 requestId 补推内容累计重复 =0」；B7：步骤 1/2/4 各一次 `/mode`，期望三段判定 3/3 | ✅ 通过 |
| BB-90 | B3 | 窗口从 12 分钟压到 **4 分钟**；删掉「催办／提醒类」这种无词表的类判据，改成固定串「已 N 分钟没有新输出」「可能卡住了」各 0 处；期望 = 审批卡片 0 条 + UI 有提示 + ST 待答 =1 + L 出站 0 行 | ✅ 通过 |
| BB-94 | B5 | 补了正向对照：`/pc 1` 回话含「静音」且含 1；T0+30s `模式：静音`；到期判据改成 T0+55s／T0+70s 两次 `/mode` 的「静音→自动」唯一转变（不再依赖未定义的「L 到期定时器行」）；`/pc` 对在场门控的接续单列期望 4 | ✅ 通过 |
| BB-99 | B1（+S2） | 前置补「承 BB-98（组内不执行 FQ-0…）」；步 2 改「第 N 次 `/more`」、期望 6) 同步改成第 N 次（S2 的差一位消失）；另把 S3 的『没有更多』从 `/more 999` 词表收窄到『无效』『不存在』 | ✅ 通过 |
| BB-102 | B6 | 全面改按 ADR-33：`workspace.json` 的 `global.archivedSessionIds` 长度 A0/A1、数组原文、成功时「归档未成功」0 处、`/list` 中 C1 0 次；FQ-16 同步改成抄数组 | ✅ 通过（C-id 来源见下方附注） |
| BB-103 | B6 | FQ-17 改成「把 `workspace.json` 设只读」注入，并以「临时咨询会话 `/done` 回『归档未成功』1/1」为成立判据；期望拆成失败段（A1−A0=0、数组无 C2）与拆除后成功段（A2−A1=1、数组含 C3） | ✅ 通过 |
| BB-108 | B9③ | 新增：`/pc` 静音子态下 `/list`、`/progress` 各 1 条被动回话（M1−M0=2、各 ≤10s、主动通知 0、`模式：静音`、状态变化 0），补上「静音期间被动回话不被吞」的零覆盖 | ✅ 通过 |
| BB-85 | 一般 | 在场态审批 0 条 + L 出站 0 行 + UI 有提示 + ST 待答 =1 + `/mode` 四行；判据全部落在可观察量上 | ✅ 可判定 |
| BB-104 | 一般 | 10 次 `/new` 成功、第 11 次拒绝且回话含数字 10、ST 计数 =10、会话总数 +10；实现拒绝文案为「…已经新建 10 个，到上限了（每工作区 10 个/天）」，含 10 且默认上限 =10（`bridge.js:875`，构造默认 `:148`） | ✅ 可判定 |
| **BB-87** | **B2** | 期望 2)/3) 改成「在场段『我重连过』0 处、离开段 1 处」，但触发手段仍是 30s 断网——该事件只在 stale 恢复（≥82.5s 无帧）时发；期望 5)「两段内 L 重连记录 =2 行」无字面定义 | ❌ 未通过（详见阻断 3） |
| **BB-95** | **B9** | 已按 ADR-32 改成「0／负数／非数字 3/3 拒绝 + 静音启动 0 次 + 模式行不变」，判据本身自洽；但实现未实现 ADR-32：`/pc 0` 被接受、`abc`/`-5` 回通用帮助。执行时 1)、2)、3) 三条同时红 | ❌ 未通过（详见阻断 1） |
| BB-96 | B7（顺带） | B7② 要求的「步骤里补 `/mode`」已补（步 2、步 5）；但期望 2) 写 `模式：离开`，实现与手册都是 `模式：始终推送` | ❌ 未通过（详见阻断 2） |

**通过率**：指定抽查 11 条 → **9 通过 / 2 未通过（81.8%）**；9 条阻断对应面 → **6 条关闭（B1/B3/B4/B5/B6/B8）、3 条未关闭（B2/B7/B9）**。未抽中的一般用例本轮未逐条重审（旧 84 条与冻结标记按约定不动）。

附注（不阻断）：

1. **`/mode` 实际是 5 行**（`.tmp/r12-probe.mjs`）：`模式／判定／依据／探针` 之后还有第五行——auto 态是「规则：空闲 < 5 分钟视为在场，≥5 分钟视为离开」，pc/away 态是「（手动模式，忽略空闲）」（`bridge.js:1162`）。九条用例的「四行齐备 4/4」按「四行都在」读仍可过，但口径 #3 的「**固定**四行」与实现不符；建议写成「必备四行 + 一条规则行，判据只认前四行」。
2. **BB-102/103 的 C-id 来源没写死**：ADR-33 的「该 session id」是**咨询会话**的 id（`bridge.js:774` 的 `consultId`，`:838` 传给 `archiveSession`），而 `/why` 回话只给任务会话短 id（`:1098` 的 `shortOf(targetId)`），`/done` 回话也是 `shortOf(key)`（`:849`）。BB-102 前置写「FQ-10 记 C-id 与 session id」，但 FQ-10 只写「把回话给出的咨询标识记为 C-id」，没说咨询会话 id 从哪取（可取的落点是 `state.json.consults`，`:776`）。建议 FQ-10/BB-102 补一句取法。期望 2)（A1−A0=1）、4)（无「归档未成功」）、5)（`/list` 0 次）仍可独立判定，故不阻断。
3. **blackbox 文末状态仍是旧的**：L551 `状态：增补用例待修订（阻断 9）`，且 L527 写「逐条复核 23 条（BB-85…BB-107）」，与本批 24 条（BB-85…BB-108）不一致。前者是上一轮评审记录，但作为全文末行会被当成现行状态；修订核销时应补一行新的状态。

## 附带核查（presence 文件分支）

代码：`src/core/presence.js:139-142` 读文件后 `return /^\d+$/.test(rawFile) ? Number(rawFile) : null`，空文件/非数字不再走 `Number('')`。

`.tmp/r12-probe.mjs` 实测（本机 win32，非 Electron；用空 `PATH` 让两路 spawn 都失败，预置临时文件内容）：

| 文件内容 | 实测返回 | 判定 |
|---|---|---|
| 空文件 `''` | `null` | ✅ 不再得到 0 |
| `abc\r\n` | `null` | ✅ 非数字不解析 |
| ` 54321 \r\n` | `54321` | ✅ 去空白后正常解析 |
| 文件不存在（两路都失败） | `null` | ✅ 失败安全 |
| 默认真实探针（不注入，文件已删） | `812`（真实空闲毫秒，非 0） | ✅ 正常路径未回归 |

结论：R11 B1 记的残留硬化点（「文件存在但为空 → `Number('')===0`」）已关闭；管道分支 `:126-127` 的 `/^\d+$/` 校验未变。

## 基线

按 `docs/build/baseline.md` 的复跑方法，逐套单跑、只看进程退出码（套件输出重定向到 `$null`）：

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

- `test/*.mjs` 共 59 个；排除 `_setup.mjs`、`s1-waterfall.test.mjs`（需 Electron）、`s3-loop.mjs`（需真实通道）= 56，与 `baseline.md` 的 56/56 逐数一致；HEAD `2da52d8`、工作树干净。
- 未发现空壳绿：`s53-gating-pages.mjs` 等仍是 `check()` 累积失败后 `process.exit(failures.length === 0 ? 0 : 1)`（`:7`、`:103`）。
- 注意：56/56 全绿**不覆盖**上面 3 条阻断——BB-85…BB-108 尚未进 `test/`，`/pc` 参数校验、`模式：离开`、30s 断网重连都没有自动化用例可拦（R11 建议 3 仍未落地）。

状态：未通过（阻断 3）
