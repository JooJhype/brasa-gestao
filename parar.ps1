$brasaPidFile = Join-Path $PSScriptRoot 'data\servidor.pid'
if (Test-Path -LiteralPath $brasaPidFile) {
    $brasaServerPid = [int](Get-Content -LiteralPath $brasaPidFile)
    $brasaProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $brasaServerPid" -ErrorAction SilentlyContinue
    $brasaExpectedScript = Join-Path $PSScriptRoot 'src\server.mjs'
    if ($brasaProcessInfo -and $brasaProcessInfo.Name -eq 'node.exe' -and $brasaProcessInfo.CommandLine.Contains($brasaExpectedScript)) {
        Stop-Process -Id $brasaServerPid
        Write-Host 'Brasa encerrado. Seus dados continuam salvos.'
    }
}
