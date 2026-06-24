FROM node:22-bookworm AS builder

WORKDIR /app

RUN corepack enable && \
    corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_URL
ARG VITE_ESPLORA_BASE_URL
ARG VITE_NETWORK

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ESPLORA_BASE_URL=$VITE_ESPLORA_BASE_URL
ENV VITE_NETWORK=$VITE_NETWORK

RUN pnpm build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]