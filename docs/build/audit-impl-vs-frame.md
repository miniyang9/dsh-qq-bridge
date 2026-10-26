# 实现 vs 需求 全量审计

- 审计日期：2026-10-25
- 权威需求：`docs/frame/qq-bridge.md`（已签，v7 + 三条 2026-10-25 偏离）
- 辅助：`docs/arch/qq-bridge/{01,02,03}.md`、`docs/build/baseline.md`
- 审计对象：`lib/index.js`、`src/app/{bridge,audit,log}.js`、`src/core/*`、`src/transport/*`、`test/*.mjs`
- 约束：只读审计，未改动 `src/`、`lib/`、`test/`

## 总评

| 结论 | 条数 |
|---|---|
| 符合 | 40 |
| 部分符合 | 31 |
| 不符合 | 2 |
| 未实现 | 3 |
| 无法离线判定 | 0 |
| **合计** | **76** |

分组：A（A1–A36，按 frame 的 A9a/A9b/A19′/A27a/A27b 拆开）共 38 行 = 符合 14 / 部分 20 / 不符合 1 / 未实现 3；D1–D21 共 21 行 = 符合 15 / 部分 5 / 不符合 1；W1–W10 = 未违反 4 / 部分违反 6；X1–X7 = 未违反 7。

一句话总评：**"能跑通的主干"都在（卡片/答复/双通道/审计/咨询/续接/门控/分片），但签约时承诺的四类东西仍然缺席或名不符实——进程守护与自启（A7/A16/D8）、中断域（A12/A13 只做了 1/4）、打扰上限与开关（A8/D5）、以及 L2 的 60s 超时/失败降级（D12/Q16、A20）**；此外有 2 处"测试假绿"（`/new` 标题事件缺字段、S1 探针已失效）会把真实故障藏起来。

---

## A 表（A1–A36 逐条）

