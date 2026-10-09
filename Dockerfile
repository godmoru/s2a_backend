FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY . .
USER node
EXPOSE 4000
# Applies the (idempotent) schema, then starts the API.
CMD ["sh", "-c", "npm run db:setup && npm run start"]
