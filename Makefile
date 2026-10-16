.PHONY: setup test demo benchmark api-test web-test

setup:
	@node --version | grep -Eq '^v22\.' || (printf '%s\n' 'Faultline Lab requires Node.js 22.x (see .nvmrc).' >&2; exit 1)
	@npm ci --ignore-scripts
	@npm ci --ignore-scripts --prefix apps/api
	@npm ci --ignore-scripts --prefix apps/web
	@printf '%s\n' 'Setup complete (root, API, and web dependencies installed locally; no services or credentials required).'

test:
	@node --version | grep -Eq '^v22\.' || (printf '%s\n' 'Faultline Lab requires Node.js 22.x (see .nvmrc).' >&2; exit 1)
	@npm test
	@npm test --prefix apps/api
	@npm run build --prefix apps/web
	@npm test --prefix apps/web

benchmark:
	@npm run benchmark --workspace @faultline/benchmark

api-test:
	@npm test --prefix apps/api

web-test:
	@npm run build --prefix apps/web
	@npm test --prefix apps/web

demo:
	@node --version | grep -Eq '^v22\.' || (printf '%s\n' 'Faultline Lab requires Node.js 22.x (see .nvmrc).' >&2; exit 1)
	@npm run benchmark --workspace @faultline/benchmark
	@node tests/demo.mjs
