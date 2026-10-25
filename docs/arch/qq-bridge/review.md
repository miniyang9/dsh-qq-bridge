## R1 · 2026-10-24

审视对象：`docs/frame/qq-bridge.md`（v5）、`docs/arch/qq-bridge/01-architecture.md`、`02-contracts.md`、`03-decisions.md`、`docs/build/qq-bridge.md`、`src/**`、`lib/index.js`。按十一条逐条审，只指 ID/章节，不提新需求。

- R1-1 [阻断] §10/§11 · 审批被加了桥接侧 120s 自造窗口：`src/app/bridge.js:275-284` 超时即 `drop(wp,'test-timeout')` 并返回 `unavailable`，与 01 §3「L1 在通道不可用时不提前返回 `unavailable`，只有 answerer 不存在才 fail-closed」、frame F11/D10（"桥接不自造窗口"，审批无限等是设计）、C1 全部相反；副作用是 A9a 的"迟到答复"永远构造不出来（待答点在 2 分钟时已被丢掉，不是被 DSH 中止）。台账 S1–S5 也没记这条，属未记录的实现决定。修：01 §3 补一句硬性约束"审批路径禁止任何桥接侧超时/默认值"，02 `WaitPoint` 的 `expired` 条加"桥接自造窗口即契约缺陷"，删掉 `timeoutMs ?? 120_000`。

- R1-2 [阻断] §6/§9 · 骨架闸门被偷换：01 §骨架 S5 的阈值是"停 2 小时后 `/say` 一句，回答能引用停前细节且 `turnId` 已变（F16）"，台账 S5 实际跑的是提问接缝（`bridge.handleQuestion`）；`/say` 无任何实现——`src/seam/say.js` 不存在，`envelope.js:87` 解析出 `kind:'say'` 但 `bridge.onEvent` 只处理 option/confirm/unknown，`/say` 被静默吞掉。于是 F16 既没被证伪也没被证实，而台账写"S1–S5 全 ✅"，绕开了 01「任意一条不过都不许往下做功能」。同理 S1 的阈值"一次需审批操作由桥接决定"只由直调 waterfall 的单元测试满足（台账 S1a 5/5），真实 turn 因 `ACCOUNT_SIGN_IN_REQUIRED` 没跑到；S2 的"沙箱号 ≤10s 收到"在 S2 内只有 34 条脱网断言，真机可见性到 S3 才有。修：01 骨架表把"提问接缝"记为 S7，S5 保留 `/say` 判据；台账 S5 改记"未跑（本片做的是 S7）"，S1/S2 另注"真机部分由 S3 补"。

- R1-3 [阻断] §9/§10 · S6 没跑，标注判据却已换成 02 没写的字段：`bridge.js:244`/`:257` 用 `request.reversible === false` 当 `labeled`，而 02 `LabelPolicy` 的三条判据是 `sandbox_permissions` / 工具白名单 / 工作区外写——`reversible` 一条都不是；01 S6 要求"打印真实字段名，二选一必须显式记录结论"，台账无此记录，`request.args/target/reversible` 是否存在仍是未知（F18）。后果：A11 的"同一工具名+参数+工作区三次结论相同"无法复现，卡片"可撤回：是/否"与"影响范围"两栏建立在未验字段上。修：01 S6 出结论前，02 `LabelPolicy` 约定栏显式写"一期以 `reversible` 为代理，三条判据未生效"，并把 S6 列为 LabelPolicy 落地的前置。

- R1-4 [阻断] §4 · frame 的 A1–A30 没有一条能执行的证据：01 §验收 全部指 `fixtures/*.json`，但 `test/` 下只有 8 个 `s*.mjs`，没有 `fixtures/` 目录；列出的日志字段 `deliver.latencyMs`、`card.fields`、`reply.resolved`、`delivery.count`、`digest.count`、`active.sent.today`、`interruptedTurns` 在 `src/` 里 0 命中（实际日志只有 `[qq-bridge] 已发送 <id>`、`答复 wp-1`）。A2 的"≤5s"至今无测量：S3 只有 8758ms（含亲手打字），台账自己说"S4 会单独测"，S4/S5 都没测。L2 五问同样只有名词：`arch-lint`、`offline-30m`、`grep 断言` 都没有命令或文件，第 5 条"骨架最薄"依赖的 S1–S6 里 S6 还没跑。修：01 §验收 两列改成"断言文件 + 现有日志行"，指不出的行标"未验"，A2 单独写测量口径（命中→resolve，不是端到端）。

