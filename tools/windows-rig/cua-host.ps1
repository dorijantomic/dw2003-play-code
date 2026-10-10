param([ValidateSet('discover','inspect','start','launch')][string]$Action = 'discover')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Request = [Console]::In.ReadToEnd() | ConvertFrom-Json
function Quote-Arg([string]$Value) {
  if ($Value.Contains('"') -or $Value.Contains("`n")) { throw 'Invalid path argument' }
  return '"' + $Value + '"'
}
if ($Action -eq 'discover') {
  $Driver = Get-Command cua-driver.exe -ErrorAction SilentlyContinue
  $Path = if ($Driver) { $Driver.Source } else {
    Join-Path $env:LOCALAPPDATA 'Programs\Cua\cua-driver\bin\cua-driver.exe'
  }
  @{driver=$Path; installed=(Test-Path -LiteralPath $Path -PathType Leaf)} | ConvertTo-Json -Compress
} elseif ($Action -eq 'inspect') {
  $Name = if ($Request.emulator -eq 'bizhawk') { 'EmuHawk' } else { 'pcsx-redux' }
  $Matches = @(Get-Process -Name $Name -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($Request.executable)
  } | ForEach-Object { @{pid=$_.Id; path=$_.Path; title=$_.MainWindowTitle; window_id=$_.MainWindowHandle.ToInt64()} })
  @{processes=$Matches} | ConvertTo-Json -Depth 4 -Compress
} elseif ($Action -eq 'start') {
  if (!(Test-Path -LiteralPath $Request.driver -PathType Leaf)) { throw 'Cua Driver is not installed' }
  $env:CUA_DRIVER_TELEMETRY_ENABLED = 'false'
  $Arguments = @('serve','--socket',(Quote-Arg $Request.socket),'--permission-mode','bounded',
    '--capability-manifest',(Quote-Arg $Request.manifest),'--approve-capability-manifest','--no-overlay')
  # RedirectStandardOutput/Error makes Windows PowerShell wait on the daemon's
  # asynchronous stream readers when launched through WSL. Shell-launch without
  # redirected pipes; the caller verifies readiness using the private endpoint.
  $Process = Start-Process -FilePath $Request.driver -ArgumentList $Arguments -WindowStyle Hidden -PassThru `
    -WorkingDirectory (Split-Path -Parent $Request.driver)
  @{pid=$Process.Id; mode='bounded'; socket=$Request.socket} | ConvertTo-Json -Compress
} else {
  # Reuse the installed, pinned launcher; never reset a running bridge.
  $Name = if ($Request.emulator -eq 'bizhawk') { 'EmuHawk' } else { 'pcsx-redux' }
  $Existing = @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
  if ($Existing.Count) { throw 'Emulator already running; inspect it instead of launching another' }
  if (!(Test-Path -LiteralPath $Request.launcher -PathType Leaf)) { throw 'Missing project emulator launcher' }
  if ($Request.emulator -eq 'bizhawk') {
    $Arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Quote-Arg $Request.launcher),
      '-RigRoot',(Quote-Arg $Request.rig_root),'-Rom',(Quote-Arg $Request.rom))
  } else {
    $env:DW3_RIG_ROOT = $Request.rig_root
    $Arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Quote-Arg $Request.launcher),'-Visible')
  }
  $Process = Start-Process powershell.exe -ArgumentList $Arguments -WindowStyle Hidden -PassThru `
    -WorkingDirectory $Request.rig_root
  @{launcher_pid=$Process.Id} | ConvertTo-Json -Compress
}
