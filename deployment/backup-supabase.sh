#!/bin/sh
set -eu

BACKUP_DIR=/home/ali/backups/pocketplan
STORAGE_DIR=/home/ali/projects/pocketplan-supabase/volumes/storage
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DATABASE_FINAL="$BACKUP_DIR/supabase-public-auth-storage-$STAMP.dump"
DATABASE_TEMP="$DATABASE_FINAL.tmp"
FILES_FINAL="$BACKUP_DIR/receipt-files-$STAMP.tar.gz"
FILES_TEMP="$FILES_FINAL.tmp"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

docker exec pocketplan-supabase-db pg_dump \
  --username postgres \
  --dbname postgres \
  --schema public \
  --schema auth \
  --schema storage \
  --format custom \
  --no-owner \
  --no-privileges > "$DATABASE_TEMP"

docker exec --interactive pocketplan-supabase-db \
  pg_restore --list < "$DATABASE_TEMP" > /dev/null

tar -C "$STORAGE_DIR" -czf "$FILES_TEMP" .
tar -tzf "$FILES_TEMP" > /dev/null

chmod 600 "$DATABASE_TEMP" "$FILES_TEMP"
mv "$DATABASE_TEMP" "$DATABASE_FINAL"
mv "$FILES_TEMP" "$FILES_FINAL"

find "$BACKUP_DIR" \
  -type f \
  -mtime +30 \
  \( -name 'supabase-public-auth-storage-*.dump' -o -name 'receipt-files-*.tar.gz' \) \
  -delete
