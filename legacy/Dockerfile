FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4188
WORKDIR /app
COPY package.json ./
COPY *.html *.js *.css *.cjs ./
COPY admin ./admin
COPY data ./data
RUN mkdir -p /app/.opennext-data && chown node:node /app/.opennext-data
USER node
EXPOSE 4188
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4188/ >/dev/null || exit 1
CMD ["node", "OpenNEXT-preview-server.cjs"]
