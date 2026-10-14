# syntax = docker/dockerfile:1

# The Cursed Museum: a Node.js server with zero runtime npm dependencies
# (see CLAUDE.md) — node:sqlite and node:http are built into Node itself, so
# there's no install step, just copy the source in. Alpine keeps the image
# small, which matters on the course's 256MB machine. Three.js is served to
# the browser as a vendored static file (public/vendor/), never installed
# server-side.
FROM node:24-alpine
WORKDIR /app

COPY server/ /app/server/
COPY public/ /app/public/
COPY README.md /app/README.md

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/src/server.js"]
