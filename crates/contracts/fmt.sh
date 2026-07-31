#!/bin/bash

# WIP: early development, not intended for external use.

set -euo pipefail

SIMF_DIR="./simf"

usage() {
    echo "usage: $(basename "$0") <file.simf> | all" >&2
    exit 2
}

[[ $# -eq 1 ]] || usage

case "$1" in
    all)
        [[ -d "$SIMF_DIR" ]] || { echo "no such dir: $SIMF_DIR" >&2; exit 1; }
        # NUL-delimited so filenames with spaces survive
        find "$SIMF_DIR" -type f -name '*.simf' -print0 \
            | xargs -0 -r -n1 simfmt
        ;;
    *)
        [[ -f "$1" ]] || { echo "no such file: $1" >&2; exit 1; }
        [[ "$1" == *.simf ]] || echo "warning: $1 is not a .simf file" >&2
        simfmt "$1"
        ;;
esac
