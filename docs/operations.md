# Single-process operation and recovery

For local mock development, run `make dev-up`, back up any existing database, then run `make migrate`, `make api`, and `make web`. A PostgreSQL advisory lock enforces one API instance. If another instance holds the lock, stop it before starting the new one; do not bypass the lock to run recovery.

Keep a database backup and its corresponding code version before release. Migration 0003 is additive: it adds state versions and constraints without clearing demo data. Rehearse migrations in an isolated database. Run `make migrate` before applying the new code, then `make migrate-check`. Check for duplicate running turns and invalid historical states first. Conflicting data causes migration failure; records are not deleted automatically.

Stop the API with a normal termination signal; containers allow a 90-second grace period. After a forced exit, the next startup marks leftover running turns as failed while retaining committed tool facts. Players recover the original request result and explicitly continue. The server does not automatically replay tools.

`sh scripts/verify-restore.sh` dumps the current Compose database to a temporary file, restores it into a temporary database, checks saves and checkpoints, and removes the temporary copy. It validates restoration mechanics, not off-host backups. `sh scripts/backup.sh` requires a real off-host destination; read the script before running it. Backups can contain conversations and session digests, so restrict access.

For rollback, stop the API, validate a database copy against the old code, then switch the service. Do not downgrade a database that is still receiving traffic. Restoring a backup loses writes made after that backup. Migration 0003 retains legacy client read APIs, so client rollback generally does not require a database downgrade.
