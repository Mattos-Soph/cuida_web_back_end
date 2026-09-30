# Imagem do back-end do CUIDA (Node 22). Funciona em x86 e em ARM (Oracle Ampere).
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependências primeiro: aproveita o cache quando só o código muda
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# Não roda como root
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