| 编号 | 结论 | 证据 | 一句话说明 |
|---|---|---|---|
| A1 | 部分符合 | `src/transport/envelope.js:renderCard`；`src/app/bridge.js:1525-1542`；`src/core/label.js:findToolArgs`；`test/s2-transport.test.mjs:23-42`、`test/s51-card-progress.mjs:11-31` | 七要素齐（id/工具名/reason/参数或"未附"/影响范围/可撤回/`/why`），但被标注请求固定渲染"可撤回：否"（`bridge.js:1535`，复活了已作废的 ADR-19 reversible 代理），字段值不可信；≤10s/≤30s 无断言。 |
| A2 | 部分符合 | `bridge.js:resolveAnswer:529-546`（`points.answer` 同步 resolve）、`audit.append`；`test/s4-state:48`、`s3-label`、`s45-outcome-vocab` | 结局是 `allowed-once`，审计条目含 openid/requestId/at；但运行日志（`log.js`）出站行不带 openid/requestId（`bridge.js:1759` 只传 dir/kind/detail），且"≤5s"从未单独计时（台账自述端到端 8.7s，含人打字）。 |
| A3 | 符合 | `bridge.js:progress:646-680`；`test/s51:33-46`、`s16-progress` | 返回状态+待答 N+最近 5 条事件（带 `ev-<seq>`），长度自然 ≤800；"最近 5 条"只取白名单事件类型（`bridge.js:669`）。 |
| A4 | 部分符合 | `bridge.js:218-230`（ready 断网摘要 / recovered 重连提示）、`send:1762-1765` 失败计数；`test/s20-offline:19-26` | 有"1 条摘要"路径，但真实重连会先 `recovered` 再 `ready`，失败发送>0 时两条都会发；没有离线队列，只有计数（01 §3 自认"无逐条重放"）。 |
| A5 | 符合 | `bridge.js:onEvent:300-303`；`test/s20:28-32` | 非白名单只写日志、不回复任何内容（与 W7"拒绝且不回显"一致）。 |
| A6 | 部分符合 | `bridge.js:1512-1523`（`MAX_PUSH_PER_DAY=3`）、`tick:1385-1409`（remind10/remind30）、`envelope.dedupeKey`；`test/s4-state:80-98`、`s50:25-47` | 同 callId 24h≤3、同档不重复 ✓；但提醒文案不带序号，且"离开补推"和"5 分钟兜底"不计入这 3 条，同一请求最多可收到 4–5 条主动消息。 |
| A7 | 未实现 | 全仓无自启/守护代码（`tools/` 只有 5 个非部署脚本）；01 §10、台账 line 18 自述"还不能验" | 只有 WS 自动重连（`qq.js:#scheduleReconnect`），与"重启 PC 后 ≤5 分钟通道恢复"不是同一件事。 |
| A8 | 部分符合 | `bridge.js:#noticeBudgetOk:1252-1264`（`maxNoticesPerDay=10`）只被 `tick` 调用 | 审批卡片、提问卡片、断网摘要、重连、重启作废、GUI 回执、5 分钟兜底都不计入日预算 → 正常日可超 10 条；无测试。 |
| A9a | 部分符合 | `bridge.js:1546-1551`（signal→expire）、`resolveAnswer:420-427`；`test/s17-late:10-24` | expired + "已失效…没有被采纳" + 结局 `cancelled` ✓；但 `WaitPointStore.expire()`（`wait-point.js:92-98`）只改 status，不记中止时刻，A9a"日志记录中止时刻"未落地。 |
| A9b | 部分符合 | `bridge.js:420-427`、`handleQuestion:1646-1651`、`1706-1714`；`test/s5-question:77-87`（只覆盖测试注入的 `timeoutMs`） | 生产不传 `timeoutMs`（D10），提问侧没有独立超时源，只在 `signal` abort 时置 expired；文案是通用"已失效（DSH 侧已中止/超时…）"，不是"该提问已超时结束"；若 DSH 因 timeout 结束而未 abort，wp 仍是 open，迟到答复会回"已收到"（假阳性）。 |
| A10 | 部分符合 | `bridge.js:resolveAnswer:414-428`；`test/s17-late:26-39` | 答复只作用于命令里显式 id（另一 id 不变）✓；但没有 A10 要求的"属于已结束的请求 #P1"固定回话，也没有"旧答复"识别（D21 后只按 id），无跨请求用例。 |
| A11 | 符合 | `src/core/label.js:classify:16-23`（纯函数、三判据）；`bridge.js:1480-1491`（以会话 cwd 为根）；`test/s6-label`、`s50:49-65` | 结论只由工具名/参数/cwd 决定，可重放；参数按 callId 反查（ADR-22）。 |
| A12 | 未实现 | `src` 无睡眠/唤醒检测（仅注释与 `#wake` 命名，无 sleep 域）；01 §10 未列，台账 line 774 自认未实现 | 唤醒后最多是 WS 重连提示，没有"只 1 条摘要 + 待答 N 与本地一致"。 |
| A13 | 部分符合 | `bridge.js:#loadState:246-267`、`onReady:284-291`；`test/s4-state:57-78` | open→dropped(restart) 且旧选项回"已作废" ✓；但只报"有 N 个待答请求已作废"，不报"N 个中断 turn"（frame 的硬要求），也没有断电专用检测；s4 的 `!/待决\s*\d+/` 断言恰好放过了"待答请求"这个计数。 |
| A14 | 不符合 | `qq.js:21`（`#hbMs=41_250`，且被服务端 HELLO 覆盖）、`recoverIfStale:179-191`（2×hbMs）、`lib/index.js:144`（10s 轮询）；`test/s18-watchdog`（用 1s 心跳夹具） | 机制存在，但生产阈值 2×41.25s=82.5s，frame 要求 ≤20s（心跳 10s）；且这是 WS 重连，不是"挂死进程重启"。01 §10 自认冲突但未改签、也未记偏离。 |
| A15 | 部分符合 | 查询全在内存/磁盘：`bridge.js:listSessions/progress/useSession/wakeSession`；`test/s16`、`s27-idcmds`、`s51` | 假通道下响应是同步/毫秒级，但没有任何 ≤10s 的计时断言。 |
| A16 | 未实现 | 全仓无外部守护（`tools/` 无计划任务/托盘；01 §10 自述未实现） | 进程被杀后无人拉起，A14/A16 这一对验收结构性不成立。 |
| A17 | 部分符合 | `bridge.js:sayGoodbye:1728-1734`；`lib/index.js:152-160`（dispose→goodbye→client.stop）；`test/s19-goodbye` | "我下班了"一条 + 停止 ✓；"不再被拉起"因为没有守护而自动成立，属空真。 |
| A18 | 符合 | `bridge.js:progress:664-673`；`test/s51:33-46` | 事件行带 `ev-<seq>`、待答点带 `wp-N`，都是可核验来源。 |
| A19′ | 符合 | `bridge.js:onSessionEvent:1079-1110`（tool/call→`writeTargetOf`→逐条审计）、`1112-1115`（回话"本次改动 N 次写操作（路径）"）；`test/s15-writes:22` | 咨询会话可写、每次写一条审计、回话带文件数与路径清单（审计 openid 为 null，A19′ 未要求身份）。 |
| A20 | 部分符合 | `bridge.js:ask:746-749`、`#fallbackSummary:1201-1222`；`test/s21-degrade` | 只在"拿不到 sessionController/agents"时降级为 L1 并标"这是摘要，不是调查"；L2 运行中失败/超时/超额度没有降级路径（也没有 60s 超时）。 |
| A21 | 部分符合 | `bridge.js:resolveAnswer:511-516`（custom）、`handleQuestion:1717-1725`；`test/s5-question` | 自由文本能进 seam 返回；但"把 L2 结论作为答复"要人自己贴，桥接不自动把 `/why` 结论回填成提问答复。 |
| A22 | 部分符合 | `bridge.js:431-481`（确认后 `deliverToAgent`）、`deliverToAgent:116-122`（followup / `send(msg,'next-turn',true)`）；`test/s5-say:51-66`、`s34-deliver`、`s49` | 确认后才投递，投递目标用合法值 `next-turn` ✓；"≤10s 起新 turn、消息进上下文"取决于 `agent.followup` 的真机行为（S5 未验），脱网只证明调用发生。 |
| A23 | 符合 | `bridge.js:startSay:1016-1058`（回显 `lastStop` + 等 `/ans` 1）；`test/s5-say:58-60` | 未确认前不注入（`injected=0` 已断言）。 |
| A24 | 符合 | `bridge.js:trackActivity:1145-1157` + `#idleMessage:1339-1348`；`test/s14:22-25`、`s22-noise` | `turn/end` 事件驱动即时发（≤10s），文案"它停了，等你下一句"，无待答才发；在场时不推（已签偏离 ADR-30）。 |
| A25 | 部分符合 | `envelope.js:9`（`FORBIDDEN_WORDS`）、`renderCard:50-81`；`test/s2:38` | 模板自身无五词；但 `理由：${reason}` 原样透传，`reason` 含"风险/注意"等词就会上卡片，`leakedRating` 只算不处置（无人消费）；台账 line 748 自认"未解决，需人类裁决"。 |
| A26 | 部分符合 | `audit.js:append:20-34`、`RETENTION_DAYS=180`、`bridge.js:start:238-241`（启动裁剪）；`test/s8-audit`、`s41-audit-conservation`、`s51:48-58` | 五字段齐（requestId/openid/at/card/evidenceViewed）+180 天裁剪 ✓；但 card 快照是渲染后文本 + `{labeled,reason}`，不是 W5 字段原值；GUI 侧决定 openid 为 null；裁剪只在启动时跑。 |
| A27a | 部分符合 | `bridge.js:1505`（`evidenceMissing = labeled && !consultAvailable`）、`1537`；`envelope.js:67-73`；`test/s21:22-35` | 卡片"现场暂不可查"、不阻拦 ✓；审计字段名是 `evidenceMissing`（frame 写 `evidence_missing`），且 s21 第 31-34 行并未真的读审计文件（`entries > 0` 是空断言）。 |
| A27b | 部分符合 | `bridge.js:1538`、`envelope.js:67`；`test/s51:13-18` | 未 `/why` 就批 → 卡片"现场：未查看（可发 /why 查看）"、审计 `evidenceViewed=false` ✓；但卡片只在创建时渲染，之后 `/why` 不会把已发出的卡片改成"已查看"。 |
| A28 | 部分符合 | `bridge.js:handleApproval:1615-1617` + `outcomeFromVote:23-28`；`test/s3-label:66`、`s45:34-42`、`s38-dual` | `/yes` 走 `allowed-once`，无需 PC 操作 ✓；"DSH 侧确实执行"只能真机验；双通道下 GUI 也会同时收到同一请求（不阻塞，但不等于"PC 完全不参与"）。 |
| A29 | 符合 | `bridge.js:startSay:1017-1047`；`test/s5-say:42-49,90` | 未绑定/未加载/运行中三种都拒绝并回原因，且不创建 say 待答点、不注入。 |
| A30 | 符合 | `bridge.js:tick:1361-1384`（10min 首条、30min 升级、各一次、`lastType==='tool/call'` 豁免）；`test/s14:12-21`、`s23:37-47` | 与 W10 同口径；受在场门控与日预算影响，属已签偏离。 |
| A31 | 部分符合 | `bridge.js:wakeSession:924-975`（`resolveAgent`→`bindAgent`）；`test/s10-wake`、`s26-wake-id`、`s29-wake-resolve` | 走 `resolveAgent` 并绑定 ✓；但回话无条件写"状态「空闲」"（`:955`/`:965`），并未检查 `isBusy`；≤10s 与"真的变空闲"需真机。 |
| A32 | 符合 | `bridge.js:newSession:869-921`（只接受清单序号，非数字回"只接受清单里的序号"）；`test/s11:29-30` | 手打路径被明确拒绝；工作区来源 `sessions.js:listKnownWorkspaces`（workspace.json）。 |
| A33 | 符合 | `bridge.js:newSession:887-904`（`state.newSessions` 按 workspaceId/日计数并落盘）；`test/s11:21-28` | 第 N+1 次拒绝且重启后计数仍在；默认 10（`lib/index.js:90` + 已签偏离）。 |
| A34 | 符合 | `bridge.js:ask:742-811`（同 `target.id` 复用 `consults` 条目）、`onSessionEvent` 中继；`test/s12:22-24` | 同 id 追问复用同一咨询会话，不新建。 |
| A35 | 符合 | `bridge.js:endConsult:831-867`（含 `shortOf(key)`+"共 N 轮"+原因）、`#armConsultTimer:823-829`（300s）；`test/s12:25-27` | 两种结束共用同一回话函数；300s 路径无测试，且在场时不推送（偏离 ADR-30 明列）。 |
| A36 | 符合 | `bridge.js:listSessions:626-627`（`state.consults` 过滤）、`resolveTargetId:686`、`wakeSession:930` 同源过滤；`test/s13-hidden:24`、`s47` | 咨询会话不进 `/list`，序号解析/`/wake` 也不把它算进去。 |

