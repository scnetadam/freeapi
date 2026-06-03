import os
import re
from openai import OpenAI

# Primary: GitHub Models (free)
github_client = OpenAI(
    base_url="https://models.inference.ai.azure.com/v1",
    api_key=os.getenv("GITHUB_TOKEN")
)

# Backup: AGNES-AI (user-provided key)
AGNES_API_BASE = "https://apihub.agnes-ai.com/v1"
AGNES_API_KEY = os.getenv("AGNES_API_KEY")

agnes_client = OpenAI(
    base_url=AGNES_API_BASE,
    api_key=AGNES_API_KEY
)

def call_with_fallback(prompt, model="gpt-4o-mini", max_tokens=2000, temperature=0.2):
    """
    Try GitHub Models first, fallback to AGNES-AI.
    Returns the response text.
    """
    # Try GitHub Models
    try:
        response = github_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"[WARN] GitHub Models failed: {e}")
        print("[INFO] Falling back to AGNES-AI...")
    
    # Try AGNES-AI
    try:
        response = agnes_client.chat.completions.create(
            model="agnes-2.0-flash",  # AGNES-AI model
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature
        )
        return response.choices[0].message.content
    except Exception as e2:
        print(f"[ERROR] AGNES-AI also failed: {e2}")
        # Last resort: return a placeholder or raise
        return f"// Error: All LLM providers failed. GitHub: {e}; Agnes: {e2}"

# Example usage for IoT pipeline generation
prompt = """
请一次性输出以下内容（使用 Markdown 整理）：
1. **技术方案**：包括核心架构、数据流、安全机制、扩展性设计。
2. **商业场景**：目标行业、盈利模式、市场潜力评估。
3. **系统架构图**：用 Mermaid 语法绘制架构图。
4. **Python 示例代码**：实现从 MQTT 订阅 -> 解析 -> 写入 InfluxDB，包含异常检测。
请确保每部分都有标题，代码块使用 ```python``` 包裹，架构图使用 ```mermaid``` 包裹。
"""

content = call_with_fallback(prompt)

# Split sections using markdown titles
tech_spec = re.search(r"# 技术方案(.*?)(?=\n#|\Z)", content, re.S)
business = re.search(r"# 商业场景(.*?)(?=\n#|\Z)", content, re.S)
mermaid = re.search(r"```mermaid\n(.*?)\n```", content, re.S)
python_code = re.search(r"```python\n(.*?)\n```", content, re.S)

# Write sections to separate files
if tech_spec:
    with open("tech_spec.md", "w", encoding="utf-8") as f:
        f.write(tech_spec.group(1))
if business:
    with open("business_case.md", "w", encoding="utf-8") as f:
        f.write(business.group(1))
if mermaid:
    with open("architecture.mmd", "w", encoding="utf-8") as f:
        f.write(mermaid.group(1))
if python_code:
    with open("data_pipeline.py", "w", encoding="utf-8") as f:
        f.write(python_code.group(1))

print("✅ 内容生成完成！")
print("- tech_spec.md（技术方案）")
print("- business_case.md（商业分析）")
print("- architecture.mmd（架构图）")
print("- data_pipeline.py（Python代码）")