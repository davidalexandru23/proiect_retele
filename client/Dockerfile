FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache bash

COPY package*.json ./
RUN npm install

COPY . .

ENTRYPOINT ["node", "client.js"]