## D 表（D1–D21）

| 编号 | 结论 | 证据 | 一句话说明 |
|---|---|---|---|
| D1 | 符合 | `src/transport/qq.js:8-9`（api.sgroup.qq.com）、`#postMessage:203-213` | 官方机器人 WS 出连 + 官方发消息端点。 |
| D2 | 符合 | `lib/index.js:102-127`（`ctx.on` 两条瀑布）、`package.json` `dsh.bundle`、`cordis.patch.yml` | 进程内插件、无构建（ADR-17）；但"S1 占住瀑布"当前无有效证据（见交叉检查）。 |
| D3 | 符合 | `bridge.js:boundAgent:173/1061-1066`、`listSessions` 只读 | 单绑定 + `/list` 只读；v6/v7 的 `/use` `/wake` `/new` 扩大了"可指向的会话"，但仍是同一张绑定表。 |
| D4 | 部分符合 | `bridge.js:tick:1385-1409`、`MAX_PUSH_PER_DAY=3:42`；`test/s50:25-47` | 10/30 分钟两档 ✓；但补推与 5 分钟兜底不计入"同实例 24h ≤3"，同一请求最多 4–5 条主动消息。 |
| D5 | 部分符合 | 事件集只有待答（`handleApproval`/`handleQuestion`）、完成（`trackActivity` turn/end）、停滞（`tick`） | 没有"失败"通知，也没有任何逐类开关（blackbox BB-81 依赖的"托盘关闭完成类"不存在）。 |
| D6 | 符合 | `bridge.js:169/300`；`test/s20:28-32` | 白名单 openid，非白名单静默。 |
| D7 | 符合 | `bridge.js:196-197`（10/30 分钟）、`tick:1369` | 与 W10/A30 同口径，工具执行中豁免。 |
| D8 | 不符合 | 全仓无托盘/计划任务/自启（`tools/` 5 个脚本皆非部署；01 §10 自述） | 与 frame §3.1#10、Q12 直接冲突。 |
| D9 | 符合 | 无任何按动作类型的拒绝分支；`label.js` 只产 `{labeled,reason}`；被标注只改"确认格式"（`bridge.js:491`） | 没有任何动作因命中 §4.1 而不被批准。 |
| D10 | 符合 | `lib/index.js:108` 只传 `{next}`；`timeoutMs` 仅测试传入（s4/s50）；`expire` 只在 signal abort；`dropReason 'test-timeout'` 仅测试 | 生产不设桥接侧超时，过期以 DSH 终止为准（ADR-18）。 |
| D11 | 部分符合 | `lib/index.js:152-160` + `sayGoodbye`；`bridge.js:284-291` | "退出发最后一条"✓；"断电只报异常结束"缺"N 个中断 turn"，且用"待答请求已作废"计数，与 A13"不声称待答数"字面相抵。 |
| D12 | 部分符合 | L0=卡片模板（`envelope.renderCard/renderQuestionCard`）、L1=`progress`/`#fallbackSummary`、L2=`ask`（独立会话） | 三档都在；L2 的 60s 超时（Q16）未实现，结束靠 300s 空闲；"至少一个可核验依据"只靠 prompt 文本，无校验。 |
| D13 | 符合 | 答复→`points.answer`→seam 返回；`/say`→`deliverToAgent`；运行中拒绝（`startSay` `isBusy`） | 没有向运行中会话注入的路径（X7 守住）。 |
| D14 | 部分符合 | `bridge.js:startSay`（echo ✓、不新建/不换目录 ✓）+ `looksLikeSessionRef` 支持显式 id | 确认格式用 `/ans <id> 1\|2`，而 Q18/D14 写 `yes <id>`；`/yes` 对 say 待答点会被 `:432` 拒绝——该变化未记入偏离。 |
| D15 | 符合 | `wakeSession:924-975` + `resolveAgent`；`test/s10-wake`、`s26-wake-id`、`s29-wake-resolve` | 只挂已存在 id，不新建。 |
| D16 | 符合 | `newSession:871-885`（workspace.json 序号） | 不接受自由路径；只传 `workspaceId`。 |
| D17 | 符合 | `maxNewPerWorkspacePerDay=10`（`lib/index.js:90`）+ `state.newSessions` 落盘；`test/s11` | 默认 10、可配置、重启不清零（已签偏离）。 |
| D18 | 符合 | `ask`/`endConsult` + 300s + 路由键=会话 id；`test/s12` | 复用、结束回话、不进 `/list`。 |
| D19 | 符合 | 咨询会话不设只读；写操作逐条审计（`bridge.js:1099-1110`）+ 回话改动清单（`1112-1115`）；`test/s15` | 与"推翻 ADR-13 只读旁路"一致。 |
| D20 | 符合 | `envelope.COMMANDS.say` + `startSay(idArg)` + `looksLikeSessionRef`；`test/s27-idcmds`、`s30-say-text` | 显式 id 优先，无 id 用绑定；无隐式"当前通道"状态。 |
| D21 | 符合 | `envelope.parseCommand:88-141`（非 `/` 一律 unknown）、`bridge.onEvent:318-327`（只回状态提示）、卡片提示全命令（`envelope:68-74`）；`test/s2:44-63`、`s31-copy`、`s33-prompts` | 裸 `1` / `yes` 不再识别；命令集封闭；"解析失败不推定 approve"。 |

