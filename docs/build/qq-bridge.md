状态：进行中（S1–S21 脱网全绿；白盒无欠账；待黑盒 + 真机 + 验收）

# 构建台账 · qq-bridge

frame：`docs/frame/qq-bridge.md`（v5，<signer>，2026-10-24）
架构：`docs/arch/qq-bridge/01-architecture.md` · 契约 `02`（冻结 2026-10-24）· 决策 `03`

## 外部依赖盘点（2026-10-24，探针实测）

| 依赖 | 状态 | 探针与结论 |
|---|---|---|
| QQ AppID / AppSecret | **可用** | `POST bots.qq.com/app/getAppAccessToken` → 200，`expires_in 7200` |
| 单聊场景（C2C） | **可用** | 网关 `READY`；手机发 "hi" → 收到 `C2C_MESSAGE_CREATE` |
| 你的 openid | **可用** | 事件里 `user_openid = F59365BA…A62E`，已写入 `.env` 的 `QQ_ALLOWLIST` |
| 出站回传 | **可用** | 用事件 `msg_id` 被动回复 → `http 200`，返回消息 id 与时间戳 |
| 主动消息（无 msg_id 推送） | **可用**（2026-10-24 实测） | 不带 `msg_id` 直接 `POST /v2/users/{openid}/messages` → `http 200`，返回消息 id。意味着"你不在线时也能推卡片"，不必先等你说话。频控与"用户可关闭"仍按 F6 执行 |
| 第二 QQ 账号（A5 负例） | **不可用** | 你尚未提供，A5 只能用假通道自证 |
| DSH 常驻策略（托盘/自启/计划任务） | **还不能验** | 需要在 DSH 应用侧配置，未开始 |
| L2 模型额度 | **还不能验** | 未调用过；A19–A21 验收时才需要 |

## S1 · 占住 approval/request · 2026-10-24

做了：
- `package.json` + `cordis.patch.yml` + `lib/index.js`（功能性 cordis 插件，注册 `approval/request`）
- `test/s1-waterfall.test.mjs`：用**安装目录里真实的 cordis**（app.asar 内的 `@deepseek-ai/cordis`）跑 waterfall，含"不装插件时回退 `unavailable`"的对照组

没做：
- **真实 turn 里的审批**：`s1headless` 启动时插件已加载，但这个环境拿不到模型凭据（`ACCOUNT_SIGN_IN_REQUIRED`——account provider 需要在桌面应用里签入）。所以"一次真实任务里由插件决定审批结果"没验到。这条会在 S3 与桌面 profile 集成时补，不另开片。
- 通道相关的一切（S2 的代码化）

下次：
- S2：把已手工验证过的通道（token/长连/被动回复）写成 `src/transport/*`，用假事件驱动，不依赖模型

证据：
```
# S1a 单元（真实 cordis，来自 app.asar）
PASS  连续 5 次调用都有返回
PASS  没有任何一次落回 unavailable（即插件确实接管了）
PASS  5 次结果都等于插件给出的 rejected  — rejected,rejected,rejected,rejected,rejected
PASS  trace 记录了 5 次接管  — trace=5
PASS  对照组：没有插件时确实回退为 unavailable  — unavailable
S1 PASS  (5/5 通过)

# S1b 加载（真实 DSH 启动流程）
$ dsh --profile s1test --dump-config | grep qq-bridge
# == dsh-qq-bridge
- id: qq-bridge
  name: dsh-qq-bridge

$ dsh --profile s1headless --patch .tmp/s1-model.yml "..."
[qq-bridge] apply() loaded; s1DefaultOutcome=rejected     ← apply() 真的跑了
dsh: ACCOUNT_SIGN_IN_REQUIRED …                          ← 卡在模型凭据，与插件无关
```
命令：`"DeepSeek Harness.exe" test/s1-waterfall.test.mjs`（Electron 当 node 跑，因为 asar 内的 ESM 只有它认）

**本片新建的两个隔离 profile**（不碰 `desktop`）：`~/.dsh/profiles/s1test`、`~/.dsh/profiles/s1headless`。要清除：删这两个目录即可回到装之前；对照备份在 `.tmp/desktop-profile-backup/`。

收敛：3/5
- frame 验收有证据：部分（S1 是 A2/A3 的前提，尚无真机链路）
- 01 五问有代码：部分（seam 一处落地；其余三层未开）
- 02 契约唯一写者：否（本片未动契约）
- `待落地` 指针：未变（本片未让任何契约落地）
- 01「不做」清单未被违反：是

返工：无

## S2 · 通道层（token / 长连 / 卡片 / 命令）· 2026-10-24

做了：
- `src/transport/auth.js`：token 缓存 + 到期前 60s 刷新 + 并发只换一次
- `src/transport/qq.js`：gateway 发现、hello→identify、心跳、事件透传、被动回复（带 `msg_id`）、指数退避重连
- `src/transport/envelope.js`：卡片渲染（只陈述事实、≤800 字、评级五词表自检）+ 命令解析（封闭集合，解析失败一律 `unknown`）
- `test/s2-transport.test.mjs`：34 条断言，全部脱网（假 fetch / 假 WebSocket）

没做：
- 真实 turn 的审批（同上，等 S3）
- 主动消息（无 `msg_id` 推送）——等真机单独验
- 队列/去重落盘（S4 的活）

下次：
- S3：把 `approval/request` 拿到的请求变成一张卡片发出去，把 QQ 的答复 resolve 回去；在隔离 profile 里用一个"假审批源"跑通（不依赖模型）

证据：
```
S2 PASS  (0 条失败)   ← 34 条断言
关键几条：
PASS  卡片不含评级词
PASS  parse("yes") → unknown        （不带 id 的 yes 不算确认）
PASS  并发取 token 仍只换一次        — 1
PASS  到期后自动换新 token           — 2
PASS  identify 带 intents            — 33554433
PASS  被动回复带 msg_id
PASS  回复打到单聊端点               — /v2/users/u1/messages
```

