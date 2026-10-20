$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$proxyVariables = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')
$hasDeadLocalProxy = $false
foreach ($name in $proxyVariables) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($value -match '^https?://(?:127\.0\.0\.1|localhost):9/?$') { $hasDeadLocalProxy = $true }
}
if ($hasDeadLocalProxy) {
    $internetSettings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    $systemProxy = if ($internetSettings.ProxyEnable -eq 1) { [string]$internetSettings.ProxyServer } else { '' }
    if ($systemProxy -match '(?:^|;)https?=(?<mapped>[^;]+)') { $systemProxy = $Matches.mapped }
    elseif ($systemProxy -match '(?:^|;)http=(?<mapped>[^;]+)') { $systemProxy = $Matches.mapped }
    elseif ($systemProxy.Contains(';')) { $systemProxy = ($systemProxy -split ';')[0] }
    $systemProxy = $systemProxy.Trim()
    if ($systemProxy -and $systemProxy -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') { $systemProxy = "http://$systemProxy" }
    if ($systemProxy) {
        foreach ($name in $proxyVariables) { [Environment]::SetEnvironmentVariable($name, $systemProxy, 'Process') }
        Write-Host "已将失效的本地代理替换为 Windows 系统代理：$systemProxy"
    } else {
        foreach ($name in $proxyVariables) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        Write-Host 'Windows 未启用系统代理，已清除失效代理，使用直连。'
    }
}

$pythonCandidates = @()

if ($env:IMAGEREQ_PYTHON) { $pythonCandidates += $env:IMAGEREQ_PYTHON }
$systemPython = Get-Command python -ErrorAction SilentlyContinue
if ($systemPython) { $pythonCandidates += $systemPython.Source }
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $bundledPython) { $pythonCandidates += $bundledPython }

$pythonExe = $null
foreach ($candidate in ($pythonCandidates | Select-Object -Unique)) {
    try {
        & $candidate -c "import sys, openpyxl; print(sys.version_info >= (3,10))" *> $null
        if ($LASTEXITCODE -eq 0) { $pythonExe = $candidate; break }
    } catch { }
}

if (-not $pythonExe) {
    Write-Error '需要 Python 3.10+ 与 openpyxl。请安装 openpyxl，或设置 IMAGEREQ_PYTHON 指向可用的 Python。'
    exit 1
}

Write-Host "使用 Python：$pythonExe"
Write-Host '服务地址：http://127.0.0.1:8766'
Set-Location -LiteralPath $projectRoot
& $pythonExe '.\app.py'
