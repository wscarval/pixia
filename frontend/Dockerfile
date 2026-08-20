FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_STUN_URL=stun:stun.cloudflare.com:3478
ARG VITE_TURN_ENABLED=false

ENV VITE_STUN_URL=$VITE_STUN_URL
ENV VITE_TURN_ENABLED=$VITE_TURN_ENABLED

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
