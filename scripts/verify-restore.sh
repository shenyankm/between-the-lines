#!/bin/sh
# Restores into an isolated temporary database, never into the live database.
set -eu
cd "$(dirname "$0")/.."
task_dump=$(mktemp)
task_restore_db="btl_restore_$(date +%s)"
trap 'docker compose exec -T db dropdb -U btl --if-exists "$task_restore_db"; rm -f "$task_dump"' EXIT
docker compose exec -T db pg_dump -U btl -d btl -Fc > "$task_dump"
docker compose exec -T db createdb -U btl "$task_restore_db"
docker compose exec -T db pg_restore -U btl -d "$task_restore_db" --exit-on-error < "$task_dump"
docker compose exec -T db psql -U btl -d "$task_restore_db" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS restored_saves FROM saves; SELECT count(*) AS restored_checkpoints FROM agent_checkpoints.checkpoints;'
