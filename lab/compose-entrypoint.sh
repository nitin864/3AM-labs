#!/bin/sh
set -eu

"/app/node_modules/.bin/tsc" \
  --target ES2022 \
  --module NodeNext \
  --moduleResolution NodeNext \
  --strict \
  --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes \
  --skipLibCheck \
  --outDir /tmp/faultline-lab \
  /app/lab/core/*.ts \
  /app/lab/runtime/*.ts \
  /app/lab/services/*/*.ts \
  /app/lab/workload-generator/*.ts

exec node /tmp/faultline-lab/runtime/cli.js run "${FAULTLINE_WORKLOAD_COUNT:-20}"