## W/X（只看是否被违反）

| 编号 | 结论 | 证据 | 说明 |
|---|---|---|---|
| W1 | 未违反（已实现） | `handleApproval`/`handleQuestion`/`trackActivity(turn/end)` | 阻塞态与空转态都转成"它在等你"。 |
| W2 | 部分违反 | `bridge.js:resolveAnswer`、`handleQuestion` | 绑定用 requestId（`wp-N` + callId），**没有 turnId 维度**；自由文本只对提问型生效（与契约一致，但与 W2 字面"requestId 或 sessionId+turnId"差一项）。 |
| W3 | 部分违反 | `startSay`/`lastStop`/`deliverToAgent`；`test/s5-say` | 逻辑齐全，但"上下文是否连贯"（S5）真机未验——W3 的成立依赖这一条。 |
| W4 | 部分违反 | L0/L1/L2 三条路径（见 D12） | L2 的 60s 超时、额度、依据校验都没有；"带降级"只在服务缺失时成立。 |
| W5 | 部分违反 | `renderCard` 七字段、`findToolArgs`、`/why` 提示 | `可撤回` 值由 `labeled` 代理（不可信）；其余字段齐。 |
| W6 | 未违反（已实现） | `audit.js`、`bridge.js:start` prune | 五字段 + 180 天；快照是渲染文本而非字段原值。 |
| W7 | 未违反（已实现） | `bridge.js:300-303`；`test/s20:28-32` | 只认白名单，非白名单不回显。 |
| W8 | 部分违反 | `dedupeKey`/`seen`、`deliveries`、`qq.js.#scheduleReconnect`、`send()` 失败计数 | 去重、重连、计数摘要都有；**重试与离线队列没有**（01 §3 自认）。 |
| W9 | 部分违反 | 日志轮转 ✓ `log.js`（`test/s54`）；守护/自启 ✗ | 三项里只落地一项。 |
| W10 | 未违反（已实现） | `tick:1361-1384`；`test/s14`、`s23` | 10 分钟、30 分钟各一次、工具执行中豁免。 |
| X1 | 未违反 | `/list` `/use` `/wake` `/new` `/say <id>` | 多会话"可见/可切换"已被 v6/v7 的 D15/D16/D20 实质纳入本期；frame §2 仍把 X1 写成二期，未标注被覆盖（文档问题，非实现越界）。 |
| X2 | 未违反 | 无图片/附件上传路径 | 只发文本。 |
| X3 | 未违反 | `onEvent` 只处理 `C2C_MESSAGE_CREATE`，发送只走 `/v2/users/{openid}/messages` | 群/频道未实现（见交叉检查：这与 ADR-08"不假设场景"相反，但不违反 X3）。 |
| X4′ | 未违反 | `newSession` 只认清单序号；无批量下发 | 未知路径一律拒绝。 |
| X5 | 未违反 | 只有 QQ 一个通道 | 无第二通道。 |
| X6 | 未违反 | 只读 `~/.dsh/*` 与自身状态 | 不监控 DSH 以外进程。 |
| X7 | 未违反 | `startSay` 的 `isBusy` 拦截；咨询走独立会话 | 无向运行中会话注入的路径。 |

