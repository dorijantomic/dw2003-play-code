# Windows memory logger for tools/arena_to_gallery.py (copied next to the work dir and started by it).
# Every 5 s: physical used, commit charge / limit, FIBO python working set + private bytes, WSL vmmem, C: free.
# If C: free < 8 GB it writes <Stop>.lowC (the tool then aborts the run).
param([string]$Log,[string]$Stop)
while (-not (Test-Path $Stop)) {
  $os = Get-CimInstance Win32_OperatingSystem
  $used = ($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)/1MB
  $c = (Get-Counter '\Memory\Committed Bytes','\Memory\Commit Limit').CounterSamples
  $ids = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ? { $_.CommandLine -like '*fibo*' } | % { $_.ProcessId })
  $f = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
  $ws = ($f | measure WorkingSet64 -Sum).Sum/1GB; $pm = ($f | measure PrivateMemorySize64 -Sum).Sum/1GB
  $vm = (Get-Process vmmem* -ErrorAction SilentlyContinue | measure PrivateMemorySize64 -Sum).Sum/1GB
  $cf = (Get-PSDrive C).Free/1GB
  "{0} phys_used={1:N1}GB commit={2:N1}/{3:N1}GB fibo_ws={4:N1}GB fibo_private={5:N1}GB vmmem_priv={6:N1}GB C_free={7:N1}GB" -f (Get-Date -f HH:mm:ss),$used,($c[0].CookedValue/1GB),($c[1].CookedValue/1GB),$ws,$pm,$vm,$cf | Add-Content $Log
  if ($cf -lt 8) { "C FREE BELOW 8 GB - STOP" | Add-Content $Log; "lowC" | Set-Content ($Stop + '.lowC') }
  Start-Sleep 5
}
