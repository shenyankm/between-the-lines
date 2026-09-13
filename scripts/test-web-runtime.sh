#!/bin/sh
# Exercise the non-root web image with the production TLS configuration in isolation.
# The calling CI stack supplies the api DNS name; no real certificate is accessed.
set -eu
cd "$(dirname "$0")/.."
task_tmp=$(mktemp -d)
task_name="btl-web-tls-$$"
task_volume="${task_name}-certs"
task_image=${BTL_WEB_IMAGE:-btl-ci-web}
task_network=${BTL_TEST_NETWORK:-btl-ci_default}
cleanup() {
    docker rm -f "$task_name" >/dev/null 2>&1 || true
    docker volume rm "$task_volume" >/dev/null 2>&1 || true
    rm -rf "$task_tmp"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
    -subj /CN=localhost -addext subjectAltName=DNS:localhost \
    -keyout "$task_tmp/privkey.pem" -out "$task_tmp/fullchain.pem" >/dev/null 2>&1
docker volume create "$task_volume" >/dev/null
docker run --rm --user 0:0 --entrypoint sh \
    -v "$task_tmp:/input:ro" -v "$task_volume:/tls" "$task_image" -c \
    'cp /input/*.pem /tls/; chown 0:101 /tls /tls/privkey.pem; chmod 0750 /tls; chmod 0640 /tls/privkey.pem; chmod 0644 /tls/fullchain.pem'
docker run -d --name "$task_name" --network "$task_network" \
    -p 127.0.0.1:18443:8443 -p 127.0.0.1:18081:8080 \
    -v "$(pwd)/deploy/nginx.production.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$task_volume:/etc/nginx/tls:ro" "$task_image" >/dev/null
attempt=0
until curl --silent --fail --cacert "$task_tmp/fullchain.pem" https://localhost:18443/api/health > /dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 20 ]; then docker logs "$task_name"; exit 1; fi
    sleep 1
done
test "$(docker exec "$task_name" id -u)" = 101
docker exec "$task_name" nginx -t
curl --silent --fail --cacert "$task_tmp/fullchain.pem" https://localhost:18443/ | grep -q '<html'
curl --silent -I http://localhost:18081/ | grep -q '308'
printf '%s\n' 'non-root production TLS, redirect, static page and API proxy: passed'
