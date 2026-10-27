FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production DB_PATH=/data/arcade.db
# Persistent storage is a platform volume mounted at /data (Railway rejects VOLUME).
# Runs as root so it can write to the root-owned mount; switch to `USER node` if
# your host lets you set the volume's ownership.
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