## 基线实测

方法照 `docs/build/baseline.md`（逐套单跑、只看进程退出码），排除 `_setup.mjs`、`s1-waterfall.test.mjs`、`s3-loop.mjs`，Node 用 `C:\Users\95878\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`（v24.22.1）。

```
TOTAL=58  GREEN=58  RED=0
失败清单：无
```

- 与 `baseline.md` 记录的 `TOTAL=57` **差 1 套**：实际参与基线的套件是 58 个（差异来自 `s55-presence-flaky.mjs` 这类后加套件未回写，baseline 的"为什么数字变过"只解释了 47→52→57）。这不是测试失败，是基线文件本身过期。
- `README.md:73` 与 `01-architecture.md:5` 仍写"56 套"，与 baseline（57）和实测（58）三方不一致。
- 被排除的两套：`s1-waterfall.test.mjs` 用普通 node 跑会 `ERR_MODULE_NOT_FOUND`（asar 路径只有 Electron 能读）；`s3-loop.mjs` 需要真实 QQ 通道。因此 **A2 的"≤5s"、S1 的"占住瀑布"都不在基线覆盖内**。
- 附带核对仓库自带的一致性工具：`node tools/audit-docs.mjs` 输出 8 条 `[BUG]`，逐条核对后**全部是工具自身误报**（它把无参的裸命令 `/ans`、`/yes` 等直接喂给 `parseCommand`，必然返回 `unknown`）；该工具也没有覆盖本次审计的主要真实偏差（标题字段、S1 失效、A14 阈值）。所以"audit-docs 通过"不能当作文档-实现一致性的证据。

