FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false
COPY backend backend
USER node
EXPOSE 4000
# Applies the (idempotent) schema, then starts the API.
CMD ["sh", "-c", "npm run db:setup --workspace backend && npm run start --workspace backend"]
