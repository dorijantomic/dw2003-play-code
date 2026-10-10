$ErrorActionPreference = 'Stop'
$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int n);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowTextW(h, sb, 512); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(512); GetClassNameW(h, sb, 512); return sb.ToString(); }
}
"@
Add-Type -TypeDefinition $code -Language CSharp

$proc = Get-Process -Name EmuHawk -ErrorAction SilentlyContinue
if (-not $proc) { Write-Output '{"error":"EmuHawk process not found"}'; exit 1 }
$pids = @($proc | ForEach-Object { [uint32]$_.Id })
Write-Output ("pids: " + ($pids -join ','))

$restored = @()
$found = @()
$cb = [Win+EnumWindowsProc]{
  param($h, $l)
  $wpid = [uint32]0
  [void][Win]::GetWindowThreadProcessId($h, [ref]$wpid)
  if ($pids -contains $wpid) {
    $title = [Win]::Title($h); $cls = [Win]::Cls($h)
    $iconic = [Win]::IsIconic($h); $vis = [Win]::IsWindowVisible($h)
    $script:found += ("hwnd=$h cls='$cls' title='$title' iconic=$iconic visible=$vis")
    if ($title -ne '' -or $cls -like '*EmuHawk*' -or $cls -like '*SDL*') {
      if ($iconic) {
        [void][Win]::ShowWindow($h, 9)   # SW_RESTORE
        Start-Sleep -Milliseconds 250
        $script:restored += ("restored hwnd=$h title='$title'")
      }
    }
  }
  return $true
}
[void][Win]::EnumWindows($cb, [IntPtr]::Zero)
Write-Output '--- windows ---'
$found | ForEach-Object { Write-Output $_ }
Write-Output '--- restored ---'
if ($restored.Count -eq 0) { Write-Output 'none were minimized' } else { $restored | ForEach-Object { Write-Output $_ } }
# bring the game window forward
$vis = Get-Process -Name EmuHawk | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($vis) { [void][Win]::SetForegroundWindow($vis.MainWindowHandle); Write-Output ("foreground pid=" + $vis.Id + " hwnd=" + $vis.MainWindowHandle) }