## 代码有文档无

1. **`dualChannel` 双通道竞态**（`bridge.js:177,1555-1598,1655-1694`；`lib/index.js:106-108`）：GUI 与 QQ 同时 settle、`decisionFromOther` 兜底。03-decisions 没有对应 ADR，01 未记；只在 `review-r1/r4` 的评审记录里出现过。它改变了 seam 的语义（"谁先答用谁"），属于需求级行为。
2. **`/say` 的确认格式是 `/ans <id> 1|2`**（`bridge.js:1054,431-440`），而 Q18/D14 写的是 `yes <id>`；`/yes wp-N`（say 点）会被 `:432` 直接拒绝。该不一致未进 `## 偏离`。
3. **`reversible: label.labeled ? false : undefined`**（`bridge.js:1535`）：复活了 02 契约明确作废的 ADR-19 reversible 代理；卡片对任何被标注请求都说"可撤回：否"。
4. **通知对象过滤规则**（`bridge.js:#isWatched:1272-1296`）：排除 subagent 会话、60s 缓存、"会话库为空时全放行"。01/02 均未记录，但它决定"哪些会话的 turn 结束会推 QQ"。
5. **状态文件新增四个键**：`mode`（静音/始终推）、`notices`（日预算）、`newSessions`（新建配额）、`consults`（隐藏咨询会话）（`bridge.js:356,1261,903,789`）。01 的"落盘形状"只写了 `version/waitPoints/deliveries/interruption`。
6. **`sayReplyChars` 下限 200**（`bridge.js:1436` `Math.max(200, …)`）：ADR-31 只说默认 800，没说下限。
7. **被动窗口用 55 分钟余量**（`bridge.js:1745`）：ADR-21 只写"满 4 次转主动"，55 分钟这个安全边际未记。
8. **`tools/` 五个脚本**（`audit-docs/audit-prompts/bb-reset/openid-probe/repair-title`）：01 的目录树完全没有 `tools/`。
9. **`s1DefaultOutcome` 已成死配置**：`lib/index.js:97-100` 在缺 transport 时直接 `return`，所以 `cordis.patch.yml` 里唯一那条 `s1DefaultOutcome: rejected` 永远不会被用到（S1 形态已不可用）。

