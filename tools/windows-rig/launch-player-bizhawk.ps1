param(
  [string]$RigRoot = "C:\bizhawk-rig",
  [string]$Rom = "C:\dw3-rig\dw2003.cue",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$ActiveRoot = Join-Path $RigRoot "bizhawk-active"
$Exe = Join-Path $ActiveRoot "EmuHawk.exe"
$VersionFile = Join-Path $RigRoot "version.json"
$BaseConfig = Join-Path $ActiveRoot "config.ini"
$PlayerConfig = Join-Path $RigRoot "player-config.ini"
$Entry = Join-Path $RigRoot "player-entry.lua"

foreach ($Required in @($Exe, $VersionFile, $BaseConfig, $Rom, $Entry,
    (Join-Path $RigRoot "player-control.lua"),
    (Join-Path $RigRoot "bizhawk-agent-interface.lua"),
    (Join-Path $RigRoot "bridge-portable.lua"))) {
  if (!(Test-Path -LiteralPath $Required -PathType Leaf)) {
    throw "Player setup is missing $Required"
  }
}
$Version = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
if ($Version.tag -ne "2.11.1") { throw "This player setup requires pinned BizHawk 2.11.1." }

# Keep the user's ordinary configuration untouched. Preserve later edits to
# this player profile (including controller bindings), enforcing only the
# predictable launch/capture settings below.
$ConfigSource = if (Test-Path -LiteralPath $PlayerConfig) { $PlayerConfig } else { $BaseConfig }
$Config = Get-Content -LiteralPath $ConfigSource -Raw | ConvertFrom-Json
$Config.PreferredCores.PSX = "Octoshock"
$Settings = @{
  StartPaused = $false; StartFullscreen = $false; RunInBackground = $true
  AcceptBackgroundInput = $false; AcceptBackgroundInputControllerOnly = $false
  AutoLoadLastSaveSlot = $false; AutoSaveLastSaveSlot = $false
  SpeedPercent = 100; ClockThrottle = $true; Unthrottled = $false
}
foreach ($Key in $Settings.Keys) {
  $Config | Add-Member -NotePropertyName $Key -NotePropertyValue $Settings[$Key] -Force
}

if ($CheckOnly) {
  Write-Host "PLAYER SETUP CHECK OK: pinned files, profile and observer entry are present."
  Write-Host "Game window and live bridge have not been tested by this check."
  exit 0
}

# Do not reset the bridge of an existing player session or open a second game.
if (Get-Process -Name EmuHawk -ErrorAction SilentlyContinue) {
  Write-Host "BizHawk is already open. Use that window; tell the agent to check its connection."
  exit 0
}

$Utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($PlayerConfig, ($Config | ConvertTo-Json -Depth 100), $Utf8)
foreach ($Dir in @("rpc", "dumps", "shots", "states")) {
  New-Item -ItemType Directory -Force (Join-Path $RigRoot $Dir) | Out-Null
}
# Only stale transport messages are removed. Saves and captures are retained.
foreach ($Name in @("cmd.ready", "cmd.lua", "res.ready", "res.txt", "bridge.ready")) {
  $OldMessage = Join-Path $RigRoot ("rpc\" + $Name)
  if (Test-Path -LiteralPath $OldMessage) { Remove-Item -LiteralPath $OldMessage -Force }
}

$env:BIZHAWK_RIG_ROOT = ($RigRoot -replace "\\", "/")
$env:DW3_PLAYER_SESSION = [Guid]::NewGuid().ToString("N")
Write-Host "Opening Digimon. You control the game; the agent can observe."
Write-Host "When the agent asks for a place or action, get there and say ready."
Write-Host "Recording starts only after the agent says it is ready."
Write-Host "The game keeps running while you chat; keyboard input goes to the focused game window."

# A visible GUI launch, with the ROM last as required by the pinned CLI.
# Do not redirect EmuHawk's stdout/stderr (the ordinary rig documents that failure).
Push-Location $ActiveRoot
try {
  & $Exe "--config=$PlayerConfig" "--lua=$Entry" $Rom
} finally {
  Pop-Location
}
