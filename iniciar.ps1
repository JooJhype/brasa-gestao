param([switch]$SemAbrirNavegador)
$ErrorActionPreference = 'Stop'
$brasaRoot = $PSScriptRoot
$brasaUrl = 'http://127.0.0.1:4310'
try {
    $brasaNode = (Get-Command node -ErrorAction Stop).Source
    $brasaVersion = & $brasaNode --version
    if ([int]($brasaVersion.TrimStart('v').Split('.')[0]) -lt 24) { throw 'É necessário Node.js 24 ou superior.' }
    $brasaRunning = $false
    try {
        $brasaHealth = Invoke-RestMethod -Uri "$brasaUrl/api/health" -TimeoutSec 2
        $brasaRunning = $brasaHealth.app -eq 'brasa-gestao'
    } catch { }
    if (-not $brasaRunning) {
        $env:BRASA_PORT = '4310'
        $env:BRASA_DATA_DIR = Join-Path $brasaRoot 'data'
        $brasaServer = Join-Path $brasaRoot 'src\server.mjs'
        $brasaLog = Join-Path $brasaRoot 'data\servidor.log'
        $brasaErr = Join-Path $brasaRoot 'data\servidor-erros.log'
        New-Item -ItemType Directory -Force -Path (Join-Path $brasaRoot 'data') | Out-Null
        $brasaProcess = Start-Process -FilePath $brasaNode -ArgumentList @('"' + $brasaServer + '"') -WorkingDirectory $brasaRoot -WindowStyle Hidden -RedirectStandardOutput $brasaLog -RedirectStandardError $brasaErr -PassThru
        $brasaProcess.Id | Set-Content -LiteralPath (Join-Path $brasaRoot 'data\servidor.pid')
        for ($brasaAttempt = 0; $brasaAttempt -lt 40; $brasaAttempt++) {
            Start-Sleep -Milliseconds 250
            try {
                $brasaHealth = Invoke-RestMethod -Uri "$brasaUrl/api/health" -TimeoutSec 1
                if ($brasaHealth.app -eq 'brasa-gestao') { $brasaRunning = $true; break }
            } catch { }
            if ($brasaProcess.HasExited) { break }
        }
    }
    if (-not $brasaRunning) { throw 'Não foi possível iniciar o Brasa. Confira data\servidor-erros.log. A porta 4310 pode estar ocupada.' }
    if (-not $SemAbrirNavegador) { Start-Process $brasaUrl }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'Instale o Node.js 24 LTS em https://nodejs.org se necessário.'
    Read-Host 'Pressione Enter para fechar'
}