契约落地：`QqEnvelope` → `src/transport/envelope.js:1`（02 已更新指针）

收敛：4/5
- frame 验收有证据：部分（A25 卡片词表、A1 卡片字段已可测；真机链路待 S3）
- 01 五问有代码：部分（L4 落地；L1 有 S1，L2/L3 未开）
- 02 契约唯一写者：`QqEnvelope` 已落地且唯一写者成立（仅 `envelope.js` 构造信封）
- `待落地` 指针：`QqEnvelope` 已更新，其余保持
- 01「不做」清单未被违反：是

返工：无

## S3 · 接缝 ↔ 通道闭环（真机）· 2026-10-24

做了：
- `src/core/wait-point.js`：`WaitPoint` 内存版（open/resolved/expired/dropped，只有 open 接受答复）
- `src/app/bridge.js`：卡片发送、入站命令路由、答复绑定、`yes <id>` / 选项序号两种答复路径
- `lib/index.js`：配了 `transport` 时把 `approval/request` 委托给 Bridge；否则退 S1 行为
- `test/s3-loop.mjs`：合成一次审批，走**真 token、真长连、真单聊**

没做：
- 落盘、去重计数、重连后的补发（S4）
- 提问型（text）答复、`/why`、`/say`（S5/S6）
- 主动消息兜底：现在没有 `msg_id` 时直接判 `unavailable`；实测主动消息可用，S4 改成兜底路径

下次：
- S4：`state.json` 原子写 + 投递去重（同 requestId 24h ≤3）+ 重启后待答点作废（A13）
- 顺带把"没有被动窗口 → 用主动消息"接上，去掉 S3 的临时限制

证据：
```
ready。请在 QQ 里给机器人发一句：go
收到你的消息，发起一次合成审批 …
[qq-bridge] 已发送 ROBOT1.0_…          ← 卡片真的发出去了
[qq-bridge] 卡片已发 wp-1，等待回复…
[qq-bridge] 答复 wp-1: 批准 (ok)       ← 你回 "1" 之后立刻命中
outcome = allowed   耗时 = 8758ms      ← 含你打字的端到端时间
waitpoint = {"id":"wp-1","status":"resolved","answer":"批准"}
S3 PASS
```
补充：`8758ms` 是"发卡片 → 你回 → resolve"的墙钟时间，主体是你回话的延迟；答复命中到 resolve 是毫秒级（日志同一行）。frame A2 的"≤5s"说的是后者，S4 会单独测它。

契约落地：`WaitPoint` → `src/core/wait-point.js:1`（02 已更新指针）；`Answer` 仍未落地（只实现了 option/confirm 两条路径，text 路径在 S5）

收敛：4/5
- frame 验收有证据：部分（A2 机制已真机跑通；A9/A10/A13 未做）
- 01 五问有代码：部分（L1/L4 落地，L2/L3 雏形）
- 02 契约唯一写者：`QqEnvelope` / `WaitPoint` 各一个写者，属实
- `待落地` 指针：`WaitPoint` 已更新；其余保持
- 01「不做」清单未被违反：是（未做 `/say`、未做 L2）

返工：无

### S3 复查：一个被"PASS"掩盖的缺陷（2026-10-24）

你在真机上发现"回复之后没收到确认消息"。查下来：`Bridge.send` 对同一条入站消息永远发 `msg_seq=1`，
而 QQ 把 `msg_id + msg_seq` 相同的回复当重复**静默丢弃**（HTTP 仍 200）。所以卡片到、确认不到。

- 修：按 `msg_id` 记账、逐条递增，用满 4 次转主动消息（`src/app/bridge.js`）
- 回归：`test/s3-seq.test.mjs`（6 条断言，盯的就是这个坑）
- 重跑真机：两次发送拿到两个不同的消息 id，`outcome = allowed`

教训（写进下一片的验收集）：S3 的判据只断言了 `outcome`，**没断言"你确实看到了消息"**。
本片之后，凡"发出去了"的验收，必须带一条真机可见性检查，否则 HTTP 200 会冒充成功。

### S3 复查 2：`yes <id>` 的语义收紧（2026-10-24）

你指出"`yes <id>` 不是只在不可逆时才带吗"。查下来是我把两件事做混了：
**接受**（解析器两种都认）和**要求**（只有被标注的请求才强制）。之前卡片对两种请求都提示 `yes <id>`，
等于把这个标记稀释成装饰。

现在：

| | 普通请求 | 被标注请求 |
|---|---|---|
| 卡片提示 | `1` 批准 / `2` 拒绝 | 只提示 `yes <id>`，不提示 1 |
| 回 1 | 生效 | **不受理**，回"要批准请回 yes wp-N" |
| 回 yes <id> | 生效（不主动提示） | 生效 |

回归：`test/s3-label.test.mjs`（8 条断言，含"被标注时回 1 后状态仍为 open"）。

实现注记：`LabelPolicy` 尚未落地，本片用 `request.reversible === false` 当代理；LabelPolicy 落地后
换成三条判据（`sandbox_permissions` / 工具白名单 / 工作区外写），此处的行为断言不变。

## S4 · 落盘 / 去重 / 重启作废 · 2026-10-24

做了：
- `src/core/store.js`：单文件 JSON + 原子写（临时文件 + rename）；坏文件改名留证、不崩
- `Bridge#loadState`：启动时把上次残留的 `open` 全部改成 `dropped(restart)`，并给一条"我重启过"的通知（A13）
- `Bridge#allowPush`：同一 `callId` 24h 内最多推 3 条，第 4 条直接丢（A6）
- 主动消息兜底：没有被动窗口时改走 `sendProactive`（此前是直接判 unavailable）

