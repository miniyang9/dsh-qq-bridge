# 契约索引 · qq-bridge

冻结：2026-10-24（v2，随 frame v5 解冻/重冻）　　冻结人：架构（授权：`docs/frame/qq-bridge.md` v5 签字人 <signer>）

**这份文件是索引，不是字段表。** 形状那一栏最终指向代码位置；代码写不下的（唯一写者、封闭集合、不变量、错误码映射）永远留在"约定"里。

## 解冻记录（v1 → v2）

| 契约 | 处置 | 原因 | 依据 |
|---|---|---|---|
| `ActionClass` | **删除** | v5 删除了动作闸门；分档不再决定"能不能批" | ADR-12（推翻 ADR-09） |
| `PendingItem` | **改名并扩展** → `WaitPoint` | 会话的两种等待（阻塞 / 空转）统一 | ADR-16 |
| `Answer` | **新增** | 答复有了三种形态（选项 / 自由文本 / `yes <id>` 确认） | ADR-11 |
| `LabelPolicy` | **新增**（替代 `ActionClass`） | 只产出"标什么"，不产出"允不允许" | ADR-12 · ADR-15 |
| `Event` / `SeamOutcome` / `Delivery` / `QqEnvelope` | 保留（`QqEnvelope` 扩命令集） | 形状未变，只是字段增补 | — |

## 契约

| 契约 | 形状 | 唯一写者 | 约定（不变量 · 封闭集合 · 错误码） | 版本 | 冻结理由 |
|---|---|---|---|---|---|
| `Event` | 已落地 → `src/core/events.js:1`（seam 侧 `approvalEvent`/`questionEvent`；bridge 用 `unwrap` 兼容裸 request） | `seam`（L1） | `kind ∈ {approval, question, turn, notice}`，**封闭**；`approval/question` 必带 `requestId`（UUID，全局唯一）；`turn` 必带 `turnId`；时间戳单调；**下游只读，不得改写 payload** | v1 | 唯一跨层形状；第二消费者出现前必须冻结 |
| `SeamOutcome` | 已落地 → `lib/index.js:24` | `seam`（L1） | **封闭** `{"allowed","rejected","cancelled","unavailable"}`，与 DSH `OUTCOMES` 一一对应；不得发明第五种；"没回音"永远不能映射成 `allowed` | v1 | 与 DSH 的唯一出口，映射错一次就是事故 |
| `WaitPoint` | 已落地 → `src/core/wait-point.js:1` | `router`（L2） | `kind ∈ {approval, question, idle}`；`status ∈ {open, resolved, expired, dropped}`；`answerMode ∈ {closed, text}`（approval→closed，question/idle→text）；id 规则：**`wp-N`（桥接自增）**，与 DSH 的 `requestId`/`callId` 分开：**不落进 meta**，只用于去重键与参数反查（R1-5 修正：原文写"id 用 requestId"与实现不符）；只有 `open` 接受答复；外部原因作废进 `dropped` 并记 `reason ∈ {turn-end, restart, power-loss}`；`expired` 只由 DSH 侧终止产生 | v2 | 应答幂等、乱序、断电、续接全部锚在它上面 |
| `Answer` | 已落地 → `src/app/bridge.js:190`（text）/ `:174-186`（question 映射） | `router`（L2） | `kind ∈ {option, text, confirm}`；`via ∈ {reply, say}`；`option` 只对 `answerMode=closed` 有效，`text` 只对 `text` 有效（错配 → 回"该请求不接受这种答复"，状态不变）；`confirm` 必须带 `waitPointId`，与待答点不匹配一律驳回 | v1 | 它是"你的话进入任务"的唯一入口 |
| `Delivery` | 已落地 → `src/app/bridge.js:243`（计数）/ `:294`（闸门） | `outbox`（L3） | 去重键 **`request.callId ?? wp.id`**（R1-5/R2 修正：原文的 `(waitPointId, kind, rev)` 与 `meta.callId` 都不存在）；同键 24h 总推送 ≤3 条（含首次）；被动回复按 `msg_id + msg_seq` 递增、满 4 次转主动（ADR-21）；重试未实现 | v2 | A6 的阈值只能有一个写者 |
| `LabelPolicy` | 已落地 → `src/core/label.js:1` | `router`（L2） | 三条判据：参数含 `sandbox_permissions` → `escalation`；工具名命中白名单（≤5）→ `whitelist`；写类工具的目标路径在工作区外 → `outside-workspace`。**输出只有 `{labeled, reason}`，没有"是否允许"字段**；默认不标；`reason` 封闭集合 `{escalation, whitelist, outside-workspace}`。**S6 实测：审批请求不带参数**，判据 1/3 的参数要按 `callId` 从会话 `tool/call` 事件反查（ADR-22） | v1 | 它是"只看事实、不做评级"的结构保证 |
| `QqEnvelope` | 已落地 → `src/transport/envelope.js:1` | `transport`（L4） | 命令集**封闭**：`/ans <id> <序号|文本>` / `/yes <id>` / `/no <id>` / `/why <id|序号> <问题>` / `/done <id>` / `/say <id|序号> <文本>` / `/list` / `/progress [id]` / `/use <n|短id>` / `/wake <n|短id>` / `/new [n]`（短 id 参数为超集）；卡片必含 id、可撤回性、`/why` 提示；解析失败**不得推定 approve**；同一入站消息最多触发一次状态变更（`msg_id + msg_seq` 去重）；不假设消息场景（ADR-08） | v3 | 唯一接收不可信输入的地方 |

## 答复受理矩阵（`Answer` 的约定）

| 请求 | 回 `1` | 回 `2` | 回 `yes <id>` | 回自由文本 |
|---|---|---|---|---|
| 普通审批 | 批准 | 拒绝 | 批准 | 不推定（回提示） |
| 被标注审批 | **不受理**（回"请回 yes <id>"） | 拒绝 | 批准 | 不推定 |
| 提问（有选项） | 选项 1 | 选项 2 | — | 作为 `custom` |
| 提问（无选项） | — | — | — | 作为 `custom` |

**restore 回填约定**：启动恢复时只填终态（`resolved` / `expired` / `dropped`），`open` 一律先改成 `dropped(restart)`；
回填必须发生在首次落盘**之前**，否则会用空列表覆盖磁盘（R1-6 的实际教训）。

## 桩（可执行的最小约定）

| 单元 | 桩 | 独立验收夹具 |
|---|---|---|
| `seam` | `emitEvent(e)` + `resolve(waitPointId, outcome)` 空实现，其余抛 `not-implemented` | 假 DSH：脚本化吐 `approval/asked` 并等待 resolve |
| `router` | `waitPoint → policy → delivery` 直连，无重试 | 内存版 `WaitPoint`，按 A9a/A10 断言状态不变 |
| `transport` | 本地回环：进程内 HTTP 收 + 打印发 | 双进程夹具，验证"离线时入站仍被拒" |
| `l2` | 固定返回一段带伪造依据的文本 | 断言 A19 的"写 0 次 / 出站仅模型端点"由日志统计得出，而不是由 L2 自述 |

**桩不是占位符**：每个桩都必须能让下游跑完自己的验收。
