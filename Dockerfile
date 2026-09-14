FROM node:24-alpine AS builder

WORKDIR /app

# Build the contracts package first (composite project dependency)
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json

# Build-provenance helpers are copied before `npm ci` so the revision check
# below fails in ~1s instead of after the dependency install. `scripts` does
# not affect dependency resolution, so this keeps the npm layer cached.
COPY scripts scripts

# Build provenance. `.git` is excluded from the build context, so the revision
# is passed in as a build argument; REQUIRE_GIT_REVISION turns a missing or
# non-revision value into a BUILD FAILURE below. An artifact that cannot name
# the revision it was built from must not be deployable, so the check fails
# closed. Local `npm run build` outside Docker is unaffected: it keeps the
# documented development fallback (git rev-parse --short=12 HEAD, then
# "unknown"). The revision never affects the content fingerprint.
ARG GIT_REVISION
ENV GIT_REVISION=${GIT_REVISION} \
    REQUIRE_GIT_REVISION=true
RUN node scripts/build-info.js --check

RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY packages/contracts packages/contracts
COPY src src

# Build both the contracts package and the main application. `npm run build`
# re-runs the revision check and writes dist/build-info.json (source
# fingerprint) before compiling.
RUN npx -w packages/contracts tsc && npm run build


FROM node:24-alpine AS production

WORKDIR /app

# Same build argument, surfaced as the standard OCI provenance label so
# `docker inspect` and any registry report the source revision as well. The
# value is already validated by the builder stage, which refuses to build
# without a real revision.
ARG GIT_REVISION
LABEL org.opencontainers.image.revision=${GIT_REVISION}

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
