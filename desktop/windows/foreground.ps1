$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class LensForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
}
'@
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::WriteLine('{"ready":true}')
while ($true) {
  try {
    $handle = [LensForeground]::GetForegroundWindow()
    [uint32]$ownerId = 0
    [void][LensForeground]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    $process = Get-Process -Id $ownerId -ErrorAction Stop
    $title = [Text.StringBuilder]::new(512)
    [void][LensForeground]::GetWindowText($handle, $title, $title.Capacity)
    @{ pid = [int]$ownerId; name = $process.ProcessName; title = $title.ToString() } | ConvertTo-Json -Compress
  } catch { @{ pid = 0; name = ''; title = '' } | ConvertTo-Json -Compress }
  Start-Sleep -Milliseconds 1000
}
