FROM node:20.11-alpine

ADD "package.json" /app/

WORKDIR /app

RUN apk add git

RUN npm install --legacy-peer-deps

ADD . /app

RUN mkdir -p /var/log/node_apps/

EXPOSE 3000

# RUN ./node_modules/.bin/jsdoc -c ./jsdoc.conf -d public/js-docs

CMD ["npm", "run", "start"]
