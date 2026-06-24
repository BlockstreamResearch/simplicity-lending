# How to build lwk_wasm

**Recommended — Docker (stable, no Rust on host)**

## 1. **Build lwk-builder stage:**

```bash
# run from repo root
docker build -f web/Dockerfile --target lwk-builder -t lwk-builder .
```

## **2. Extract pkg_web to repo root:**

```bash
docker create --name tmp lwk-builder
docker cp tmp:/tmp/lwk/lwk_wasm/pkg_web ./pkg_web_from_docker
docker rm tmp
rm -rf ./lwk_wasm/pkg_web
mkdir -p ./lwk_wasm
mv ./pkg_web_from_docker ./lwk_wasm/pkg_web
```

## **3. Install & run web**:

```bash
cd web
rm -rf node_modules
pnpm install --force
pnpm dev
```

If `node_modules` already existed, `pnpm install --force` is important because `lwk_web` is a local `file:` dependency.

## **4. Optional check after install**:

```bash
shasum -a 256 ../lwk_wasm/pkg_web/lwk_wasm_bg.wasm node_modules/lwk_web/lwk_wasm_bg.wasm
```