没做：
- 真正的"提醒节奏"（10 分钟首发、30 分钟升级）——现在只在每个新请求上推一次，§7 D4 的节奏属于 S5/S6
- 提问型（text）答复、`/why`、`/say`

下次：
- S5：把 `user-questions/request` 也挂上，支持自由文本答复（contract `Answer.text`），再补 `/why` 的只读旁路会话

证据：
```
PASS  状态文件里有一条待答点 — 1
PASS  落盘状态是 resolved
PASS  没有残留临时文件
PASS  重启后 open 待答点变 dropped — dropped
PASS  通知里不声称"待决 N 条" — 我重启过。上次非正常结束时，有 1 个待答请求已作废（不会重放），请重新触发。
PASS  同一 callId 24h 只推 3 条 — 3
PASS  第 4 次被判 unavailable
PASS  没有 msg_id 时走主动消息 — proactive
PASS  坏文件被容忍 / 被改名留证
S4 PASS  (13 条断言)
```

过程中修的两个问题（都在测试里暴露的，属实现跑偏，已就地改）：
1. `#persist` 只写内存里的 `points`，而重启恢复的那条从未进 `points` → 落盘把历史抹成空。修：`WaitPointStore.restore()`
2. bridge 的超时定时器是 `unref` 的，测试里没有别的事件源时进程会直接退出。修：测试自己撑住事件循环（生产上 unref 是对的，不拖住进程）

契约落地：`Delivery` → `src/app/bridge.js:158`（计数）/ `:199`（闸门）；`WaitPoint` 的落盘在 `src/core/store.js`

收敛：4/5
- frame 验收有证据：A6、A13 已可断言；A9/A10 仍未做
- 01 五问有代码：L1/L3/L4 已落地，L2 雏形
- 02 契约唯一写者：`Delivery` / `WaitPoint` / `QqEnvelope` 各一个写者，属实
- `待落地` 指针：`Event` / `SeamOutcome` / `Answer` / `LabelPolicy` 仍未落地（S5/S6 补）
- 01「不做」清单未被违反：是

返工：实现跑偏（两处，见上），已就地重写那一小段

## S7 · 提问接缝（自由文本）· 2026-10-24（原记作 S5，与 01 的 S5=`/say` 冲突，已重编号）

做了：
- `lib/index.js` 挂上第二条接缝 `user-questions/request`，委托给 `bridge.handleQuestion`
- `bridge.handleQuestion`：单问题 → 发卡片 → 等答复 → 组装成 DSH 要的 `{ answers: [{ id, selected, custom? }] }`
- `bridge.answerWithText`：非命令文本直接当答案（自由文本进 `custom`）
- `renderQuestionCard`：问题 + 带序号的选项 + "也可以直接打字"
- 选项型答复按 `selected` 回，自由文本按 `custom` 回

没做：
- **多问题请求**：直接返回 `undefined` 让位给桌面 UI（多题要逐题作答与批量提交，本版不做）
- `/why` 只读旁路会话（S6）

下次：
- S6：`/why` → 起只读 headless 会话查现场 → 结论 + 依据回 QQ；同时把 `LabelPolicy`（三条判据）接上

证据：
```
PASS  卡片含问题 / 含带序号的选项 / 允许自由文本 / 无评级词
PASS  序号 2 → selected ["B"]        — {"id":"q1","selected":["B"]}
PASS  自由文本进 custom              — {"id":"q2","selected":[],"custom":"用 B 方案，但先备份"}
PASS  多问题请求让位（undefined）
PASS  超时后返回 undefined（不伪造答案）
PASS  待答点 expired
S5 PASS  (12 条断言)
```

设计取舍（写清楚，免得以后当成 bug）：**多问题让位**。桥接是"第二个 answerer"，
返回 `undefined` 会走 `next()`；桌面开着就由 UI 答，桌面不在就报 `NO_PROVIDER`——
这比"只答第一题、其余静默跳过"诚实得多：后者会让 agent 以为另外几题被明确跳过。

契约落地：`Answer` → `src/app/bridge.js:173`（text）/ `:185`（question 映射）

收敛：4/5
- frame 验收有证据：A21（L2 结论作自由文本答复的前提）已具备；A9b 仍未覆盖
- 01 五问有代码：L1 两条接缝齐、L2/L3/L4 落地
- 02 契约唯一写者：`Answer` 唯一写者是 router，属实
- `待落地` 指针：剩 `Event`、`SeamOutcome`、`LabelPolicy`
- 01「不做」清单未被违反：是（未做 `/say`、未做多问题）

返工：无

## S6 · 审批请求带不带参数（结论：不带）+ 标注判据落地 · 2026-10-24

做了：
- **S6 探针**：读 `dsh-tools/lib/index.js:3551` 的调用点 + `dsh-user-approval:130` 的落库，
  确认请求体是 `{agent, toolName, callId?, reason?, displayReason?, signal}` —— **没有 args**
- `src/core/label.js`：`LabelPolicy` 三条判据 + `findToolArgs(session, callId)` 反查
  （参数来自会话 `tool/call` 事件的 `arguments`，见 `dsh-agent-loop:682`）
- `bridge.handleApproval` 改用 `classify()`，`labeled` 不再用 `reversible` 代理；卡片参数从反查结果来

没做：
- `/say`（S5）
- `Event` 落地、`audit.js`
- 真机验证标注：只做了脱网

下次：
- S5 `/say`
- 补 `Event`（seam 现在直接传 request）与审计

