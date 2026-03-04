# ---- Stage 1: Build ----
FROM node:22-slim AS builder
WORKDIR /app

# bcrypt のプリビルドに必要なツール
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: Runtime ----
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# standalone サーバー本体
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# マイグレーションスクリプトと SQL
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/supabase ./supabase

# Excel テンプレート
COPY --from=builder /app/templates ./templates

# Railway が PORT 環境変数でポートを注入する（EXPOSE は指定しない）

CMD ["sh", "-c", "node scripts/migrate.js; HOSTNAME=0.0.0.0 node server.js"]
