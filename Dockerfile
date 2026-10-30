FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run check
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 RECAST_DATA_DIR=/data RECAST_ENV_PATH=/run/secrets/recast.env
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["npm", "start"]
