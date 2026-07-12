#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
DB_PASSWORD=$(openssl rand -base64 32 | tr -cd '[:alnum:]' | head -c 32)

MAPTILER_KEY="indsaet_din_maptiler_key"
if [ -f "$ENV_FILE" ]; then
  EXISTING=$(grep -E '^MAPTILER_KEY=' "$ENV_FILE" | cut -d'=' -f2- || true)
  if [ -n "$EXISTING" ]; then MAPTILER_KEY="$EXISTING"; fi
fi

cat > "$ENV_FILE" <<EOF
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
MAPTILER_KEY=$MAPTILER_KEY
EOF

echo ".env oprettet med sikre secrets"
echo "DB_PASSWORD starter med: ${DB_PASSWORD:0:8}"
echo "JWT_SECRET starter med:  ${JWT_SECRET:0:12}"
echo "ENCRYPTION_KEY starter med: ${ENCRYPTION_KEY:0:12}"
echo "Husk at indsaette din rigtige MAPTILER_KEY i .env"