证据：
```
PASS  参数含 sandbox_permissions → escalation
PASS  命中白名单 → whitelist
PASS  写工作区外 → true / 工作区内 → false / 读工具不因路径被判不可逆
PASS  只看路径键，不扫内容
PASS  按 callId 反查到参数 — {"path":"C:\Windows\x.txt"}
PASS  查不到返回 undefined（卡片显示"未附"）
S6 PASS  (12 条断言)
```

连带修正：`s3-label` 的两个用例改成用提权信号触发标注（原用 `reversible:false`，那是代理期的写法）。

契约落地：`LabelPolicy` → `src/core/label.js:1`

收敛：4/5
- frame 验收有证据：A11 从"⚠ 代理"升到"✅ 三条判据（脱网）"
- 01 五问有代码：L1/L2/L3/L4 均有实现；L2/L3 仍合在一个文件
- 02 契约唯一写者：`LabelPolicy` 写者是 router，`classify` 只在 `label.js` 构造，属实
- `待落地` 指针：剩 `Event`（`SeamOutcome`/`WaitPoint`/`Answer`/`Delivery`/`QqEnvelope`/`LabelPolicy` 均已落地）
- 01「不做」清单未被违反：是

返工：假设（"审批请求带参数"这个前提没验就用它设计了三条判据；S6 把假设变成事实后，判据改为反查，ADR-22）

## S5 · `/say` 续接已停会话 · 2026-10-24

做了：
- `bridge.startSay(text)`：无绑定会话 → 拒绝；有 open 待答 → 先让你处理它；否则回显
  「将要发送 / 上次停在：…」并要求确认
- `bridge.resolveAnswer` 增加 `kind === 'say'` 分支：`1` 注入、`2` 取消
- `userMessage(text)`：构造 `{content:[{type:'text',text}], source:{kind:'user-say'}}`
- `lastStop(session)`：从会话尾部找 `turn/end`，作为"上次停在哪"
- `boundAgent`：接缝第一次收到请求时记下，`/say` 只发给它（结构上不能新建会话）

没做：
- **真机注入未验证**：`agent.inject()` 的 `UserMessage` 形状是从审批策略变更那处用法推断的，
  没有在真实 turn 上跑过。S5 的判据（"停 2 小时后 `/say`，回答能引用停前细节"）**因此没有验到**。
- `/why`、`/list`、`/progress`、`Event`、`audit.js`

下次：
- 真机验 S5：在 desktop profile 上装一次，停 2 小时再 `/say`
- 补 `Event` 与 `audit.js`

证据：
```
PASS  没有绑定会话时不注入
PASS  先回显内容与上次状态
PASS  确认前不注入
PASS  回 1 后注入一次 / 注入的就是原文本 / 待答点 resolved
PASS  回 2 不注入 / 取消后 dropped
PASS  有待答时不创建 say 待答点
S5-say PASS  (11 条断言)
```

**诚实标注**：这是"代码路径通了"，不是"功能验过"。注入的真实效果（上下文是否连贯、
turn 是否真的新起）必须等真机——这是 S5 的判据本身，不能靠假 agent 冒充。

收敛：3/5
- frame 验收 A22/A23 有代码但**无真机证据**
- 01 五问：L1 三条接缝齐（审批/提问/注入），L2/L3 仍合在一个文件
- 02 契约：无新增；`Answer.via` 的 `say` 值已用上
- `待落地`：仍剩 `Event`
- 01「不做」清单：**边界被推动**——X4 说"不新建会话"，实现只允许向已绑定会话注入，未越界

返工：无

## S8 · Event 落地 + 审计 · 2026-10-24

做了：
- `src/core/events.js`：`Event` 契约落地（kind 封闭四值、approval/question 必带 requestId、turn 必带 turnId；
  `approvalEvent` / `questionEvent` 是 seam 侧唯一构造入口；bridge 用 `unwrap()` 兼容裸 request）
- `src/app/audit.js`：JSONL 追加写，五字段（requestId / openid / at / card 快照 / evidenceViewed）+ 180 天 prune
- 答复（选项与文本两条路径）都写审计，且记录**当时的卡片原文**

没做：
- `evidenceViewed` 恒为 false（`/why` 未实现）
- seam 迁移未完成：`lib/index.js` 仍传裸 request，靠 `unwrap` 兜
- `/why`、`/list`、`/progress`

证据：
```
PASS  kind 是封闭四值 / 未知 kind 抛错 / approval 缺 requestId 抛错 / turn 缺 turnId 抛错
PASS  两条记录 / 含 requestId·openid / 含卡片快照 / 含 evidenceViewed / 一行一条 JSONL
PASS  过期记录被 prune 掉 — 1
PASS  答复后写了审计 / 审计里有当时的卡片原文 — [wp-1] 需要你批准：fs.read / 有 openid
S8 PASS  (15 条断言)
```

契约落地：`Event` → `src/core/events.js:1`

收敛：4/5
- frame 验收：A26（审计五字段）有代码与断言；A25 仍只有卡片词表
- 01 五问：新增 L2 的 events/audit 两块，L2/L3 仍在同一文件
- 02 契约唯一写者：`Event` 只在 `events.js` 构造，bridge 只读
- `待落地`：**全部落地**（七个契约都有指针）
- 01「不做」清单未被违反：是

返工：无

## S9 · 会话盘点修正 + v6 决策落地准备 · 2026-10-24

做了：
- **归档判定改用权威字段**：`~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds`。
  之前"`agentPreset` 为空 = headless 会话"的推断是**错的**——那两条其实是被归档的。
- `/list` 现在：全部非 subagent、非归档会话，跨工作区；每行「标题｜多久以前｜状态｜项目」。
- frame v6 已签（<signer>）：D15 `/wake`、D16 `/new`（限已知工作区）、D17 每工作区每天 ≤3、X4 → X4′、A31–A33。
- API 探针（只读）：`createSession({ cwd, agentPreset?, sessionId? })`、`createAgent(ownerCtx, { sessionId | resumeSessionId, seed?, meta?, agentOptions? })`
  —— 两条路都存在。

