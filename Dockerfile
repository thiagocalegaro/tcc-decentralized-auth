FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/packages/node-sdk/package.json ./core/packages/node-sdk/package.json
RUN npm ci
COPY core ./core
COPY frontend ./frontend
COPY scripts ./scripts
COPY tests ./tests
COPY tsconfig.json playwright*.config.ts ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY core/apps/observatory/requirements.txt /tmp/observatory-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/observatory \
    && /opt/observatory/bin/pip install --no-cache-dir -r /tmp/observatory-requirements.txt \
    && rm -rf /var/lib/apt/lists/*
ENV ANCORA_PYTHON=/opt/observatory/bin/python
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/core ./core
COPY --from=build /app/frontend ./frontend
COPY --from=build /app/scripts ./scripts
COPY docs/exemplo-node.mjs ./docs/exemplo-node.mjs
RUN mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 4200 4201 4202
CMD ["node", "--import", "tsx", "scripts/demo-start.ts"]