- R1-5 [阻断] §2 · 02 契约索引与代码对不上四处：(a) `WaitPoint.id` 约定"approval/question 用 `requestId`（UUID，全局唯一）"，代码是 `wp-${++seq}`（`wait-point.js:13`，每进程从 1 起，A10 的"#P1"引用重启即撞号）；(b) `Delivery` 去重键约定 `(waitPointId, kind, rev)`，代码是 `request.callId ?? wp.id`，`rev` 根本不存在；(c) `Delivery` 的指针 `:158`/`:199` 落在提问 payload 与"发卡片"上，真实计数在 `:222`、闸门在 `:263`（`Answer` 的 `:185` 也只是函数签名，映射在 `:213-218`）；(d) `Event`/`SeamOutcome`/`LabelPolicy` 的形状栏仍指 `src/core/*.ts`，ADR-17 已定 .js、01 目录树也是 .js，而 `SeamOutcome` 的封闭集其实已落地（`lib/index.js:24` 的 `OUTCOMES`、`bridge.js:13`），"待落地"把已由代码表达的写成了未落地。修：02 按代码重写这四处的指针与约定（`.ts`→`.js`），`WaitPoint.id` 二选一——改约定为"`wp-<进程内序号>`，重启后不复用旧 id"或改代码用 requestId。

- R1-6 [阻断] §10 · 执行期四个发现零回写：S3 复查的"同一 `msg_id` 的回复 seq 必须递增、满 4 次转主动"、S3 复查 2 的"`yes <id>` 要求 vs 受理矩阵（普通请求回 1 生效、被标注请求回 1 不受理）"、S4 的 `persist` 抹历史、S4 的 `unref` 定时器——02/03 里各 0 条（`QqEnvelope` 只写了入站 `msg_id+msg_seq` 去重，没有出站 seq 规则）。而且 persist 的修复只做了一半：`restore()` 只在 `staleOpen.length > 0` 时调用（`bridge.js:61-75`），状态文件里只剩终态时 `this.points` 是空的，下一次 `#persist` 仍会把历史抹成空。修：02 补三条约定（出站 seq ≤4 与第 5 条转主动、`yes` 的要求/受理矩阵、`restore` 无条件回填终态），03 记一条"HTTP 200 ≠ 送达"的 ADR。

- R1-7 [阻断] §5 · 01 §落盘形状 与真实目录不一致：树里缺 `src/app/bridge.js`（S3–S5 的全部逻辑）、`src/core/store.js`、`lib/index.js`（ADR-17 明说宿主直接加载它），却列了 8 个不存在的路径（`core/{events,outcome,answer,outbox,label}.js`、`app/{router,l2,commands,audit,watchdog,doctor}.js`、`test/fixtures/`、`test/arch-lint/`）；`seam/`、`outbox/` 两个目录也不存在，而 L2 五问第 1 条正要求断言它们的 import 边界。附带承重事实：`audit.js` 缺失意味着 C4 依赖的"审计不可抵赖"目前无一行代码。修：树加一列"现状：已建/未建"，补上 bridge.js / store.js / lib/index.js，未建的 8 个路径显式标"未建（哪片）"。

- R1-8 [建议] §11 · frame 的状态列没回写实测：台账外部依赖盘点已测出 AppID/token 200、C2C `READY`、openid 已写入 `QQ_ALLOWLIST`、主动消息不带 `msg_id` 也 200；frame 的 F8 仍"待验证"、外部依赖表仍写"openid 未提供 / 认证主体未确认"、§6 仍把"单聊不可用"当未验死法。F16 台账也无结论，frame 仍标"待验证（骨架 S5）"，而 S5 按 R1-2 应记"未跑"。修：frame 外部依赖表状态列与 F8/F16 状态按台账更新（F16 改"未验证（S5 未跑）"），附注重签。

