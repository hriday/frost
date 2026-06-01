# FROST POC — zero-dependency Node static server.
FROM node:22-alpine

WORKDIR /app

# No third-party dependencies; copy only what the server needs to run.
COPY package.json server.js ./
COPY src ./src
COPY public ./public

ENV PORT=8013
EXPOSE 8013

USER node
CMD ["node", "server.js"]
