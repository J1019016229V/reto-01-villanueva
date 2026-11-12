FROM oven/bun:1-alpine
WORKDIR /app
ENV TZ=America/Bogota NODE_ENV=production
RUN apk add --no-cache tzdata
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production
COPY . .
EXPOSE 3000
CMD ["bun", "src/server.ts"]