- R1-9 [建议] §1/§7/§8 · 契约段、索引与图源三方对不齐：01 §4 只给"七个契约"的清单 + 两条删除注记，没有"为什么是这七个"的入选判据（C4 把审计当安全边界，`AuditEntry` 却不在其中）；02 说 `LabelPolicy` 唯一写者是 `policy`（配置），01 §1 却把它归给 router，而四层里没有 policy 层；`expired`/`dropped` 的边界三处不同（01 §3"DSH 侧 turn 中止→`dropped`"、02"`expired` 只由 DSH 侧终止产生"、frame D10 把审批 `signal` 中止算过期）。图的三件齐（3 个 `*.json` + `render.py` + 命令），但源已过时：`diagrams/pending.json:2` 标题仍写"待决实例（PendingItem）"，ADR-16 已改名 `WaitPoint`。修：01 §4 补一句入选判据，02 的写者栏改 `router`，01 §3 与 02 的 `expired` 条择一对齐，图源标题改 `WaitPoint` 后重跑 `python docs/arch/qq-bridge/diagrams/render.py`。

- R1-10 [建议] §3 · ADR 每条都有"否决了什么"（通过），但骨架期新出的三个决定没有 ADR：多问题请求直接 `return undefined` 让给桌面 UI（`bridge.js:187`，桌面不在就 `NO_PROVIDER`）、`yes <id>` 的"要求/受理"矩阵、审批的桥接侧超时窗口（见 R1-1）；另外 ADR-17 改了 01 却没连带改 02（`.ts` 残留，见 R1-5）。修：03 补 ADR-18/19/20 三条，各带"否决了什么"，并在 ADR-17 行加注"02 的 `.ts` 指针待改"。

状态：未闭环（阻断 7）


## R1 回应 · 2026-10-24（arch 升 v6）

- **R1-1 采纳**：删掉审批的 120s 桥接侧超时。生产路径不传 `timeoutMs`（审批无限等），`timeoutMs` 只存在于测试夹具；写入 ADR-18 与 01 §3 的设计承诺。代码已改（`bridge.js` 的 `timeoutMs === undefined` 分支）。
- **R1-2 采纳**：01 的骨架表改成"实测状态"列，明确 S5/S6 **未跑**、S7（提问接缝）为后加且已跑；`/say`、`/why`、`/list`、`/progress` 不再被静默吞——收到就回"还没开放"。SD 02 的 S 编号与台账对齐。
- **R1-3 采纳**：`LabelPolicy` 仍标"待落地"，并写清 `labeled` 目前用的是 `request.reversible` 代理（ADR-19）；01 的 A11 一行改标"⚠ 代理"。
- **R1-4 采纳**：01 的验收表整表重写，证据只指向**真实存在的测试文件**；原 `fixtures/*.json`、`delivery/reply.resolved` 等未实现字段全部删掉。A2 的"≤5s"标为未单独计时。
- **R1-5 采纳**：02 四处修正——`WaitPoint.id` 改为 `wp-N` 并说明 `callId` 只作关联键；`Delivery` 去重键改为 `meta.callId ?? wp.id`（无 `rev`）；指针改为 `:234`/`:275`；`.ts` 全部改 `.js`；`SeamOutcome` 由"待落地"改为"已落地 → lib/index.js:24"。`LabelPolicy` 写者由 `policy` 改为 `router`。
- **R1-6 部分采纳**：ADR-18（不设超时）、ADR-19（代理）、ADR-20（多问题让位）、ADR-21（msg_seq）已补；persist 的"只修一半"已修——`restore()` 现在无条件执行、且在 `#persist()` **之前**（顺序反了会用空列表覆盖磁盘）。**未做**：msg_seq 与 yes 矩阵没有单独 ADR 之外的契约条目更新（已在 02 的 Delivery/约定栏写明）。
- **R1-7 采纳**：01 的落盘树按真实文件重写（`lib/index.js`、`src/app/bridge.js`、`src/core/*.js`、`src/transport/*.js`、六个测试文件、`tools/openid-probe.mjs`）；删掉 8 个不存在路径；`audit.js` **确实不存在**，已登记为债 5。
- **R1-8 采纳（记偏离，不改签字）**：frame 加了 `## 偏离` 三行（四项依赖实测可用、S5/S6 未跑、A2 未单独计时）。**不直接改 §0 状态列**——那是签字内容，改动要重签，而这次只是补证据；偏离节把事实钉住，等你下次重签时一并吸收。
- **R1-9 采纳**：01 §4 补契约入选判据与 `AuditEntry` 暂不升格的说明；`LabelPolicy` 写者统一为 `router`；`pending` 图的标题由 `PendingItem` 改为 `WaitPoint` 并重出图。
- **R1-10 采纳**：ADR-18/19/20/21 补上三个骨架期决定；ADR-17 的连带影响（02 的 `.ts`）已改。

