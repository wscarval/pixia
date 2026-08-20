FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev \
  && npx prisma generate

COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
