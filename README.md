# GitHub Models 免费物联网方案 Demo

此仓库演示如何在 **GitHub Actions** 中使用 **GitHub Models**（免费额度）完成完整的物联网数据管道代码生成。

## 目录
- `generate_code.py`：调用 GitHub Models 生成 IoT 示例代码。 
- `requirements.txt`：运行示例所需依赖。 
- `.github/workflows/ai-demo.yml`：GitHub Actions 工作流，自动执行代码生成。

## 使用方式
1. **手动触发**：进入 **Actions**，点击 `Demo GitHub Models` → `Run workflow`。 
2. **推送即触发**：每次向 `main` 分支推送都会自动执行。

## 运行结果
工作流运行结束后，日志里会直接输出 AI 生成的完整 Python 示例（包括 MQTT 客户端、异常检测、InfluxDB 写入示例）。

> **注意**：此示例使用 `gpt-4o-mini`，在免费额度内每日可调用 120 次（视 GitHub 账号情况而定）。
