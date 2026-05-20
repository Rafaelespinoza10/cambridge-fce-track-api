param(
    [string] $Service  = "",
    [string] $Function = "",
    [string] $Stage    = "dev",
    [switch] $List
)

$ScriptDir = $PSScriptRoot
Set-Location $ScriptDir

$PathMap = Join-Path $ScriptDir "serverless.path-map.conf"

function Get-MapServiceNames {
    $names = @()
    foreach ($line in Get-Content $PathMap) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $names += ($line -split '=', 2)[0].Trim()
    }
    return $names
}

$SERVICES = Get-MapServiceNames

function Get-ServiceConfigPath($svcName) {
    Join-Path $ScriptDir "src\services\$svcName.serverless.yml"
}

function Write-Header {
    Write-Host ""
    Write-Host "Cambridge FCE Track API — Deploy" -ForegroundColor White
    Write-Host "Stage: $Stage" -ForegroundColor DarkGray
    Write-Host "────────────────────────────────────────" -ForegroundColor DarkGray
}
function Write-Ok($msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "✖ $msg" -ForegroundColor Red   }

function Get-ServiceFunctions($svcName) {
    $file = Get-ServiceConfigPath $svcName
    $fns = @()
    $inF = $false
    foreach ($line in Get-Content $file) {
        if ($line -match '^\s*functions:\s*\{\s*\}\s*$') { continue }
        if ($line -match '^functions:') {
            $inF = $true
            $rest = $line -replace '^functions:\s*', ''
            if ($rest -match '^\{\s*\}\s*$') { $inF = $false }
            continue
        }
        if ($inF -and $line -match '^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$') { $fns += $matches[1] }
        if ($inF -and $line -match '^[a-zA-Z]') { $inF = $false }
    }
    return $fns
}

function Show-List {
    Write-Host ""; Write-Host "Servicios disponibles (src/services/*.serverless.yml):" -ForegroundColor White; Write-Host ""
    foreach ($svc in $SERVICES) {
        Write-Host "  -Service $svc" -ForegroundColor Yellow
        foreach ($fn in Get-ServiceFunctions $svc) { Write-Host "    -Function $fn" -ForegroundColor DarkGray }
        Write-Host ""
    }
}

# ─── List ─────────────────────────────────────────────────────────────────────
if ($List) { Show-List; exit 0 }

# ─── Validate ─────────────────────────────────────────────────────────────────
if ($Service -ne "" -and -not (Test-Path (Get-ServiceConfigPath $Service))) {
    Write-Fail "No existe $(Get-ServiceConfigPath $Service)"; Show-List; exit 1
}

# Copia temporal al root para satisfacer la restricción de Serverless v3
function Invoke-SlsDeploy($svcName, [string[]]$SlsArgs) {
    $src = Get-ServiceConfigPath $svcName
    $tmpName = "_$($svcName)_tmp.serverless.yml"
    $tmp = Join-Path $ScriptDir $tmpName
    Copy-Item $src $tmp -Force
    try {
        npx serverless @SlsArgs --config $tmpName --stage $Stage
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

Write-Header

if ($Function -ne "" -and $Service -ne "") {
    Write-Host "→ Función: $Function  (servicio: $Service)" -ForegroundColor Cyan
    Write-Host ""
    Invoke-SlsDeploy $Service @("deploy", "function", "--function", $Function)
    if ($LASTEXITCODE -ne 0) { Write-Fail "Falló el deploy de $Function"; exit 1 }

} elseif ($Service -ne "") {
    $fns = Get-ServiceFunctions $Service
    Write-Host "→ Servicio: $Service  ($($fns.Count) función/es, stack completo)" -ForegroundColor Cyan
    Write-Host ""
    Invoke-SlsDeploy $Service @("deploy")
    if ($LASTEXITCODE -ne 0) { Write-Fail "Falló el deploy de $Service"; exit 1 }

} else {
    Write-Host "→ Deploy desde serverless.yml en la raíz del repo" -ForegroundColor Yellow
    Write-Host ""
    npx serverless deploy --stage $Stage
    if ($LASTEXITCODE -ne 0) { Write-Fail "Falló el deploy completo"; exit 1 }
}

Write-Host ""
Write-Ok "Deploy completado"
Write-Host ""
