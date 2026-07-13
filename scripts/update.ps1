$CONTAINER = "root@10.10.0.91"
$REMOTE    = "/opt/urban-explorer"
$KEY       = "$HOME\.ssh\urban-explorer"
$LOCAL     = "$PSScriptRoot\.."

Write-Host "Synkroniserer kildekode..." -ForegroundColor Cyan
ssh -i $KEY $CONTAINER "mkdir -p $REMOTE/app $REMOTE/db && rm -rf $REMOTE/app/src $REMOTE/app/public"
& scp -i $KEY -r "$LOCAL\app\src"                "${CONTAINER}:${REMOTE}/app/"
& scp -i $KEY -r "$LOCAL\app\public"             "${CONTAINER}:${REMOTE}/app/"
& scp -i $KEY    "$LOCAL\app\Dockerfile"         "${CONTAINER}:${REMOTE}/app/Dockerfile"
& scp -i $KEY    "$LOCAL\app\package.json"       "${CONTAINER}:${REMOTE}/app/package.json"
if (Test-Path "$LOCAL\app\package-lock.json") {
    & scp -i $KEY "$LOCAL\app\package-lock.json" "${CONTAINER}:${REMOTE}/app/package-lock.json"
}
& scp -i $KEY    "$LOCAL\app\next.config.ts"     "${CONTAINER}:${REMOTE}/app/next.config.ts"
& scp -i $KEY    "$LOCAL\app\tsconfig.json"      "${CONTAINER}:${REMOTE}/app/tsconfig.json"
& scp -i $KEY    "$LOCAL\app\tailwind.config.ts" "${CONTAINER}:${REMOTE}/app/tailwind.config.ts"
& scp -i $KEY    "$LOCAL\app\postcss.config.js"  "${CONTAINER}:${REMOTE}/app/postcss.config.js"
& scp -i $KEY    "$LOCAL\docker-compose.yml"     "${CONTAINER}:${REMOTE}/docker-compose.yml"
& scp -i $KEY    "$LOCAL\db\init.sql"            "${CONTAINER}:${REMOTE}/db/init.sql"
if (Test-Path "$LOCAL\db\migration_001.sql") {
    & scp -i $KEY "$LOCAL\db\migration_001.sql"  "${CONTAINER}:${REMOTE}/db/migration_001.sql"
}
if (Test-Path "$LOCAL\db\migration_002.sql") {
    & scp -i $KEY "$LOCAL\db\migration_002.sql"  "${CONTAINER}:${REMOTE}/db/migration_002.sql"
}
if (Test-Path "$LOCAL\db\migration_003.sql") {
    & scp -i $KEY "$LOCAL\db\migration_003.sql"  "${CONTAINER}:${REMOTE}/db/migration_003.sql"
}
if (Test-Path "$LOCAL\db\migration_004.sql") {
    & scp -i $KEY "$LOCAL\db\migration_004.sql"  "${CONTAINER}:${REMOTE}/db/migration_004.sql"
}
if (Test-Path "$LOCAL\db\migration_005.sql") {
    & scp -i $KEY "$LOCAL\db\migration_005.sql"  "${CONTAINER}:${REMOTE}/db/migration_005.sql"
}
& scp -i $KEY    "$LOCAL\.env"                   "${CONTAINER}:${REMOTE}/.env"

Write-Host "Koerer database-migrationer..." -ForegroundColor Cyan
ssh -i $KEY $CONTAINER "cd $REMOTE && docker compose up -d db && until docker compose exec -T db pg_isready -U urbanexplorer -d urbanexplorer; do sleep 1; done && docker compose exec -T db psql -U urbanexplorer -d urbanexplorer < db/migration_001.sql && docker compose exec -T db psql -U urbanexplorer -d urbanexplorer < db/migration_002.sql && docker compose exec -T db psql -U urbanexplorer -d urbanexplorer < db/migration_003.sql && docker compose exec -T db psql -U urbanexplorer -d urbanexplorer < db/migration_004.sql && docker compose exec -T db psql -U urbanexplorer -d urbanexplorer < db/migration_005.sql"

Write-Host "Bygger og genstarter app..." -ForegroundColor Cyan
ssh -i $KEY $CONTAINER "cd $REMOTE && docker compose up -d --build app"

Write-Host "Faerdig! Appen koerer nu paa serveren." -ForegroundColor Green