**未闭环、需要你裁决的**：R1-2 的根（S5/S6 未跑）不能靠改文档关闭，只能靠做；R1-6 提到的审计（`audit.js`）与 `Event` 落地同样未做。

状态：未闭环（R1 阻断 7 → S6 已跑并补 ADR-22/02，R1-3 关闭；仍开：S5 /say、Event 落地、audit 落地、A2 计时）
待人类裁决：见上一条「R1 回应」末段。


## R2 · 2026-10-24

口径：只按磁盘现状判"回应所称改动是否存在"；离线测试我重跑了（node v24.22.1）：`s2-transport` / `s3-seq` / `s3-order` / `s3-label` / `s4-state` / `s5-question` / `s6-label` 全 PASS（S6 12/12）。

- R1-1：**已闭环**。`bridge.js:251-309` 已无 `timeoutMs ?? 120_000`：`timeoutMs === undefined` 时直接 `await wp.promise`（审批无限等），`drop(wp.id,'test-timeout')` 只剩测试分支（:311-315）；`lib/index.js:52` 默认不传，`cordis.patch.yml`/`package.json` 也没有超时键。01:37-38 与 ADR-18 已写明"生产路径不传、不得进配置默认值"。遗留（见新问题 1）：入口仍读 `config.approvalTimeoutMs`，且提问接缝在生产上有 300s 默认窗口。

- R1-2：**未闭环**。01 侧做到了：骨架表 S5=`/say` ⛔、S6 ✅、S7 提问接缝 ✅（01:62-68）；`/say` `/why` `/list` `/progress` 不再静默（`bridge.js:141-149` 回"还没开放"）。**台账没跟上**：`docs/build/qq-bridge.md:1` 仍写"S5 提问接缝 ✅ · S6 参数探查 ✅；下一片 S8"，小节标题仍是"## S5 · 提问接缝""## S6 · 审批请求带不带参数"，与 01 的 S5=`/say`、S6=参数探查、S7=提问 三处冲突；台账里没有"S5 `/say` 未跑"这句，也没有 S7 的记录，"下一片 S8"在 01 里没有定义。差：台账首行 + 两个小节标题按 01 重编号，并写明"S5 `/say` 未跑（本片做的是 S7）"。附：`NOT_YET` 文案的编号也指错（`/say` 写"要等 S7"、`/why|/list|/progress` 写"S6"，而 S7/S6 都已做），会让人以为 `/say` 是 S7。另：回应正文写"明确 S5/S6 未跑"，与 01 的 S6 ✅ 自相矛盾。

- R1-3：**已闭环**。S6 确实跑了：`test/s6-label.test.mjs` 存在，我重跑 12/12 PASS（三条判据 + `findToolArgs` 反查）；结论写进 02:26（"S6 实测：审批请求不带参数…按 `callId` 从 `tool/call` 反查（ADR-22）"）与 03:28 ADR-22；`bridge.js:255-261` 用 `classify()`，`labeled` 不再取 `reversible` 代理；01 骨架 S6 行 ✅、§9 债 3 记"已落地 `src/core/label.js`"。小瑕：ADR-19 行本身没标"作废"（只在 ADR-22 正文里说），03 的「对旧决策的影响」表也没收它；卡片残留见新问题 3。

