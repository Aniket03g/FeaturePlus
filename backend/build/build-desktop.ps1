<#
.SYNOPSIS
    Build the FeaturePlus desktop application for Windows.

.DESCRIPTION
    Produces build\bin\FeaturePlus.exe. The order matters: the frontend is
    built first because go:embed bakes backend\web\dist into the binary at
    compile time, so an exe built before `npm run build` ships the previous
    bundle and there is nothing at runtime to tell you.

.PARAMETER SkipFrontend
    Reuse the bundle already in backend\web\dist. Only for a Go-only change.

.PARAMETER Version
    Version to stamp into the executable, as x.y.z. Defaults to whatever is
    already in cmd\desktop\versioninfo.json.

.EXAMPLE
    .\build\build-desktop.ps1 -Version 0.2.0
#>

[CmdletBinding()]
param(
    [switch]$SkipFrontend,
    [string]$Version
)

$ErrorActionPreference = 'Stop'

# npm and go write progress and warnings to stderr even on success. With
# ErrorActionPreference set to Stop, PowerShell turns any stderr line from a
# native command into a terminating NativeCommandError — so a Vite chunk-size
# warning would fail the build. Native commands are run through Invoke-Native
# below, which judges them by their exit code, which is the only thing that
# actually says whether they worked.
function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$What,
        [Parameter(Mandatory)][scriptblock]$Command
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Command 2>&1 | ForEach-Object { Write-Host "    $_" }
    } finally {
        $ErrorActionPreference = $previous
    }

    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

$backend = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $backend
$frontend = Join-Path $repo 'frontend'
$desktop = Join-Path $backend 'cmd\desktop'
$output = Join-Path $backend 'build\bin\FeaturePlus.exe'

function Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }

# --- The frontend, first ------------------------------------------------------
if (-not $SkipFrontend) {
    Step 'Building the frontend'
    Push-Location $frontend
    try {
        if (-not (Test-Path 'node_modules')) {
            Invoke-Native 'npm ci' { npm ci }
        }
        Invoke-Native 'The frontend build' { npm run build }
    } finally {
        Pop-Location
    }

    # Vite names each bundle by its content hash, so yesterday's files pile up
    # in dist and get embedded along with today's.
    Step 'Pruning stale bundles'
    $index = Get-Content (Join-Path $backend 'web\dist\index.html') -Raw
    Get-ChildItem (Join-Path $backend 'web\dist\assets') -File | ForEach-Object {
        if ($index -notmatch [regex]::Escape($_.Name)) {
            Write-Host "    dropping $($_.Name)"
            Remove-Item $_.FullName
        }
    }
} else {
    Step 'Skipping the frontend (using the bundle already in web\dist)'
}

# --- Version and icon ---------------------------------------------------------
Push-Location $desktop
try {
    if ($Version) {
        if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be x.y.z, got '$Version'" }
        Step "Stamping version $Version"

        $parts = $Version.Split('.')
        $info = Get-Content 'versioninfo.json' -Raw | ConvertFrom-Json

        foreach ($field in 'FileVersion', 'ProductVersion') {
            $info.FixedFileInfo.$field.Major = [int]$parts[0]
            $info.FixedFileInfo.$field.Minor = [int]$parts[1]
            $info.FixedFileInfo.$field.Patch = [int]$parts[2]
        }
        $info.StringFileInfo.FileVersion = $Version
        $info.StringFileInfo.ProductVersion = $Version

        $info | ConvertTo-Json -Depth 10 | Set-Content 'versioninfo.json' -Encoding utf8
    }

    Step 'Embedding the icon and version info'
    Invoke-Native 'Generating the resource file' {
        go run github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.7.0 `
            -o 'resource_windows_amd64.syso' 'versioninfo.json'
    }
} finally {
    Pop-Location
}

# --- The executable -----------------------------------------------------------
Step 'Building the executable'
Push-Location $backend
try {
    New-Item -ItemType Directory -Force -Path (Split-Path $output) | Out-Null

    # -H windowsgui: no console window behind the app.
    # -s -w: drop the symbol table and DWARF, which halves the binary. Nothing
    # here needs a Go stack trace in the field; the app writes its own log.
    Invoke-Native 'The Go build' {
        go build -tags desktop,production -ldflags '-H windowsgui -s -w' -o $output '.\cmd\desktop'
    }
} finally {
    Pop-Location
}

$exe = Get-Item $output
Step ('Built {0} ({1:N1} MB, version {2})' -f $exe.Name, ($exe.Length / 1MB), $exe.VersionInfo.FileVersion)
Write-Host "    $output"
Write-Host ''
Write-Host 'Not signed. See build\README.md for signing and packaging.' -ForegroundColor Yellow