没做：
- **`/wake` 与 `/new` 未实现**。卡点不是 API 不存在，而是：插件里怎么拿到 `ownerCtx` 与 session/agent 服务
  （`ctx.get('sessions')` 还是别的名字）还没确认。猜错会写出"看起来成功、其实没挂上"的代码，所以先停在这里。
- A31–A33 因此无证据。

证据：
```
含归档: 7   不含归档: 5
 - 将 DeepSeek harness 接入 QQ 机
 - 询问助手身份
 - 安装requirement-framing等技能
 - (无标题) ×2
```
九套测试仍全绿（S2/S3/S4/S5/S5-say/S6/S8）。

收敛：3/5
- frame 验收：A31–A33 未实现（v6 刚签）
- 01 五问：L1 有三条接缝，但"会话管理"仍缺一个入口
- 02 契约：无新增
- `待落地`：全部落地，但 v6 的三条验收没有对应实现
- 01「不做」清单：X4 已被 X4′ 替换（frame v6），代码尚未跟进

返工：假设（`agentPreset == null` 当 headless 标记；其实那是归档。已改读 `archivedSessionIds`）

## S12 · 咨询通道（D18/D19）+ S13 · 咨询会话隐藏（A36）· 2026-10-24

做了：
- `/why <id|序号> <问题>`：按目标会话 id 起一条**普通会话**（可写，D19）作为咨询通道；同 id 复用，保留上下文
- 答话中继：订阅 `session/event`，累积 `assistant/message` 的文本，到 `turn/end` 一次性回传 QQ（不碎片轰炸）
- `/done <id>` 与 **300s 无追问**两条结束路径，都回话且带"会话 id + 轮数 + 原因"（A35）
- **A36**：咨询会话 id 落盘进 `state.consults`，`/list` 永久排除它们
- D21 全命令化：`/ans <id> 1`、`/ans <id> 文本`、`/yes <id>`、`/no <id>`；裸文本一律只回状态提示

没做：
- 真机验证（S5 /say、S10 /wake、S11 /new、S12 /why 全部只在假服务上验过）
- 发布闸门（黑盒用例、冒烟、评审、人确认）

证据：
```
S12 PASS  (9 条断言：投递 / 答话回传 / 同 id 复用 / 无第二条通道 / 手动结束带轮数 / 通道移除 / 可再起)
S13 PASS  (3 条断言：咨询会话 id 落盘 / 不出现在 /list / 建之前 /list 干净)
十三套测试全绿，failing suites: 0
```

过程中的两次事故（都是"整段替换代替精确编辑"）：
1. 替换 `resolveAnswer` 时删掉了 `/say` 的确认分支 → 点发送无效果；已补。
2. 替换 `envelope.js` 时连 `renderCard`/`renderQuestionCard` 一起删掉 → `renderCard is not a function`；已补。

收敛：4/5
- frame 验收：A34/A35/A36 有脱网证据；A19′（写操作进审计）**未验**——咨询会话的写操作现在只靠它自己的会话日志，还没把"改动文件数"回话里
- 01 五问：L1 五条命令齐、L2/L3 仍合在一个文件
- 02 契约：无新增
- `待落地`：全部落地
- 01「不做」清单：X4′ 未被违反（咨询会话在已知 cwd 内建）

返工：实现跑偏（两处误删，见上）

## S14 · 空转与停滞通知（A24/A30）· 2026-10-24

做了：
- `trackActivity`：从 session/event 记每个会话的最后活跃时间与 turn 开关
- turn/end → 发一次「它停了，等你下一句」（同一轮不重复）
- 定时器 60s 调 `tick()`：turn 未结束且 10 分钟无输出 → 停滞提醒；30 分钟 → 升级为「可能卡住」
- 所有提醒 `unref`，不拖住进程；测试直接调 `tick()` 免等真时间

证据：
```
S14 PASS (7 条)：10 分钟提醒 / 同轮不重复 / 30 分钟升级 / turn 结束报空转 / 重复 turn-end 不重复
十四套测试全绿，failing: 0
```

收敛：4/5
- A24/A30 有脱网证据；真机未验
- A19prime 仍未做（咨询写的文件数没回话）

返工：无

## S16 · 进度查询 /progress（A3）· 2026-10-24

做了：
- `/progress [id|序号]`：报告 turn 状态、待答点数量、最近 5 条事件（含工具名）、下一步建议
- 未绑定 → 提示先 /use；未加载 → 提示先 /wake（不假装能查）

证据：
```
S16 PASS (6 条)：未绑定提示 / 状态 / 待答点数量 / 最近事件含工具名 / 带 id / 未加载报错
十六套测试全绿，failing: 0
```

收敛：4/5（frame A3 有脱网证据；真机未验）

返工：无

## S17 · 迟到与乱序答复（A9a/A10）· 2026-10-24

做了：
- 审批请求的 `signal` 中止 → 待答点 `expired`，`handleApproval` 返回 `cancelled`（A9a）
- 已结束/已作废的答复：回话区分原因（失效 / 作废+原因 / 已处理），并明确「没有被采纳」（A9a/A9b/A10）
- 乱序防串台：答复只按显式 id 命中，另一个待答点保持 open

证据：
```
S17 PASS (7 条)：signal→cancelled / 标 expired / 迟到答复失效 / 指定 id 命中 / 另一个仍 open / 第二个正常 / 超时作废被拒
十八套测试全绿，failing: 0
```

返工：无

## S18 · 看门狗（A14）· 2026-10-24

做了：
- `QQClient.recoverIfStale()`：超过 2 个心跳周期没收到任何帧 → 认定「活着但不回话」→ 主动断开让重连接手
- 重连成功发一次 `recovered`，桥接回一句「我重连过（连接曾无响应）」
- 插件侧每 10s 检查一次（unref）

