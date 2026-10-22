# --- Build: TypeScript kompilieren, Client bündeln ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json ./
COPY src ./src
COPY public ./public
RUN npm run build

# --- Runtime: nur Produktionsabhängigkeiten und Build-Ergebnis ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
COPY words ./words
USER node
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
