param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$InputPath,

    [Parameter(Mandatory = $true, Position = 1)]
    [string]$OutputPath,

    [string]$SourceMask,
    [string]$Key,
    [int]$EdgeContract = 0,
    [switch]$Overwrite
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Tool = Join-Path $PSScriptRoot "make_transparent.py"
$VenvRoot = Join-Path $env:LOCALAPPDATA "ddw3-walker\image-tools-venv"
$Python = Join-Path $VenvRoot "Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Preparing the small DDW3 image-tools environment..."
    py -3 -m venv $VenvRoot
}

& $Python -c "import PIL" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing Pillow..."
    & $Python -m pip install --disable-pip-version-check Pillow
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install Pillow."
    }
}

$Arguments = @($Tool, $InputPath, $OutputPath)
if ($SourceMask) {
    $Arguments += @("--source-mask", $SourceMask)
}
if ($Key) {
    $Arguments += @("--key", $Key)
}
if ($EdgeContract -gt 0) {
    $Arguments += @("--edge-contract", $EdgeContract)
}
if ($Overwrite) {
    $Arguments += "--overwrite"
}

& $Python @Arguments
if ($LASTEXITCODE -ne 0) {
    throw "Transparency conversion failed with exit code $LASTEXITCODE"
}
