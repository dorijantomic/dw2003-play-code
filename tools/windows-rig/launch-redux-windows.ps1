param(
  # Show the Redux GUI window instead of running with -no-ui. The RPC bridge
  # works either way; a visible window lets the operator watch the run.
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

$RigRoot = if ($env:DW3_RIG_ROOT) { $env:DW3_RIG_ROOT } else { "C:\dw3-rig" }
$env:DW3_RIG_ROOT = ($RigRoot -replace "\\", "/")

$ActiveRoot = Join-Path $RigRoot "pcsx-redux-active"
$Exe = Join-Path $ActiveRoot "pcsx-redux.exe"
$VersionFile = Join-Path $ActiveRoot "version.json"
if (!(Test-Path $Exe)) {
  throw "Missing pinned PCSX-Redux build 314 at $Exe"
}
if (!(Test-Path $VersionFile)) {
  throw "Missing pinned PCSX-Redux version file at $VersionFile"
}

$Version = Get-Content -Raw $VersionFile | ConvertFrom-Json
if ($Version.buildId -ne 314 -or $Version.changeset -ne "d658f89ebc5842b046e3fd2776133a9d2ea4d0c1") {
  throw "Refusing to run PCSX-Redux build $($Version.buildId) changeset $($Version.changeset). This rig is pinned to Windows build 314 / d658f89e for savestate compatibility."
}

$Bios = Join-Path $RigRoot "SCPH1001.BIN"
$Iso = Join-Path $RigRoot "dw2003.cue"
$Bridge = Join-Path $RigRoot "bridge-portable.lua"
$Log = Join-Path $RigRoot "redux.log"

foreach ($Dir in @("rpc", "dumps", "shots", "states")) {
  New-Item -ItemType Directory -Force (Join-Path $RigRoot $Dir) | Out-Null
}

Remove-Item -Force -ErrorAction SilentlyContinue `
  (Join-Path $RigRoot "rpc\cmd.ready"), `
  (Join-Path $RigRoot "rpc\res.ready"), `
  (Join-Path $RigRoot "rpc\res.txt")

Push-Location (Split-Path -Parent $Exe)
try {
  $UiArgs = if ($Visible) { @() } else { @("-no-ui") }
  & $Exe @UiArgs -stdout -bios $Bios -iso $Iso -run -dofile $Bridge *> $Log
} finally {
  Pop-Location
}
