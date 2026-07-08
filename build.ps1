Set-Location "d:\Job\jellyfin-web"
$env:PATH = "d:\Job\jellyfin-web\.nenv\node-v24.18.0-win-x64;" + $env:PATH

if (-not (Test-Path node_modules\.bin\webpack.cmd)) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install --no-audit
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

$env:NODE_ENV = "production"
Write-Host "Building..." -ForegroundColor Cyan
& node node_modules/webpack/bin/webpack.js --config webpack.prod.js 2>&1 | Select-Object -Last 3

Write-Host "Deploying..." -ForegroundColor Cyan
if (Test-Path dist\index.html) {
    robocopy dist "D:\Jellyfin\system\jellyfin-web" /MIR /NJH /NJS /NP /NS /NC /NFL /NDL
    Write-Host "Done!" -ForegroundColor Green
} else {
    Write-Host "FAIL: index.html missing" -ForegroundColor Red
}
