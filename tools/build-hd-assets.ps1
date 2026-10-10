[CmdletBinding()]
param(
    [switch] $Force,
    [switch] $IncludeReference,
    [int] $Limit = 0,
    [ValidateSet("Auto", "DirectML", "Vulkan")]
    [string] $Backend = "Auto",
    [switch] $AllowCompatibilityFallback,
    [int] $GpuIndex = -1,
    [int] $Tile = 512,
    [int] $Overlap = 64,
    [int] $NcnnBatch = 64,
    [string[]] $Include = @(),
    [string[]] $Exclude = @()
)

$ErrorActionPreference = "Stop"
$Release = "20220424"
$DownloadUrl = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-$Release-windows.zip"
$UvDownloadUrl = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CacheRoot = Join-Path $env:LOCALAPPDATA "ddw3-walker"
$NcnnRoot = Join-Path $CacheRoot "realesrgan-ncnn-vulkan-$Release"
$Archive = Join-Path $CacheRoot "realesrgan-ncnn-vulkan-$Release-windows.zip"
$UvRoot = Join-Path $CacheRoot "uv-portable"
$UvArchive = Join-Path $CacheRoot "uv-x86_64-pc-windows-msvc.zip"
$Venv = Join-Path $CacheRoot "hd-upscaler-python312-v2"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
$ModelCache = Join-Path $CacheRoot "models"

New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null

function Get-NcnnExe {
    $Executable = Get-ChildItem -Path $NcnnRoot -Filter "realesrgan-ncnn-vulkan.exe" `
        -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Executable) {
        Write-Host "Downloading the portable Real-ESRGAN Vulkan backend..."
        Invoke-WebRequest -Uri $DownloadUrl -OutFile $Archive
        if (Test-Path $NcnnRoot) {
            Remove-Item -Path $NcnnRoot -Recurse -Force
        }
        Expand-Archive -Path $Archive -DestinationPath $NcnnRoot
        $Executable = Get-ChildItem -Path $NcnnRoot `
            -Filter "realesrgan-ncnn-vulkan.exe" -File -Recurse |
            Select-Object -First 1
        if (-not $Executable) {
            throw "The official archive did not contain realesrgan-ncnn-vulkan.exe"
        }
    }
    return $Executable
}

function Get-UvExe {
    $Executable = Get-ChildItem -Path $UvRoot -Filter "uv.exe" `
        -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $Executable) {
        Write-Host "Downloading the portable Python environment manager..."
        New-Item -ItemType Directory -Force -Path $UvRoot | Out-Null
        Invoke-WebRequest -Uri $UvDownloadUrl -OutFile $UvArchive
        Expand-Archive -Path $UvArchive -DestinationPath $UvRoot -Force
        $Executable = Get-ChildItem -Path $UvRoot -Filter "uv.exe" `
            -File -Recurse | Select-Object -First 1
        if (-not $Executable) {
            throw "The official uv archive did not contain uv.exe"
        }
    }
    return $Executable
}

if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating the Windows HD build environment..."
    $Created = $false
    $Py = Get-Command py -ErrorAction SilentlyContinue
    if ($Py) {
        foreach ($Version in @("-3.12", "-3.11", "-3.10")) {
            & $Py.Source $Version -m venv $Venv 2>$null
            if ($LASTEXITCODE -eq 0) {
                $Created = $true
                break
            }
        }
    }
    if (-not $Created) {
        Write-Host "No DirectML-compatible Python found; installing isolated Python 3.12..."
        if (Test-Path $Venv) {
            Remove-Item -Path $Venv -Recurse -Force
        }
        $UvExe = Get-UvExe
        & $UvExe.FullName python install 3.12 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Could not install portable Python 3.12."
        }
        & $UvExe.FullName venv --python 3.12 --seed $Venv | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create the Python 3.12 HD environment."
        }
    }
}

& $VenvPython -c "import sys; assert (3, 10) <= sys.version_info[:2] <= (3, 12)"
if ($LASTEXITCODE -ne 0) {
    throw "The HD environment must use Python 3.10-3.12 for torch-directml."
}

