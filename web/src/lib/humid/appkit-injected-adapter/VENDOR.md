# Vendored: `@humid/appkit-injected-adapter`

The `.ts` files beside this note are a **byte-for-byte copy** of another repository's
source. Nothing here is written for this dapp, and nothing here should be edited in
place — a local fix is a fork nobody can see.

## Where it comes from

| | |
| --- | --- |
| Repository | `git@github.com:BlockstreamResearch/humid.git` |
| Path | `packages/appkit-injected-adapter/src/` |
| Branch | `feature/conf-tx` |
| Commit | `6af558b36d3ab499a3f40eff27afe281b3f0fe0a` |

Every file's Git blob hash matches that commit exactly, so drift is a `git hash-object`
away from being visible rather than something to read for.

## Why a copy instead of a dependency

The package is `private: true`, is published nowhere, and has **no build step** — its
`exports` field points straight at `./src/index.ts`. It is written to be consumed by
source resolution inside its own workspace, which this repository is not part of.

A path dependency (`file:` / `link:`) onto a local humid checkout would work on one
machine and fail everywhere else. `web/Dockerfile` copies only `package.json` and
`pnpm-lock.yaml` into the build context and runs `pnpm install --frozen-lockfile`
before the source arrives, so a dependency resolving outside that context cannot be
installed at all — the container build, which is how this dapp ships, would break.

Copying the source keeps the dapp a standalone repository: `tsc -b` typechecks these
files under this project's own compiler settings, and `vite build` treats them as
ordinary source and tree-shakes what the dapp does not import.

## Keeping it current

```sh
cp <humid-checkout>/packages/appkit-injected-adapter/src/*.ts \
   web/src/lib/humid/appkit-injected-adapter/
```

Then update the commit in the table above. The copy is excluded from Prettier and
ESLint (see `.prettierignore` and `eslint.config.js`) precisely so that the command
above stays a copy rather than a merge — upstream formatting is left exactly as it is.

## Peer dependencies

These files import `@reown/appkit`, `@reown/appkit-common`, `@reown/appkit-controllers`
and `@walletconnect/universal-provider`. They are declared in `web/package.json` as
ordinary dependencies of the dapp, since the copy carries no manifest of its own.