证据：
```
S18 PASS (5 条)：未超周期不触发 / 超周期触发 / 触发重连 / 重连后 recovered / 状态经 READY 恢复
```

收敛：4/5（A14 有脱网证据；真机未验）

返工：无

## S19–S21 · 退出通知 / 断网摘要与鉴权 / 咨询降级 · 2026-10-24

S19（A17）：`sayGoodbye()` 退出前发一条「我下班了（桥接退出）」，最多等 3s，不阻塞退出；无白名单时不假装发。
S20（A4/A5）：发送失败累计计数；重连 ready 后**只发一条摘要**（「断网期间有 N 条没送达，最早 …」），不逐条重放；非白名单消息零回应。
S21（A27a）：标注请求 + 咨询不可用 → 卡片如实标「现场暂不可查：咨询不可用」，且**照常允许 /yes 批准**；审计新增 `evidenceMissing` 字段。

证据：
```
S19 PASS (4) / S20 PASS (6) / S21 PASS (4)
二十一套测试全绿，failing: 0
```

收敛：4/5（均脱网；真机未验）

返工：无

## 黑盒用例集（发布闸门 ①）· 2026-10-24

设计员（新 agent，只给 frame + 交互面，禁止读源码）产出：84 条（可执行 79 / 挂起 5），A1–A36 全覆盖，七维无整维空缺，负例与异常态约四成。
评审员第 1 轮：不通过，阻断 9（缺夹具章、无出处断言、主观谓词、未定义命令计入、日志轮转零覆盖、启动耗时无基线、frame 未签）。
设计员返工：8/8 已改，新增 FQ-0～FQ-12 夹具章 + 执行窗口表 + 四类标识表。
评审员第 2 轮：仍不通过，阻断 2（均为返工新造：FQ-0 与 8 天长跑互斥、14 条用例快照号无出处、BB-24 缺待答点夹具；BB-58 在 k=1 时永判假）。

状态：用例集未冻结。按流程（最多 2 轮）已交人裁决：
- 选项 A：破例再走一轮修订+复核
- 选项 C：带 R1/R2 继续跑其余 82 条，三条结论标注不可信
另：B9 为冻结前置——frame v7 未签（首行仍待签、签字块版本 6）。

证据：docs/build/qq-bridge.blackbox.md（用例 + 两轮评审节）

返工：验收不可测（评审两次打回的都是用例集可判定性问题）

### 用例集冻结 · 2026-10-24

- 人类特批第 3 轮；评审关闭核验：R1(2) 已关闭，**全量复算 20/20 行可由 FQ-2 推出**，末行 `状态：已冻结（可用例集，2026-10-24）`。
- 冻结对象：84 条（可执行 79 / 挂起 5），A1–A36 全覆盖。
- frame 已补签 v7（<signer>，2026-10-24，状态：已签）。

执行前置（未完成）：
1. `node tools/bb-reset.mjs` —— 复位夹具（已备好工具）
2. **重启 DSH 加载最新插件** —— 当前进程里的插件是数小时前的旧版，`/ans` `/why` `/progress` `/wake` `/new` 都不在其中

执行分工（预估）：
- 可脚本化约 50 条：回话文本断言、state/audit 字段断言、命令解析负例、重复推送计数
- 必须人类约 29 条：手机时延实测、GUI 观察、破坏性（断电/睡眠/强杀/断网 30 分钟）、8 天长跑组

事故记录（本轮）：机械替换污染了评审历史文本 7 处，由评审员按原文回改 4 行；与今日另外两次误删（resolveAnswer 的 /say 分支、renderCard）同源——**大范围字符串替换代替精确编辑**。

## S22–S24 · 通知噪音、消息格式、短 id（2026-10-24）

做了：
- **S22 噪音**：`#isWatched(session)` 按会话类型过滤——排除子 agent（`origin=subagent` 或 `delegationDepth>0`）、排除咨询会话；**其余真人会话一律通知，不再要求"已绑定"**（否则长任务在别的会话里跑就漏了）。
- **S23 格式**：`turn/end` 与两级停滞提醒统一抬头 `[标题 · id6]`；正文优先取本轮最后一条助手消息**首句**（去代码块/Markdown、≤80 字），取不到降级为 `工具：pwsh ×2` 这类统计；总长 ≤300 字；仍是一条消息。
- **S24 显示**：`/list` 每行加短 id（`1) 1da26d · 标题｜…`）；`cleanTitle()` 清标题尾部悬空括号；全项目统一 `shortOf(id)`（先剥 `session-` 再取 6 位），修掉 `/progress`、`/wake` 里显示 `session-` 的 bug。

证据：
```
S22 PASS (4)：未绑定真人会话仍提醒 / 子 agent 不提醒 / 咨询不提醒 / 子 agent 卡住不提醒
S23 PASS (9)：抬头含标题与短 id / 本轮时长 / 人话首句 / 降级工具统计 / 总长 ≤300 / 停滞两级同格式
S24：/list 行含短 id；23 套离线测试全绿，failing: 0
```

**流程状态（必须登记）**：以上三项是在**用例集冻结之后**改的实现。其中 S22 改变了"通知哪些会话"的语义、S23 改变了通知文案、S24 改变了 `/list` 与提示里的 id 呈现。
- 与 frame 无冲突（A24/A30 只规定时延与条数，未规定文案），**不需要重签**；
- 但**用例集的断言可能过期**：BB-14「回话含该会话 id」、BB-58「提醒含序号」等按旧文案写的条目需要一次影响核查。**黑盒执行前必须做**，否则跑出来的失败分不清是实现错还是用例旧。

返工：无（属于评审后变更，按流程登记为影响核查项）

