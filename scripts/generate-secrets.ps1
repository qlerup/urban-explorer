$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

$jwtBytes = New-Object byte[] 64
$rng.GetBytes($jwtBytes)
$jwtSecret = [Convert]::ToBase64String($jwtBytes)

$encBytes = New-Object byte[] 32
$rng.GetBytes($encBytes)
$encKey = [Convert]::ToBase64String($encBytes)

$dbBytes = New-Object byte[] 32
$rng.GetBytes($dbBytes)
$dbPassRaw = [Convert]::ToBase64String($dbBytes) -replace '[^a-zA-Z0-9]', ''
$dbPass = $dbPassRaw.Substring(0, [Math]::Min(32, $dbPassRaw.Length))

$rng.Dispose()

$envPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($PSScriptRoot, "..", ".env"))

$maptilerKey = "indsaet_din_maptiler_key"
if (Test-Path $envPath) {
    $existing = Get-Content $envPath -Raw
    if ($existing -match 'MAPTILER_KEY=(.*)') { $maptilerKey = $matches[1].Trim() }
}

$lines = "DB_PASSWORD=$dbPass", "JWT_SECRET=$jwtSecret", "ENCRYPTION_KEY=$encKey", "MAPTILER_KEY=$maptilerKey"
$lines -join "`n" | Out-File -FilePath $envPath -Encoding utf8 -NoNewline

Write-Host ".env fil oprettet med sikre secrets" -ForegroundColor Green
Write-Host "DB_PASSWORD starter med: $($dbPass.Substring(0,8))" -ForegroundColor Gray
Write-Host "JWT_SECRET starter med: $($jwtSecret.Substring(0,12))" -ForegroundColor Gray
Write-Host "ENCRYPTION_KEY starter med: $($encKey.Substring(0,12))" -ForegroundColor Gray
Write-Host "Husk at indsaette din rigtige MAPTILER_KEY i .env" -ForegroundColor Yellow
