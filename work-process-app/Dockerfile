# 업무프로세스 허브 — 외부 패키지 없음 (Node 22 내장 node:sqlite)
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server.js"]