## 文档有代码无

1. **A12（睡眠摘要）**：`src` 无任何 sleep/唤醒域；`interruption` 只覆盖"上次有 open 待答点"。
2. **A13 的"N 个中断 turn"**：全仓无此计数/文案（grep `中断 turn` 只命中 docs）；重启文案是"有 N 个待答请求已作废"。
3. **A10 的"属于已结束的请求 #P1"**：全仓无此串（仅 `blackbox.md` BB-08 有）；实现给的是"已作废/已处理过——这次答复没有被采纳"。
4. **A9b 的"该提问已超时结束"**：无此串；提问侧没有独立超时源。
5. **A14 的 ≤20s**：代码是 82.5s（`qq.js:21,179-182`）。
6. **A16 外部守护 / A7 自启 / D8 计划任务+托盘 / Q12**：全仓无实现（01 §10 自认）。
7. **A20 的"L2 失败/超时/超额度 → 降级 L1 + 标明"**：只有"服务缺失"这一条降级路径。
8. **D12/Q16 的 L2 60s 超时**：无；咨询结束只有 300s 空闲。
9. **D5 的"逐类可关"与"失败"通知**：无；也没有任何配置项/托盘菜单。
10. **A8 的全局日预算**：只有空闲/停滞计数，审批/提问/摘要/重连/兜底都不计。
11. **W8 的"重试"与"离线队列"**：无（01 §3 自认）。
12. **Q15 的 doctor 五项**：全仓无 `doctor`（台账 line 664 自认"整体删除"），而 frame §3.1#9 与 Q15 仍要求它。
13. **手册 `docs/guide/qq-bridge-manual.md:219` 的报错串"这条超时没等到你…"**：`src` 无此串。
14. **01 §9 债 5 的"`evidenceViewed` 恒为 false（`/why` 未实现）"**：与代码相反（`bridge.js:737` 会置 true），文档滞后。
15. **01 的"S1 ✅ 单元级（真 cordis）"**：该测试当前不可跑（asar 需 Electron），且 `lib/index.js:97-100` 在无 transport 配置时提前 `return`，连 answerer 都不会注册——即便用 Electron 跑，5 次也会全部 `unavailable`；测试末行的 `plugin.trace.filter(t => t.s1)` 还是空集合上的 `every()`（恒真）。
16. **套数**：README/01 写 56、baseline 写 57、实测 58。

## P0 清单（必须修，按影响排序）

