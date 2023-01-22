# Builder
FROM docker.io/library/node:lts-alpine as build
WORKDIR /build
COPY package.json .
COPY package-lock.json .
COPY tsconfig.json .
COPY src/* ./src/
RUN npm install && npm run build


# Final image
FROM docker.io/alpine:3

ENV MAIL2HOOKS_CONFIG='/app/config.json'

RUN apk add --update --no-cache nodejs

WORKDIR /app
COPY --from=build /build/out/mail2hooks.js . 

EXPOSE 1025

CMD ["node", "mail2hooks.js"]
