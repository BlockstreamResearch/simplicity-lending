#!/usr/bin/env bash
# Builds LWK (the `lwk` git submodule) to WebAssembly for the web app.
# Output: lwk/lwk_wasm/pkg, installed by web/package.json as `lwk_wasm`.
#
# Usage (from anywhere): web/scripts/build-lwk.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LWK_DIR="${ROOT_DIR}/lwk"
CRATE_DIR="${LWK_DIR}/lwk_wasm"

fail() {
	echo >&2
	echo "ERROR: $1" >&2
	shift
	if [ $# -gt 0 ]; then
		echo >&2
		echo "Fix:" >&2
		for line in "$@"; do echo "  ${line}" >&2; done
	fi
	echo >&2
	exit 1
}

if [ ! -f "${CRATE_DIR}/Cargo.toml" ]; then
	fail "The lwk folder is empty. The git submodule was not downloaded." \
		"cd ${ROOT_DIR}" \
		"git submodule update --init lwk"
fi

if git -C "${ROOT_DIR}" rev-parse --git-dir >/dev/null 2>&1; then
	status="$(git -C "${ROOT_DIR}" submodule status lwk)"
	if [ "${status:0:1}" = "+" ]; then
		pinned="$(git -C "${ROOT_DIR}" ls-files --stage lwk | awk '{print $2}')"
		current="$(git -C "${LWK_DIR}" rev-parse HEAD)"
		fail "lwk is at ${current:0:9}, but this repo expects ${pinned:0:9}." \
			"To use the expected version:" \
			"  cd ${ROOT_DIR} && git submodule update lwk" \
			"To update LWK on purpose, stage it first:" \
			"  cd ${ROOT_DIR} && git add lwk"
	fi
fi

if ! command -v rustup >/dev/null 2>&1; then
	fail "rustup is not installed (Homebrew's rust does not work here)." \
		"curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
	fail "wasm-pack is not installed." \
		"cargo install wasm-pack --locked"
fi

# Apple's clang can't compile C to WebAssembly (needed by secp256k1). Without this check
# the build fails much later with "unable to create target", which is hard to understand.
if [ -z "${CC_wasm32_unknown_unknown:-}" ]; then
	for clang in /opt/homebrew/opt/llvm/bin/clang /usr/local/opt/llvm/bin/clang "$(command -v clang || true)"; do
		if [ -n "${clang}" ] && [ -x "${clang}" ] &&
			echo 'int x;' | "${clang}" --target=wasm32-unknown-unknown -c -x c - -o /dev/null 2>/dev/null; then
			ar="$(dirname "${clang}")/llvm-ar"
			[ -x "${ar}" ] || ar="$(command -v llvm-ar || true)"
			if [ -z "${ar}" ]; then
				fail "Found ${clang}, but llvm-ar is missing." \
					"macOS: brew install llvm" \
					"Linux: sudo apt install llvm"
			fi
			export CC_wasm32_unknown_unknown="${clang}"
			export AR_wasm32_unknown_unknown="${ar}"
			break
		fi
	done
fi

if [ -z "${CC_wasm32_unknown_unknown:-}" ]; then
	fail "No C compiler that can build WebAssembly was found." \
		"macOS: brew install llvm" \
		"Linux: sudo apt install clang llvm"
fi

echo "Building LWK $(git -C "${LWK_DIR}" rev-parse --short HEAD 2>/dev/null || echo '') to WebAssembly..."

cd "${CRATE_DIR}"
if ! RUSTFLAGS='--cfg web_sys_unstable_apis' wasm-pack build \
	--release \
	--target web \
	--out-dir pkg \
	--features simplicity,serial; then
	fail "The LWK build failed. Scroll up and look for the first line that starts with 'error'."
fi

if commit="$(git -C "${LWK_DIR}" rev-parse HEAD 2>/dev/null)"; then
	echo "${commit}" >"${CRATE_DIR}/pkg/.lwk-commit"
fi

echo
echo "Done: ${CRATE_DIR}/pkg"