1. **`/new` 写 `session/title` 缺 `messageSeqs` 与 `source`**（`bridge.js:910`，另两处 `:456`/`:779` 都是完整的）。这是本轮点名的敏感点，且 `s39` 的检查是"整个文件出现 messageSeqs"（被另两处满足）、`s35` 只断言 `title === 'QQ'` → **双测试假绿**；真机曾因此报 `SessionFormatError`（`s39` 注释、手册 §10）。修：补字段，并让 `s35` 断言字段形状。
2. **S1 证据失效 + 无 transport 时不注册 answerer**（`lib/index.js:97-100`、`test/s1-waterfall.test.mjs:29`）。这意味着"D2 占住瀑布、A1 热路径"目前**没有任何有效证据**，而这个探针也不在 58 套基线里。修：让 S1 形态仍注册（或提供可注入 ctx 的脱网夹具），并把 S1 纳入可跑的基线。
3. **卡片发送失败后不会再试**（`bridge.js:#queueCard:568-583` + `send():1762-1767`）：失败时 `pushedToQQ` 已被置 true、`deliveries` 已计数，`#flushPending` 与 5 分钟兜底的 `if (pushedToQQ === true) continue` 都会跳过 → 单条审批卡片静默丢失，只剩 `failedSends` 计数。这与 C1"漏推审批会卡死"直接冲突，是唯一会让"人不在 PC 前"直接失效的单点。
4. **A14 阈值与机制双不符**（`qq.js:21,179-191`）：2×41.25s=82.5s vs frame ≤20s；且恢复动作是 WS 重连而非进程重启。要么改签 frame，要么把阈值/心跳口径重新定义（服务端下发的 41.25s 不能直接当"10s 心跳"用）。01 §10 已自认冲突，但没有 `## 偏离` 记录。
5. **进程域完全缺失**（A16/A7/D8）：无守护、无自启、无托盘。后果是 A14/A16/A17/A7 四条验收结构性不成立，A17"不再被拉起"是空真。这是"离开 PC 6 小时"判据的硬前提。
6. **中断域只做了 1/4**（A12 未实现、A13 部分）：无睡眠检测、无"中断 turn"计数；重启文案报"N 个待答请求已作废"，与 A13"不声称待答数"字面冲突，而 `s4-state:77` 的正则恰好放过它。
7. **打扰预算不封闭**（A8/D5）：`maxNoticesPerDay` 只作用于 `tick` 的空闲/停滞与 10/30 分钟提醒；审批/提问卡片、断网摘要、重连、重启、GUI 回执、5 分钟兜底全部不计数。frame 的"正常日 ≤10"无法成立，且 D5 的逐类开关不存在（blackbox BB-81 依赖它）。
8. **`/yes` 对 `/say` 待答点不生效**（`bridge.js:431-440`）：Q18/D14 明确 `/say` 确认方式是 `yes <id>`，实现只收 `/ans <id> 1`；要么改实现，要么把这条写进 `## 偏离`。
9. **A25 五词表只检测不处置**（`envelope.js:45,80` + `bridge.js:1529`）：`reason` 原文直出，含"风险/注意"就会上卡片，`leakedRating` 无人消费。台账自认"需人类裁决"但没有偏离，签字验收 A25 无法成立。
10. **A9b/A10 的过期与乱序语义不完整**：提问侧无独立超时检测（DSH timeout 后若未 abort，wp 仍 open，迟到答复会回"已收到"却无回注对象）；"属于已结束的请求 #P1"回话不存在。两者都是 frame 写死的可核验文案/语义。
11. **`reversible` 用 `labeled` 代理**（`bridge.js:1535`）：违反 02"ADR-19 的 reversible 代理作废"，且卡片"可撤回：否"没有事实依据（W5/A1）。
12. **A2 的日志字段不全**：`bridge.log` 出站行没有 openid/requestId（`bridge.js:1759`、`log.js:49-57`），三要素只在 `state.audit.jsonl`；≤5s 无单独计时。

## 无法离线判定清单（需真机）

| 项 | 为什么离线判不了 |
|---|---|
| A1 热路径 ≤10s / 重启首条 ≤30s | 需要真 QQ 通道与服务端时延；测试只断言字段。 |
| A2 回复后 ≤5s DSH 状态变化 | 需要真实 agent 侧观测；现有记录是端到端 8.7s（含人打字）。 |
| A7 重启 PC 后 ≤5 分钟恢复 | 依赖 DSH 常驻策略（未提供/未实现）。 |
| A9b 提问真实超时后的行为 | 取决于 DSH 是否在 timeout 时 abort `signal`（F14 只说"调用继续推进"）。 |
| A12 睡眠 8 小时唤醒 | 需要真机睡眠；代码无对应域。 |
| A13 强制断电 | 需要真机断电与重启。 |
| A14 挂起 90s | 需要真机 + 服务端下发心跳；且无进程守护。 |
| A15 连续 5 条查询 ≤10s | 无计时断言。 |
| A16 强杀后 ≤20s 拉起 | 需要外部守护（未实现）。 |
| A22 `/say` 后 ≤10s 起新 turn、上下文连贯 | S5 未验；`agent.followup` 真机行为未知。 |
| A24/A30/A31 通知与唤醒的"真实到达/状态" | ADR-23：HTTP 200 ≠ 送达；`/wake` 后的 `isBusy` 无法离线造。 |
| A28 `/yes` 后 DSH 侧确实执行 | 需要真机执行链。 |
| A34 咨询跨轮上下文连贯 | 依赖模型侧会话上下文。 |
| W8 断网 30 分钟真实行为 | 需要真网卡/网关；离线只证明计数。 |
| S1 / 两条接缝在真实 scoped waterfall 下的可达性 | `s1-waterfall` 需要 Electron 且当前逻辑下必失败；生产 `ctx.on` 注册是否被 scoped dispatch 命中，只能真机验。 |
