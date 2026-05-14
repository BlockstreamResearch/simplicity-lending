FROM rust:1.90-bookworm AS lwk-builder

ARG LWK_REF=wasm_0.16.0
ARG LWK_COMMIT=4786e456db6efc05413721f6489899a6426eaa47

RUN apt-get update && apt-get install -y --no-install-recommends \
    git pkg-config libssl-dev ca-certificates clang \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
RUN cargo install wasm-pack --locked
RUN git clone --depth 1 --branch "${LWK_REF}" https://github.com/Blockstream/lwk.git /tmp/lwk
RUN test "$(git -C /tmp/lwk rev-parse HEAD)" = "${LWK_COMMIT}"
WORKDIR /tmp/lwk/lwk_wasm
RUN RUSTFLAGS='--cfg web_sys_unstable_apis' wasm-pack build --target web --out-dir pkg_web --features simplicity,serial

FROM node:22-bookworm AS builder

WORKDIR /app
RUN corepack enable && \
    corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./

COPY --from=lwk-builder /tmp/lwk/lwk_wasm/pkg_web /lwk_wasm/pkg_web

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
