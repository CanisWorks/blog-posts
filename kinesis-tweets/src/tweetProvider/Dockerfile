FROM node:14-alpine

WORKDIR /usr/src/app

COPY package*.json ./
COPY dist/index.js ./index.js

RUN npm ci --only=production

CMD [ "node", "index.js" ]

