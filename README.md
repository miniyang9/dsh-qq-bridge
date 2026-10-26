# dsh-qq-bridge

把 **DeepSeek Harness（DSH）** 本机 Agent 的"等人"环节接到 **QQ**：任务需要批准、需要回答、跑完了、卡住了，你在手机上处理。

> 它不搬执行——任务仍然跑在你这台机器上；它搬的是**判断**。

## 它解决什么

你在电脑前启动一个长任务，然后离开。之后：

- 任务要删一个工作区外的文件 → 手机收到卡片，你回 `/yes` 或 `/no`；
- 任务问你"用哪个方案" → 手机收到问题，选 1/2 或回一段文本；
- 任务跑完了 → 收到一条"它停了"，附本轮摘要；
- 20 分钟没动静 → 收到停滞提醒；
- 你想知道进展 → `/progress`；想让它继续 → `/say`；想追问为什么停 → `/why`。

## 核心设计

| 层 | 做法 |
|---|---|
| **接缝** | 占据 DSH 的 `approval/request` 与 `user-questions/request`，不让 Agent 自己往下走 |
| **等待点** | 每个请求都是有生命周期的对象（`wp-N`），答复必须显式命中 id |
| **双通道** | 手机与桌面同时可以回答，先答者生效；另一端只得到"已处理" |
| **审计** | 谁、何时、看到什么卡片、批了什么，逐条落盘（180 天） |
| **不代决** | 没有人回答就一直等；超时不自动放行 |

## 安装

```powershell
dsh plugin --profile desktop add <path-to-this-repo>
```

`cordis.patch.yml`：

```yaml
- id: qq-bridge
  name: dsh-qq-bridge
  config:
    transport:
      appId: '<AppID>'
      appSecret: '<AppSecret>'
      allowlist: ['<your openid>']
```

重启 DSH，然后在 QQ 里发 `/list` 验证。

完整用法见 **[用户手册](docs/guide/qq-bridge-manual.md)**。

## 命令一览

```
/list                      任务列表（跨工作区）
/progress [id|序号]         进度、待答数、最近事件
/ans <wp-id> 1|2|<文本>     答复（审批选 1/2，提问可自由文本）
/yes <wp-id>  /no <wp-id>   批准 / 拒绝（被标注的请求只认 /yes）
/say <id|序号> <文本>       给会话发指令（先回显，再确认）
/why <id|序号> <问题>       咨询：另起一条会话替你去问现场
/done <id|序号>             结束咨询（结束后自动归档）
/use <id|序号>  /wake <id|序号>  /new [工作区序号]
```

不含 `/` 的消息一律只回状态提示，不执行任何动作。

**在电脑前时不会打扰你**：系统空闲 < 5 分钟视为在场，审批/跑完/停滞不推 QQ（DSH 自己弹窗）；离开后只补"等你决定"的请求。用 `/mode` 查看，`/pc` 手动静音，`/away` 强制全推。

## 开发与验证

```
node test/s2-transport.test.mjs        # 单套
node tools/audit-docs.mjs              # 文档与实现一致性
```

测试共 56 套，覆盖接缝、状态机、去重、审计、双通道竞态、接口词表等；设计过程见 `docs/build/review-r1…r9.md`（九轮独立评审记录）。

## 已知限制

- 依赖 QQ 单聊的被动回复窗口（60 分钟 / 每消息 4 次），超窗改走主动消息；
- 主动消息总额度受平台与用户设置限制（用户可在 QQ 客户端关闭）；
- 时延、每日预算、8 天日志轮转等项目仅在本机测试过，未长期真机验证；
- QQ 账号被盗 = 隐私与控制权同时丢失，无技术缓解手段。

## 许可

MIT，见 [LICENSE](LICENSE)。
