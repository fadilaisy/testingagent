# Build the React frontend and run it with the Express API.
FROM node:22.13-bookworm-slim

WORKDIR /app

# Install workspace dependencies (including Vite for the production build).
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_FILE=/data/jalur.db

EXPOSE 3001
CMD ["npm", "start"]
