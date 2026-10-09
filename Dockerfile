FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY . .
USER node
EXPOSE 4000
CMD ["npm", "start"]