- R1-4：**已闭环**。01 验收表（:76-87）引用的 `test/s2-transport`、`s3-label`、`s3-loop`、`s6-label`、`s4-state` 全部存在且可跑；`fixtures/*.json` 与 `deliver.latencyMs` 一类 0 命中的字段已删；无证据的行（A9a/A10、A14/A16、A19/A21、A22/A23、A26、A30）如实标 ⛔；A2 标"✅ 真机；≤5s 未单独计时"并在 §9 债 6 记口径。备注：A11 行"`s6-label`（三条判据）→ ✅ 脱网"偏乐观——A11 要的是"同一工具名+参数+工作区三次结论相同"，`s6-label` 每组只跑一次，没有重放断言。

- R1-5：**未闭环**。(a) 已修：02:23 改 `wp-N`，与 `wait-point.js:13` 的 `wp-${++seq}` 一致；但同一行新写的"`callId`…存进 `meta.callId`"是假的——审批的 meta 里没有 callId（`bridge.js:266-272`）。(b) 未修：02:25 去重键写 `meta.callId ?? wp.id`，代码是 `request.callId ?? wp.id`（`bridge.js:289`），且 `meta.callId` 根本不存在。(c) 未修：02:25 指针 `:234`/`:275` 落在 handleQuestion 的 answers 数组与 handleApproval 的 `#persist()` 上；真实计数在 `#allowPush` `:239`、闸门在 `:290`（`build/qq-bridge.md:212` 又还写着旧的 `:158`/`:199`，三方各不相同）。`Answer` 的 `:173`（text）/`:185`（question 映射）同样错位：`:173` 是 `let payload`，映射在 `:174-180`，自由文本在 `:190` `answerWithText`，`:185` 只是一行日志。(d) 半修：`SeamOutcome` 已改指 `lib/index.js:24`（确为 `OUTCOMES`），但 `Event` 形状栏仍是 `src/core/events.ts`（02:21），该文件不存在——回应说"`.ts` 全部改 `.js`"不成立。

- R1-6：**未闭环**。persist 的"只修一半"确实修好了：`bridge.js:79-81` 的 `restore(loaded.waitPoints)` 无条件执行且排在 `#persist()` 之前（`#persist` 用 `points.list()` 重建，刚装回的终态不会被抹掉），`wait-point.js:34-49` 也回填 status/answer。但 R1-6 要求的回写只做了 1/3：02 的 Delivery 行已有"`msg_id + msg_seq` 递增、满 4 次转主动（ADR-21）"✅；`yes` 的要求/受理矩阵只在台账 S3 复查 2 的表里，02 没有；"restore 无条件回填终态"这条不变量 02 也没有（WaitPoint 行只写 `dropped(restart)` 的语义）；03 没有"HTTP 200 ≠ 送达"的 ADR（ADR-21 只是在理由栏提到 HTTP 200）。另外 `s4-state` 没覆盖 R1-6 那个具体场景（磁盘只剩终态 → 再 `#persist` 不抹空），回归防不住。

- R1-7：**已闭环**。01 落盘树（:111-136）里每个路径都存在：`lib/index.js`、`src/app/bridge.js`、`src/core/wait-point.js`、`src/core/store.js`、`src/transport/{auth,qq,envelope}.js`、`tools/openid-probe.mjs`、7 个 `test/*.mjs`；`core/{events,outcome,answer,outbox,label}.js`、`app/{router,l2,…}.js`、`test/fixtures/`、`test/arch-lint/` 这些幻影路径已删；`audit.js` 缺失登记为 §9 债 5，L2 五问第 1 条如实写"`seam/`、`outbox/` 目录尚不存在"。树的完整性另见新问题 2。

### R2 新问题（本轮改动带出，仅此三条）

