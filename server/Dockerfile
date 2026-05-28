FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY protocol.js ./
COPY server.js ./

EXPOSE 8807

CMD ["node", "server.js"]
