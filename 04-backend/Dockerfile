# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# deps first (better layer caching)
# install from the fully-pinned lock file, not the range-pinned requirements.txt,
# so a build on a new machine resolves the exact versions this image was tested with
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt

COPY app ./app
# source tree may carry restrictive perms from the host — make it world-readable
RUN chmod -R a+rX /app

# run as non-root (SECURITY.md 4)
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--proxy-headers", "--forwarded-allow-ips=*"]
