#!/bin/sh
# Run daily on the deployment host. BACKUP_REMOTE must be an SCP destination
# on a DIFFERENT machine (example: backup@archive.example:/srv/btl-backups/).
set -eu
: "${BACKUP_REMOTE:?Set BACKUP_REMOTE to an off-host SCP destination}"
cd "$(dirname "$0")/.."
task_backup_dir=$(mktemp -d)
trap 'rm -rf "$task_backup_dir"' EXIT
task_backup_name="btl-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U btl -d btl -Fc > "$task_backup_dir/$task_backup_name"
test -s "$task_backup_dir/$task_backup_name"
scp -B "$task_backup_dir/$task_backup_name" "$BACKUP_REMOTE"
