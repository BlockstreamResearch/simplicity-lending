# How to build lwk_wasm

**Recommended — Docker (stable, no Rust on host)**

## 1. **Build lwk-builder stage:**

```bash
# run from repo root (contains web/ and web-v2/)
docker build -f web/Dockerfile --target lwk-builder -t lwk-builder .
```

## **2. Extract pkg_web to repo root pkg_web**:

```bash
docker create --name tmp lwk-builder
docker cp tmp:/tmp/lwk/lwk_wasm/pkg_web ./pkg_web_from_docker
docker rm tmp
mkdir -p ./lwk_wasm
mv ./pkg_web_from_docker ./lwk_wasm/pkg_web
```

## **3. Install & run web-v2**:

```bash
cd web-v2
pnpm install
pnpm dev
```