& $VenvPython -c "import PIL, numpy" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing the small Pillow and NumPy helper packages..."
    & $VenvPython -m pip install --disable-pip-version-check Pillow numpy
    if ($LASTEXITCODE -ne 0) {
        throw "Could not install the Pillow and NumPy helper packages."
    }
}

function Get-CommonUpscalerArgs {
    $Arguments = @(
    "--src-dir", (Join-Path $RepoRoot "web\assets"),
    "--out-dir", (Join-Path $RepoRoot "web\assets-hd"),
    "--tile", $Tile,
    "--overlap", $Overlap,
    "--model-cache", $ModelCache
    )
    if ($Force) { $Arguments += "--force" }
    if ($IncludeReference) { $Arguments += "--include-reference" }
    if ($Limit -gt 0) { $Arguments += @("--limit", $Limit) }
    foreach ($Pattern in $Include) { $Arguments += @("--include", $Pattern) }
    foreach ($Pattern in $Exclude) { $Arguments += @("--exclude", $Pattern) }
    return $Arguments
}

function Invoke-DirectMLBuild {
    Write-Host "Preparing the asset-aware DirectML backend (AMD and Nvidia)..."
    & $VenvPython -c "import torch_directml, spandrel, spandrel_extra_arches, gdown" 2>$null
    if ($LASTEXITCODE -ne 0) {
        & $VenvPython -m pip install --disable-pip-version-check `
            torch-directml spandrel spandrel_extra_arches gdown | Out-Host
        if ($LASTEXITCODE -ne 0) { return $false }
    }
    $Arguments = @(Get-CommonUpscalerArgs) + @(
        "--backend", "torch",
        "--device", "directml"
    )
    if ($GpuIndex -ge 0) {
        $Arguments += @("--device-index", $GpuIndex)
    }
    Write-Host "Testing the specialist models on DirectML before the full build..."
    & $VenvPython (Join-Path $PSScriptRoot "upscale_assets.py") `
        @Arguments --directml-smoke-test | Out-Host
    if ($LASTEXITCODE -ne 0) { return $false }
    Write-Host "Building the asset-aware 4x HD pack with DirectML..."
    & $VenvPython (Join-Path $PSScriptRoot "upscale_assets.py") @Arguments | Out-Host
    return $LASTEXITCODE -eq 0
}

function Invoke-VulkanBuild {
    $NcnnExe = Get-NcnnExe
    $Arguments = @(Get-CommonUpscalerArgs) + @(
        "--backend", "ncnn",
        "--ncnn-exe", $NcnnExe.FullName,
        "--ncnn-batch", $NcnnBatch
    )
    Write-Host "Building the compatibility HD pack with Vulkan..."
    & $VenvPython (Join-Path $PSScriptRoot "upscale_assets.py") @Arguments | Out-Host
    return $LASTEXITCODE -eq 0
}

$Succeeded = $false
if ($Backend -eq "Auto" -or $Backend -eq "DirectML") {
    $Succeeded = Invoke-DirectMLBuild
    if (-not $Succeeded -and $Backend -eq "DirectML") {
        throw "The DirectML HD build failed. Try -Backend Vulkan for the compatibility profile."
    }
}
if (-not $Succeeded -and $Backend -eq "Auto" -and -not $AllowCompatibilityFallback) {
    throw "DirectML failed. The specialist FatePlus/HAT/APISR recipe was NOT replaced. Fix DirectML or explicitly use -Backend Vulkan (RealESRGAN compatibility output)."
}
if (-not $Succeeded -and ($Backend -eq "Vulkan" -or $AllowCompatibilityFallback)) {
    if ($Backend -eq "Auto") {
        Write-Warning "DirectML failed; explicit -AllowCompatibilityFallback permits RealESRGAN NCNN/Vulkan output."
    }
    $Succeeded = Invoke-VulkanBuild
}
if (-not $Succeeded) {
    throw "HD asset build failed. Update the AMD/Nvidia graphics driver and try again."
}

Write-Host "HD asset pack is ready. Start the game and choose HD Remaster."
