$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class LensFileOwners {
  [StructLayout(LayoutKind.Sequential)]
  struct Owner { public int pid; public System.Runtime.InteropServices.ComTypes.FILETIME started; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Info {
    public Owner process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
    public int type; public uint status, session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint session, uint count, string[] files, uint apps, IntPtr ids, uint services, IntPtr names);
  [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint session, out uint needed, ref uint count, [In,Out] Info[] processes, out uint reason);
  [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint session);
  public static int[] Query(string[] files) {
    uint session;
    if (RmStartSession(out session, 0, new StringBuilder(33)) != 0) return new int[0];
    try {
      if (RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, IntPtr.Zero) != 0) return new int[0];
      uint needed, count=0, reason;
      if (RmGetList(session, out needed, ref count, null, out reason) != 234 || needed>1024) return new int[0];
      count=needed;
      Info[] rows=new Info[count];
      if (RmGetList(session, out needed, ref count, rows, out reason)!=0) return new int[0];
      int[] ids=new int[count]; for (int n=0;n<count;n++) ids[n]=rows[n].process.pid;
      return ids;
    } finally { RmEndSession(session); }
  }
}
'@
$options = [Console]::In.ReadToEnd() | ConvertFrom-Json
# 先查询整组锁，只拆分含活跃 AGY 进程的分组。
function Find-LensOwners([string[]] $files) {
  if (!$files.Length) { return }
  $owners = @([LensFileOwners]::Query($files) | Where-Object { $options.pids -contains $_ })
  if (!$owners.Count) { return }
  if ($files.Length -eq 1) {
    foreach ($owner in $owners) { @{ pid = $owner; file = $files[0] } }
    return
  }
  $middle = [int][Math]::Floor($files.Length / 2)
  Find-LensOwners $files[0..($middle - 1)]
  Find-LensOwners $files[$middle..($files.Length - 1)]
}
ConvertTo-Json -InputObject @(Find-LensOwners $options.files) -Compress
