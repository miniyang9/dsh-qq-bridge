# 接口词表审计 · 2026-10-25

起因：真机上"电脑点允许"无效。根因是我们用了自造词汇 `allowed`，而 DSH 的词表是 `allowed-once`。
于是把所有**跨接口的字符串常量**逐条对了一遍：读 DSH 的类型声明（`app.asar` 里的 `typert.host.js` / 类型文件），
再对照我们的用法。**同类问题共 3 处，全部已修并加锁。**

| # | 接口 | DSH 的定义 | 我们曾用 | 后果 | 现状 | 锁 |
|---|---|---|---|---|---|---|
| 1 | `ApprovalOutcome` | `allowed-once \| rejected \| cancelled \| unavailable` | `allowed` | GUI 点允许 → 我们归一成 `rejected`（谎报"用户拒绝"）；手机 `/yes` → DSH 归一成 `unavailable`（工具不执行）。**两条通道的批准从未生效** | 输出 `allowed-once`；未知值→`unavailable` | `s45` `s49` |
| 2 | `MessageSource` | `kind: 'user'` + `rpcId`（词表含 `user-approval`/`user-question-reply` 等，**没有 `user-say`**） | `{ kind: 'user-say' }` | 消息来源非法；能否被接受取决于校验松紧，属"运气好" | 改为 `{ kind: 'user', rpcId: <uuid> }` | `s49` |
| 3 | `InboxTarget` | `'next-turn' \| 'next-step'` | `undefined`（`send(message, undefined, true)`） | 兜底路径参数非法；主路径走 `followup` 才没暴露 | 传 `'next-turn'` | `s49` |

## 已核对、未发现偏差的接口

| 接口 | 定义来源 | 我们的用法 | 结论 |
|---|---|---|---|
| `SessionTitleEventData` | `title` + `messageSeqs: SessionSeq[]` + `source` | 三个字段都写 | 曾缺后两者导致**写坏会话日志**（已修日志 + 加锁 `s46`/`s47`） |
| `SessionCreateRequest` | `workspaceId? \| cwd?`（互斥） | `/new` 传 `workspaceId`，咨询会话同样 | 曾只传 `cwd` → GUI 归"未分组" |
| `sessionController.resolveAgent(id)` | 返回 `{ agent }` 或 `{ error }` | `/wake` 用它 | 曾误用不存在的 `resume` |
| `agent.followup / send / steer / inject` | `followup` 入队并唤醒；`inject` 只入队 | 投递优先 `followup` | 曾用 `inject` → 真机"没动静" |
| `AgentStatus` | `'idle' \| 'running'` | 仅用于诊断输出 | 无偏差 |
| `workspaceController.archiveSession` | `{ sessionId, stopActivity? }` | `/done` 归档咨询会话 | 新增能力（ADR-28） |
| 会话事件类型 | `turn/start` `turn/end` `tool/call` `assistant/message` `session/title` … | 只读这些类型 + 只写 `session/title` | 未自造事件类型 |
| 提问答复 | `{ answers: [{ id, selected[], custom? }] }` | 按此形状收发 | 无偏差（`s40`/`s41`） |

## 做法上的教训

这三次是同一个错误模式：**先按"看起来应该叫这个"写常量，再让测试跟着自己的词表写**，于是测试全绿、真机全错。
现在 `s49` 直接对 DSH 的词表做断言（不是对我们自己的假设），这类偏差会先红。
