.PHONY: help install dev run lint typecheck test audit initdb

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-12s %s\n", $$1, $$2}'

install:  ## สร้าง venv + ติดตั้ง dependencies (dev)
	python3 -m venv .venv
	.venv/bin/pip install -U pip
	.venv/bin/pip install -r requirements-dev.txt

dev:  ## รัน API แบบ auto-reload (ต้องมี .env)
	.venv/bin/uvicorn app.main:app --reload --port 8000 --no-server-header

run:  ## รัน API แบบ production-ish
	.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-server-header --proxy-headers

lint:  ## ruff
	.venv/bin/ruff check app tests

typecheck:  ## mypy
	.venv/bin/mypy app

test:  ## pytest (ต้องตั้ง TEST_DATABASE_URL หรือมี postgres local ชื่อ roombooking_test)
	.venv/bin/pytest -q

audit:  ## ตรวจช่องโหว่ dependency
	.venv/bin/pip-audit

initdb:  ## โหลด schema+roles+seed เข้า DB roombooking
	./scripts/init_db.sh roombooking
