param(
  [string]$Action = 'Query',
  [int]$Relative = 0
)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class CcdDpi {
  [StructLayout(LayoutKind.Sequential)]
  public struct LUID { public uint LowPart; public int HighPart; }
  [StructLayout(LayoutKind.Sequential)]
  public struct RATIONAL { public uint Numerator; public uint Denominator; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PATH_SOURCE_INFO { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PATH_TARGET_INFO {
    public LUID adapterId; public uint id; public uint modeInfoIdx;
    public uint outputTechnology; public uint rotation; public uint scaling;
    public RATIONAL refreshRate; public uint scanLineOrdering;
    [MarshalAs(UnmanagedType.Bool)] public bool targetAvailable; public uint statusFlags;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PATH_INFO { public PATH_SOURCE_INFO sourceInfo; public PATH_TARGET_INFO targetInfo; public uint flags; }
  [StructLayout(LayoutKind.Sequential)]
  public struct DEVICE_INFO_HEADER { public uint type; public uint size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential)]
  public struct DPI_SCALE_INFO { public DEVICE_INFO_HEADER header; public int minRelativeScale; public int curRelativeScale; public int maxRelativeScale; }
  [StructLayout(LayoutKind.Sequential)]
  public struct DPI_SET_INFO { public DEVICE_INFO_HEADER header; public int scaleRelative; }

  const uint QDC_ONLY_ACTIVE_PATHS = 0x00000002;
  // Windows SDK: custom (undocumented) DISPLAYCONFIG_DEVICE_INFO_TYPE values.
  const uint GET_DPI_SCALE = 0xFFFFFFFD; // -3
  const uint SET_DPI_SCALE = 0xFFFFFFFC; // -4
  const int MODE_INFO_SIZE = 64;

  [DllImport("user32.dll")]
  public static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPathArrayElements, out uint numModeInfoArrayElements);
  [DllImport("user32.dll")]
  public static extern int QueryDisplayConfig(uint flags, ref uint numPathArrayElements, [Out] PATH_INFO[] pathInfoArray, ref uint numModeInfoArrayElements, IntPtr modeInfoArray, IntPtr currentTopologyId);
  [DllImport("user32.dll")]
  public static extern int DisplayConfigGetDeviceInfo(ref DPI_SCALE_INFO requestPacket);
  [DllImport("user32.dll")]
  public static extern int DisplayConfigSetDeviceInfo(ref DPI_SET_INFO packet);

  static bool QueryPaths(out PATH_INFO[] paths, out uint pathCount, out IntPtr modesOut) {
    paths = null; modesOut = IntPtr.Zero;
    uint pathCountLocal, modeCount;
    int err = GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out pathCountLocal, out modeCount);
    if (err != 0) { pathCount = 0; return false; }
    paths = new PATH_INFO[pathCountLocal];
    IntPtr modes = Marshal.AllocHGlobal((int)(modeCount * MODE_INFO_SIZE));
    err = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref pathCountLocal, paths, ref modeCount, modes, IntPtr.Zero);
    if (err != 0) { Marshal.FreeHGlobal(modes); pathCount = 0; return false; }
    pathCount = pathCountLocal;
    modesOut = modes;
    return true;
  }

  public static string Query() {
    PATH_INFO[] paths; uint pathCount; IntPtr modes;
    if (!QueryPaths(out paths, out pathCount, out modes)) return "ERROR";
    try {
      StringBuilder sb = new StringBuilder();
      sb.Append("Q");
      for (uint i = 0; i < pathCount; i++) {
        DPI_SCALE_INFO info = new DPI_SCALE_INFO();
        info.header.type = GET_DPI_SCALE;
        info.header.size = (uint)Marshal.SizeOf(typeof(DPI_SCALE_INFO));
        // DPI scaling is a property of the SOURCE, not the target.
        info.header.adapterId = paths[i].sourceInfo.adapterId;
        info.header.id = paths[i].sourceInfo.id;
        int getErr = DisplayConfigGetDeviceInfo(ref info);
        sb.Append("|" + paths[i].sourceInfo.id + ";" + paths[i].sourceInfo.statusFlags + ";" + getErr + ";" + info.minRelativeScale + ";" + info.curRelativeScale + ";" + info.maxRelativeScale);
      }
      return sb.ToString();
    } finally { Marshal.FreeHGlobal(modes); }
  }

  public static string Set(int relative) {
    PATH_INFO[] paths; uint pathCount; IntPtr modes;
    if (!QueryPaths(out paths, out pathCount, out modes)) return "ERROR";
    try {
      StringBuilder sb = new StringBuilder();
      sb.Append("S");
      for (uint i = 0; i < pathCount; i++) {
        DPI_SET_INFO packet = new DPI_SET_INFO();
        packet.header.type = SET_DPI_SCALE;
        packet.header.size = (uint)Marshal.SizeOf(typeof(DPI_SET_INFO));
        packet.header.adapterId = paths[i].sourceInfo.adapterId;
        packet.header.id = paths[i].sourceInfo.id;
        packet.scaleRelative = relative;
        int setErr = DisplayConfigSetDeviceInfo(ref packet);
        DPI_SCALE_INFO after = new DPI_SCALE_INFO();
        after.header.type = GET_DPI_SCALE;
        after.header.size = (uint)Marshal.SizeOf(typeof(DPI_SCALE_INFO));
        after.header.adapterId = paths[i].sourceInfo.adapterId;
        after.header.id = paths[i].sourceInfo.id;
        int getErr = DisplayConfigGetDeviceInfo(ref after);
        sb.Append("|" + paths[i].sourceInfo.id + ";" + relative + ";" + setErr + ";" + getErr + ";" + after.curRelativeScale + ";" + after.minRelativeScale + ";" + after.maxRelativeScale);
      }
      return sb.ToString();
    } finally { Marshal.FreeHGlobal(modes); }
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp | Out-Null
if ($Action -eq 'Set') {
  $raw = [CcdDpi]::Set($Relative)
} else {
  $raw = [CcdDpi]::Query()
}
if ($raw -eq 'ERROR') {
  Write-Output (ConvertTo-Json @{ ok = $false; error = 'query-display-config-failed' } -Compress)
  exit 2
}
$parts = $raw.Split('|')
$targets = @()
for ($i = 1; $i -lt $parts.Length; $i++) {
  $fields = $parts[$i].Split(';')
  if ($Action -eq 'Set') {
    $targets += [pscustomobject]@{
      targetId = [int64]$fields[0]; requestedRelative = [int]$fields[1]; setErr = [int]$fields[2];
      getErr = [int]$fields[3]; curRelative = [int]$fields[4]; minRelative = [int]$fields[5]; maxRelative = [int]$fields[6]
    }
  } else {
    $targets += [pscustomobject]@{
      targetId = [int64]$fields[0]; statusFlags = [int]$fields[1]; getErr = [int]$fields[2];
      minRelative = [int]$fields[3]; curRelative = [int]$fields[4]; maxRelative = [int]$fields[5]
    }
  }
}
Write-Output (ConvertTo-Json @{ ok = $true; action = $Action; targets = $targets } -Compress -Depth 4)
