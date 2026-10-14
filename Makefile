.PHONY: setup test demo

setup:
	@node --version | grep -Eq '^v22\.' || (printf '%s\n' 'Faultline Lab requires Node.js 22.x (see .nvmrc).' >&2; exit 1)
	@npm ci --ignore-scripts
	@printf '%s\n' 'Setup complete (dependencies installed locally; no services or credentials required).'

test:
	@node --version | grep -Eq '^v22\.' || (printf '%s\n' 'Faultline Lab requires Node.js 22.x (see .nvmrc).' >&2; exit 1)
	@npm test

demo:
	@node --version | grep -Eq '^v22\.' || (printf '%s\n' 'Faultline Lab requires Node.js 22.x (see .nvmrc).' >&2; exit 1)
	@node tests/demo.mjs
