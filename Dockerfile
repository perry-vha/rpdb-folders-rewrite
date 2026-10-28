FROM node:lts-slim
ENV NODE_ENV=production RPDB_DOCKER=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY static ./static
RUN mkdir -p /rpdb/config /rpdb/mounts && chown -R node:node /rpdb /app
USER node
EXPOSE 8750
VOLUME ["/rpdb/config", "/rpdb/mounts"]
CMD ["node", "src/index.js", "--no-browser"]