## S25 · 卡片合并窗口（C2）· 2026-10-24

做了：
- `Bridge.mergeMs`：窗口内产生的多张待答卡片合成一条发送；窗口内仅 1 张时按原样单发。
- 生产由 `lib/index.js` 设为 **1500ms**；测试可显式设小（BB-61 用 300ms）。
- 合并消息格式：`[N 个新请求]` + 各卡片原文（`----` 分隔），每条仍带自己的 id 与命令。

证据：
```
BB-61（黑盒）：卡片条数 1（≤2）/ 3 个 id 全在 / 待答数 3（静默丢弃 0）
23 套离线测试全绿；四批黑盒 12/12、12/12、11/11、3/3
```

来源：BB-61 首次执行暴露「无合并逻辑」，违反 frame C2；本片为补缺口。

返工：实现跑偏（C2 有要求但未实现，黑盒发现）

## 文档回溯 · 2026-10-24

用 `tools/audit-docs.mjs` 把「已签 frame（v7）」与「当前实现」对了一遍，结论如下。

**没有发现"违背已签需求"的改动。** 发现 2 处**新增**（超集）与 5 处文档滞后，已处理：

| 项 | 性质 | 处置 |
|---|---|---|
| `/doctor` 命令 | 扩展了 D21 的**封闭命令集** | 已补 02（命令集 + 版本 v3）、01 §8、03 ADR-24；**需签字人确认**（新增而非修改） |
| 通知正文 `[标题 · id] + 本轮摘要` | 超出 A24 的文案约定 | 已补 01 §8、03 ADR-27；**需签字人确认** |
| `/use`、`/wake`、`/progress`、`/say`、`/why`、`/done` 接受短 id | 参数放宽（序号仍可用），原需求未禁止 | 03 ADR-25 登记 |
| 卡片合并窗口 1500ms | 兑现 C2；A1 的 ≤10s 仍满足 | 03 ADR-26 登记 |
| 01/02 未记录 /doctor、合并、resolveAgent、短 id | 文档滞后 | 01 §8 补记、02 命令集更新到 v3 |
| bug 级不一致（`/list` 页脚把 `/say` 状态说反、确认文案教用户发裸 `1`、`/say` 吞 id） | 文案错误，非需求 | 已在 S31 文案检查中修正并加静态断言 |

**两处新增已获确认**（人类原话「确认」，2026-10-24）：已写入 frame 的 `## 偏离`，依据 ADR-24 / ADR-27。

**需求级判断**：`/doctor` 与通知文案是**加功能**，不是改需求；`frame` 的验收条目（A1–A36）无一被削弱或删除。两项新增仍建议你在下次签 frame 时一并确认（或现在口头确认，我记入 `## 偏离`）。

工具：`tools/audit-docs.mjs`（只读，可重复跑）；本次跑出 13 条，其中 3 条是脚本自身的误报（`/use`/`/yes`/`/no` 的匹配规则写得太粗），已在阅读时排除。

返工：无

## D17 数值调整 · 2026-10-25

- **变更**：`/new` 的每工作区每日上限 3 → **10**；同时做成可配置项 `newPerWorkspacePerDay`（默认 10），由 `lib/index.js` 注入。
- **授权**：人类原话「默认值先改为10」；已写入 frame 的 `## 偏离`。
- **不动**的部分：D16（只在已知工作区新建）、D17 的"超过则拒绝并告知"语义、与 A6 推送计数分开记。
- **背景**：调试当天 3 个名额用尽，`/new` 被正常使用挡住；上限的原始目的是防"盗号批量建会话"，不是防调试。

证据：`S11 PASS`（配额逻辑用显式 3 测，与新默认值解耦）；33 套离线测试全绿。

返工：无

## 事故与恢复 · 2026-10-25

**事故**：用"整段切片替换"修双通道时，起始标记在文件里出现两次，切片跨越了 700 余行，`src/app/bridge.js` 从约 40KB 掉到 22.6KB，`startSay` / `handleApproval` / `progress` / `ask` 等 30 余个方法被物理删除。项目当时**无 git、无备份**。

**恢复方式**：从会话日志的 657 个 zstd 帧里解出 57 个 `edit` 事件的 old/new 原文，配合 `.tmp` 里 75 个历史补丁脚本（各含字面源码）逐字重建，再用测试校形。当前 1427 行、方法无重复（R9 实测）。

**止损**：`git init` + 三次快照提交；`.env`（含 AppSecret）移出版本库。

## 评审收敛（R1–R8）

| 轮次 | 阻断 | 主要命中 |
|---|---|---|
| R1 | 9 | 去重键共桶、GUI 兜底 unavailable 被当答复、卡片 `/why wp-N`、提问接缝无 next、`/say` 先要求绑定、提问收 `/yes`、审计字段、序号未过滤咨询、被动窗口无校验 |
| R2 | 8 | 上述多数"部分关闭" + GUI 先答无审计不落盘、审计不守恒、测试基线不实 |
| R3 | 6 | **R2 修复引入回归**（`const` 重赋值 → 提问通道必崩）、`whyTarget` 未进 renderCard、提问侧缺落盘、审计仍 2 条、基线 40/42 |
| R4 | 2 | 审计守恒（先结算再回执）、`bb-batch5` 断言写错 |
| R5 | 1 | "GUI 解析后手机票晚一个微任务"仍 2 条审计；测试没锁住修复 |
| R6 | 1 | `/yes` 票在迟到分支被映射成 `rejected`（漏判 'yes'）；s42 未真正进入 GUI 分支 |
| R7 | 0 | **可交接**；残留：s43 只锁函数未锁调用点 |
| R8 | 0 | 独立复核通过；变异验证 s44 是调用点唯一锁；47 套 / 405 断言全绿 |

