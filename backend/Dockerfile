FROM node:20-alpine

WORKDIR /app

# 安装编译依赖
RUN apk add --no-cache build-base python3

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci --only=production && apk del build-base python3

# 复制源码
COPY src/ ./src/

# 创建 CloudBase API 凭据文件
RUN echo "SecretId,SecretKey" > /app/SecretKey.csv && \
    echo "AKIDhV…bxAh,***" >> /app/SecretKey.csv

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:80/health || exit 1

CMD ["node", "src/index.js"]