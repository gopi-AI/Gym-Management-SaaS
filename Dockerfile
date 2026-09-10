FROM node:24-alpine AS builder

WORKDIR /app

# Build the contracts package first (composite project dependency)
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json

RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY packages/contracts packages/contracts
COPY src src

# Build both the contracts package and the main application
RUN npx -w packages/contracts tsc && npm run build


FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ARG PORT=3000
ENV PORT=$PORT

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
# Copy the compiled contracts package so runtime imports resolve
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist

USER node

EXPOSE $PORT

CMD ["node", "dist/main.js"]
