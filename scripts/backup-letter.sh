#!/bin/sh
# Example: run a backup from cron and post the result to the Raven Post in Wudland.
#   0 3 * * *  /path/to/backup-letter.sh
set -u

SRC="$HOME/documents"
DEST="$HOME/backups/documents"

if rsync -a --delete "$SRC/" "$DEST/" 2>/tmp/backup-letter.err; then
  wudland letter "Backup finished" "Documents copied to $DEST at $(date '+%H:%M')."
else
  wudland letter "Backup failed" "$(tail -n 3 /tmp/backup-letter.err | tr '\n' ' ')"
  exit 1
fi
