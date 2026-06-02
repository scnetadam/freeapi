import os
import openai

openai.base_url = "https://models.inference.ai.azure.com/v1"
openai.api_key = os.getenv("GITHUB_TOKEN") or os.getenv("OPENAI_API_KEY")

# 物联网平台完整方案生成
prompt = """
请实现一个完整的 IoT 数据管道，要求：
1. MQTT 客户端连接 test.mosquitto.org 并订阅 "iot/data"
2. 接收 JSON 数据后解析温度/湿度字段
3. 写入 InfluxDB（模拟输出）
4. 异常检测功能（温度 > 30° 报警）
5. 完整依赖 requirements.txt 和 Dockerfile
"""

try:
    response = openai.ChatCompletion.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1000
    )
    print(response.choices[0].message.content)
except Exception as e:
    print(f"AI生成失败: {e}")
    # 回退方案
    print("""
# IoT数据管道（回退实现）

## 依赖安装
pip install paho-mqtt influxdb

## 核心代码
```python
import paho.mqtt.client as mqtt
import json

def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload)
        temp = data.get('temperature')
        humidity = data.get('humidity')
        
        if temp and temp > 30:
            print(f"⚠️ 温度异常: {temp}°C")
        
        # 模拟写入InfluxDB
        print(f"📊 数据接收: temp={temp}, humidity={humidity}")
    except Exception as e:
        print(f"解析错误: {e}")

client = mqtt.Client()
client.on_message = on_message
client.connect("test.mosquitto.org", 1883, 60)
client.subscribe("iot/data")
client.loop_forever()
```
""")