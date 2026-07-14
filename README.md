# GitHub Models Free IoT Demo

本仓库演示如何使用 GitHub Models（免费）生成物联网数据平台技术方案、商业分析、架构图和示例代码。

## 文件说明
- `tech_spec.md`：技术方案
- `business_case.md`：商业场景分析
- `architecture.mmd`：Mermaid 架构图源文件
- `data_pipeline.py`：Python 数据管道示例
- `full_output.md`：AI 原始输出（用于调试）

## 如何使用
1. 在 GitHub Actions 中触发工作流 `AI Generate IoT Content`（手动或定时）。
2. 工作流运行结束后，可在 Artifacts 中下载生成的文件，或直接在仓库中查看。

> 注意：此仓库使用 `gpt-4o-mini` 模型，在免费额度内每日可调用约 120 次。