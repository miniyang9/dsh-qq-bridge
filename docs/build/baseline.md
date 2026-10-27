# 测试基线（取证）· 2026-10-25

**这是唯一权威基线。** 文档里出现的 47、52 等数字是历史快照，不再代表当前状态。

- HEAD：a296f22（本轮修改前）；修改后见提交历史
- 命令：逐套单跑，按**进程退出码**判断（不用文本匹配）
- 范围：`test/*.mjs`，排除 `s1-waterfall.test.mjs`（需 Electron）与 `s3-loop.mjs`（需真实通道）

```
TOTAL=61  GREEN=61  RED=0
```

## 为什么数字变过

| 数字 | 出现的文档 | 含义 |
|---|---|---|
| 47 | review-r9 | 2026-10-24 的套件数 |
| 52 | README / 台账 / 01（旧） | 加入 s40–s51 后的套件数 |
| **61** | 本文件 | 加入 s52/s53/s54 后的当前套件数 |

## 复跑方法

```powershell
$node = "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
Get-ChildItem test -Filter *.mjs |
  Where-Object { $_.Name -notin @('_setup.mjs','s1-waterfall.test.mjs','s3-loop.mjs') } |
  ForEach-Object { & $node $_.FullName; if ($LASTEXITCODE -ne 0) { "RED: " + $_.Name } }
```
