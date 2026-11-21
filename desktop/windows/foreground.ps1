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
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
function Get-AgyRouteId([string] $address) {
  $uri = $null
  if ($address.Length -gt 8192 -or ![Uri]::TryCreate($address, [UriKind]::Absolute, [ref]$uri)) { return }
  if ($uri.Scheme -notin @('http', 'https') -or $uri.Host -notin @('127.0.0.1', 'localhost', '[::1]') -or $uri.UserInfo) { return }
  if ($uri.AbsolutePath -match '^/c/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/?$') { return $Matches[1].ToLowerInvariant() }
}
function Get-AgyDocumentId([IntPtr] $window) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($window)
  $items = [System.Collections.Queue]::new()
  $items.Enqueue($root)
  $ids = [System.Collections.Generic.HashSet[string]]::new()
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $visits = 0
  while ($items.Count) {
    if (++$visits -gt 200 -or $clock.ElapsedMilliseconds -gt 350) { return }
    $item = $items.Dequeue()
    $type = $item.Current.ControlType.ProgrammaticName
    if ($type -eq 'ControlType.Document') {
      $pattern = $null
      if ($item.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $id = Get-AgyRouteId $pattern.Current.Value
        if ($id) { [void]$ids.Add($id) }
      }
      if ($ids.Count -gt 1) { return }
      continue
    }
    if ($type -in @('ControlType.Edit','ControlType.Text','ControlType.Button','ControlType.ListItem')) { continue }
    $child = $walker.GetFirstChild($item)
    while ($null -ne $child) {
      if ($items.Count -gt 200 -or $clock.ElapsedMilliseconds -gt 350) { return }
      $items.Enqueue($child)
      $child = $walker.GetNextSibling($child)
    }
  }
  if ($ids.Count -eq 1 -and [LensForeground]::GetForegroundWindow() -eq $window) { return @($ids)[0] }
}
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
    $frame = @{ pid = [int]$ownerId; name = $process.ProcessName; title = $title.ToString() }
    if ($process.ProcessName -eq 'Antigravity') {
      try { $frame.visibleId = Get-AgyDocumentId $handle } catch { $frame.visibleId = $null }
    }
    $frame | ConvertTo-Json -Compress
  } catch { @{ pid = 0; name = ''; title = '' } | ConvertTo-Json -Compress }
  Start-Sleep -Milliseconds 1000
}