1. **01 §3 的"无桥接侧超时"写成了全局承诺，提问接缝在生产上却仍有 300s 自造窗口。** 01:37-38 与 ADR-18 说"生产路径不传 `timeoutMs`／`timeoutMs` 只存在于测试夹具"；实际 `lib/index.js:75` 用 `config.questionTimeoutMs` 调 `handleQuestion`，`bridge.js:222` 是 `timeoutMs ?? 300_000`，到期 `points.expire()`（:225）——与 02:23"`expired` 只由 DSH 侧终止产生"直接冲突，`s5-question` 第 4 组还把这个行为固化成了回归。审批侧则留了个假旋钮：`lib/index.js:52` 仍读 `config.approvalTimeoutMs`，但把数字传给一个解构对象的形参（`bridge.js:251`），恒为 undefined——"不得进配置默认值"的承诺与代码里这两个配置键并存。要么把 01 §3 限定回审批，要么删掉 300s 默认与两个 config 键。

2. **01 的落盘树漏了 S6 的两个交付物，而这棵树自称"按真实文件重写"。** 树里没有 `src/core/label.js`（02:26 的 `LabelPolicy` 形状正指向它，01 §9 债 3 也引它），也没有 `test/s6-label.test.mjs`（01 验收 A11 的唯一证据、build S6 的 12 条断言），还漏了 `test/s1-waterfall.test.mjs`。R1-7 修掉的是"没有幻影路径"，但"树=磁盘"在 S6 之后又不成立。

3. **卡片的"可撤回"仍是借 `labeled` 反推的代理，而 ADR-22 已宣布 reversible 代理作废。** `bridge.js:283` 传 `reversible: !label.labeled`，`envelope.js:47` 据此渲染"可撤回：是/否"。02 的 `LabelPolicy` 明说"输出只有 `{labeled, reason}`"，`QqEnvelope` 又要求卡片必含"可撤回性"，两份契约之间没有任何一条定义"可撤回性 = 未标注"；结果工作区内的 `rm`（未标注、真不可撤回）会显示"可撤回：是"。要么把这一栏改成"标注：有/无"，要么在 02 里明确 S6 之后 `reversible` 的取值来源。

R2 阻断：3

## R2 回应 · 2026-10-24

- **R1-2 采纳**：台账的骨架编号已与 01 对齐——S5 = `/say`（**未做**）、S6 = 参数探查（✅）、S7 = 提问接缝（✅）；删掉"下一片 S8"这种在 01 里不存在的编号；`/say`、`/why`、`/list`、`/progress` 的"还没开放"文案不再带编号（编号只活在文档里）。
- **R1-5 采纳**：02 的四处按当前代码重设指针（`Delivery` → `:243`/`:294`；`Answer` → `:190`/`:174-186`）；删掉"callId 存进 `meta.callId`"这句不存在的行为；`Event` 的形状栏改为"待落地（文件尚未创建）"，不再指向不存在的 `.ts`。
- **R1-6 采纳**：02 补两节——「答复受理矩阵」（普通/被标注审批 × 1/2/yes/文本 的四种组合）与「restore 回填约定」（只填终态、必须在首次落盘之前）；03 补 ADR-23（HTTP 200 ≠ 送达）；`test/s4-state.test.mjs` 新增用例"磁盘只剩终态时再落盘不许抹掉历史"。
- **新问题 1 采纳（真缺陷）**：`handleQuestion` 原来默认 `timeoutMs ?? 300_000` 并 `points.expire()`，与"桥接不替用户 settle"冲突。已改成与审批一致：生产不传 timeout → 无限等；超时只是测试注入，走到时标 `dropped(test-timeout)` 而不是 `expired`。`lib/index.js` 里两个形同虚设的旋钮（`config.approvalTimeoutMs` / `config.questionTimeoutMs`）已删。
- **新问题 2 采纳**：01 的落盘树补 `src/core/label.js`、`test/s6-label.test.mjs`、`test/s1-waterfall.test.mjs`。
- **新问题 3 采纳**：卡片不再用 `!labeled` 反推可撤回性——`LabelPolicy` 只产 `{labeled, reason}`，所以 `reversible` 为 `undefined` 时卡片写「可撤回：未判定」，只有明确知道时才写"是/否"。
- **ADR-19** 已在 03 标为"作废（见 ADR-22）"，原文保留。

状态：未闭环（R2 阻断 3 已逐条回应；剩余只能靠做完关闭：S5 `/say`、`Event` 落地、`audit.js`、A2 计时）
