# HireShade — developer entrypoints.
# GNU make on Windows: choco install make. All recipes assume repo root.
.DEFAULT_GOAL := help
.PHONY: help install typecheck test test-unit test-e2e build demo fixtures stealth-proof clean

help:
	@echo "HireShade targets:"
	@echo "  make install      pnpm install (frozen lockfile)"
	@echo "  make typecheck    workspace TypeScript typecheck"
	@echo "  make test         frontend unit tests + API unit tests (no DB)"
	@echo "  make test-unit    API unit tests only"
	@echo "  make test-e2e     frontend suite + API DB suites (requires local Postgres)"
	@echo "  make build        typecheck + build web/API"
	@echo "  make demo         full keyless mock session + latency assertions (ZERO API keys)"
	@echo "  make fixtures     regenerate demo WAV fixtures with ffmpeg"
	@echo "  make stealth-proof  Windows capture-exclusion A/B proof (Electron; writes docs/evidence/stealth)"
	@echo "  make clean        remove build output (dist, target, coverage)"

install:
	pnpm install --frozen-lockfile

typecheck:
	pnpm run typecheck

test:
	pnpm --dir artifacts/craft-vita test
	pnpm --dir artifacts/api-server test:unit

test-unit:
	pnpm --dir artifacts/api-server test:unit

test-e2e:
	pnpm --dir artifacts/craft-vita test
	pnpm --dir artifacts/api-server test

build:
	pnpm run build

fixtures:
	node scripts/demo/run-demo.mjs fixtures

demo:
	node scripts/demo/run-demo.mjs demo

stealth-proof:
	powershell -ExecutionPolicy Bypass -File artifacts/desktop-electron/scripts/bring-to-front.ps1
	powershell -ExecutionPolicy Bypass -File artifacts/desktop-electron/scripts/capture-stealth-proof.ps1

clean:
	-pnpm -r exec rimraf dist
	-powershell -Command "if (Test-Path artifacts/craft-vita/src-tauri/target) { Remove-Item -Recurse -Force artifacts/craft-vita/src-tauri/target }"
