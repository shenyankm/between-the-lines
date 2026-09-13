FROM python:3.13.15-alpine3.24@sha256:7415fbc3c9e4979cc717d92377ab2bc7b2b4a2af1ac03cc52b5f3f88efedaf3a
RUN apk upgrade --no-cache
WORKDIR /app
COPY requirements.lock .
# Installation tooling is not needed by the running API. Remove its vendored
# msgpack/setuptools and the ensurepip bootstrap wheel after installing the lock.
RUN pip install --no-cache-dir --require-hashes -r requirements.lock \
    && pip uninstall -y pip \
    && rm -rf /usr/local/lib/python3.13/ensurepip
COPY . .
RUN addgroup -g 10001 appuser && adduser -D -u 10001 -G appuser appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
CMD ["sh", "-c", "python -m alembic upgrade head && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-graceful-shutdown 75"]
