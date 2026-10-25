# S5 真机验证（待执行）

状态：插件已装进 `desktop` profile 并写入配置；**DSH 需重启才会加载**。

## 装了什么

| 项 | 内容 |
|---|---|
| profile | `~/.dsh/profiles/desktop`（`dsh plugin add` 已执行，依赖 `dsh-qq-bridge 0.0.1`） |
| 配置 | profile 的 `cordis.patch.yml` 末尾追加 `- id: qq-bridge`，含 `transport.appId/appSecret/allowlist` |
| 备份 | 装之前的两份文件在 `.tmp/desktop-profile-backup/` |

## 验证步骤（重启后）

1. 重启 DeepSeek Harness（关掉整个应用，不是关窗口）。
2. 在 GUI 里开一个会话，让它跑出至少一轮（有 `turn/end`）。
3. 手机 QQ 给机器人发：`go`（开被动窗口，可省）
4. 发：`/say 请用一句话复述你上一轮在做什么`
5. 机器人应回：
   ```
   [wp-N] 将要发送：请用一句话复述你上一轮在做什么
   上次停在：上次 turn 在 … 结束
   回复 1 发送 / 2 取消
   ```
6. 回 `1` → GUI 会话里应看到这条用户消息，并开始新的 turn；QQ 收到"已发送到会话：…"。
7. **判据（S5）**：新 turn 的回答能引用上一轮的具体内容，而不是"我不知道你在说什么"。

## 判据不通过怎么办

`agent.inject()` 的 `UserMessage` 形状是**推断**的（照审批策略变更那处用法）。若第 6 步没反应：

- 查 `audit.jsonl` 是否有记录；
- 查桥接日志有无 `inject` 抛错（会有"发送失败："回话）；
- 那就说明形状不对，回 S5 改 `userMessage()`。

## 回滚（一次装错不拖累日常）

```
dsh plugin --profile desktop remove dsh-qq-bridge
```
再把 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾那段 `- id: qq-bridge` 删掉（或从 `.tmp/desktop-profile-backup/` 还原）。

## 注意

装好之后，**desktop 会话里的每一次审批都会发到 QQ 并等你回话**（这是功能，不是 bug）。
不打算验的时候请回滚，否则你在 GUI 里做任何需要审批的操作都会挂住。
