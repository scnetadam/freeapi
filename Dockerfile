FROM node:20-alpine

WORKDIR /app

# 复制 backend 目录到工作目录
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts

COPY backend/src/ ./src/

EXPOSE 80

CMD ["node", "src/index.js"]