FROM node:20-alpine

WORKDIR /app

# 环境变量
ENV DB_TYPE=pg \
    PG_HOST=x402-d1g9iojop685ea11a-1306394233.ap-shanghai.app.tcloudbase.com \
    PG_PORT=5432 \
    PG_DATABASE=x402 \
    PG_USER=x402 \
    PG_PASSWORD=*** \
    NODE_ENV=production \
    ALIPAY_SIMULATE=true \
    WECHAT_SIMULATE=true \
    HTTP_PORT=80

# 复制代码
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

COPY backend/src/ ./src/

EXPOSE 80

CMD ["node", "src/index.js"]