**教训（写入流程）**：
1. 大范围字符串/切片替换是事故源——改代码前先复制文件或提交；
2. 声称"N 套全绿"必须逐套单跑并收集失败项，不能取循环最后一行；
3. 修 bug 后必须问"这条修复有测试锁吗"——R5/R6 两次都是"代码修了、测试没锁"；
4. 接口先读 schema 再写（`resume`/`create`/`inject`/`session/title` 四次踩坑，最后一次写坏了会话日志）。

## 更正与文档校验 · 2026-10-25

**更正 1（/doctor）**：上文「文档回溯」一节把 `/doctor` 记为"已补进 02 命令集 v3"。实际上 `/doctor` 随后按用户要求**整体删除**（解析、分派、方法、文档痕迹）。历史记录保留，此处更正为准：**当前命令集不含 `/doctor`**。

**更正 2（审批词表）**：审批结局一直是 `allowed`，而 DSH 只认 `allowed-once`。这意味着在此前所有真机验证里，**两条通道的"批准"都没有真正生效**（GUI 的 allowed-once 被归一成 rejected，手机的 allowed 被归一成 unavailable）。已在 2026-10-25 修复并加锁（`s45`/`s49`）。因此，早先台账里"round-trip outcome=allowed"的记录只能说明桥接内部闭环，不能说明 DSH 放行。

## 文档校验（frame v7 ↔ 实现）

对照 `docs/frame/qq-bridge.md` 的 A1–A36 与 D1–D21：

| 项 | 状态 |
|---|---|
| A1–A36 | 全部有实现落点；其中 A1/A2/A3/A6/A8/A29 等**时延与次数类**证据仅来自脱网测试或假时钟，**真机未测** |
| D15 `/wake` | 已改 `resolveAgent`，真机验证通过（用户确认能唤醒） |
| D16 `/new` | 改 `workspaceId` 后归入工作区；真机验证通过 |
| D17 上限 | 3 → 10（`## 偏离` 有记录，授权原话在案） |
| D18/D19 咨询 | 复用、300s 超时、可写；新增"按 workspaceId 创建 + 命名 + `/done` 后归档"（ADR-28/29，`## 偏离` 记 A36） |
| D20 `/say` | 显式 id 优先、`followup` 投递；真机验证通过 |
| D21 全命令化 | 裸数字无路由；`s33` 锁住"提示语不得引导裸数字" |

**偏差清单（均为"加功能/放宽"，无"削弱验收"）**：`/doctor`（已删）、通知文案扩展（ADR-27）、卡片合并窗口（ADR-26）、短 id（ADR-25）、配额 10（偏离）、咨询会话命名与归档（ADR-28/29 + 偏离）。

**仍未验证（真机）**：A1/A2 时延、A8 每日预算、A14 看门狗、A24/A30 通知的真实到达、8 天日志轮转（A26）、断电/睡眠类（A12/A13/A16）。

## QQ 官方频率与时效规则核对 · 2026-10-25

来源：[QQ 机器人官方文档 · 消息收发概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)（页面标注更新于 2026-07-21，抓取于 2026-10-25）。

### 官方数值

| 项 | 官方值 |
|---|---|
| 单聊被动消息有效期 | **60 分钟** |
| 单聊每条消息可回复次数 | **4 次** |
| 群聊被动 | 5 分钟 / 5 次 |
| 单聊主动消息 | **1000 条/人/天**；单关系 20 条/分；未认证机器人 Bot 维度 5/qps 且 30/qpm |
| 去重规则 | 相同 `msg_id + msg_seq` 重复发送会失败，递增 `msg_seq` 可多次回复 |
| 互动召回消息 | `is_wakeup=true`，30 天内 4 个周期、每周期 1 条 |
| 撤回 | 自己发出的消息 **2 分钟内**可撤回 |

### 与实现的对照

| 我们的实现 | 官方规则 | 结论 |
|---|---|---|
| 窗口判定 55 分钟 | 60 分钟 | ✅ 一致（刻意留 5 分钟余量） |
| `used < 4`（最多 4 次回复） | 4 次 | ✅ 一致 |
| 按 `msg_id` 的到达时刻算窗口，而非"最后收到消息的时间" | 有效期从该条消息起算 | ✅ 一致（B9 修复后） |
| 被动发送失败 → 改主动消息 | 平台会拒超窗的被动回复 | ✅ 合理兜底 |
| 主动消息日预算 ≤10 / ≤50 | 平台 1000/天 | ⚠️ **我们比平台严得多**，属自我限流；已在 frame A8/Q9 注明，避免误读为"平台只允许 10 条" |

### 需要更正的两处认知

1. **"主动消息有配额所以通知要省着发"——方向对，但数量级错了。** 平台的 1000 条/天意味着真正的稀缺资源不是配额，而是**人的注意力**；我们的 10 条/天是自设的礼貌线，不是平台限制。
2. **未认证机器人的 30 条/分钟**是更容易撞的墙（Bot 维度）。真机上如果短时间连发多条（例如一次任务连开多张卡片），可能先撞这个限制，而不是每日额度。

### 未采纳但可行的官方能力

- `is_wakeup=true` 的**互动召回消息**（30 天 4 个周期）：适合"任务完成后很久没动，再提醒一次"，比主动消息更合规；
- **2 分钟内撤回**自己发的消息：如果另一端先答复，可以把手机上那张过期卡片撤回，减少误导（需要记录发送后的 `message_id`）。

返工：无（实现与官方一致；仅文档措辞与注释修正）

## 不可逆动作检查

本片无不可逆动作（只写工作区内的文件）。首个需要"怎么回去"的动作是 S1b 的 profile 安装：
- 回去方式：`2（能重放）` —— 删掉新建的 `s1test` profile 目录即回到装之前；不触碰 `desktop` profile
