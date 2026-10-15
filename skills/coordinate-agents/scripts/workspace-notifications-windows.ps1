# Trusted code only. Untrusted title/body arrive as UTF-8 JSON on stdin.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  if ([Environment]::OSVersion.Version.Major -lt 10 -or -not [Environment]::UserInteractive) {
    [Console]::Write('CA_UNAVAILABLE'); exit 0
  }
  $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
  # Per-user, idempotent Start Menu registration; no registry, admin or service.
  # Microsoft requires System.AppUserModel.ID on a desktop app's shortcut.
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public static class CoordinateToastIdentity {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n, IntPtr data, uint flags);
    void GetIDList(out IntPtr list); void SetIDList(IntPtr list);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string s);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string s);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string s);
    void GetHotkey(out short key); void SetHotkey(short key);
    void GetShowCmd(out int cmd); void SetShowCmd(int cmd);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int n, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string s, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string s, uint reserved);
    void Resolve(IntPtr hwnd, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string s);
  }
  [StructLayout(LayoutKind.Sequential)] struct PropertyKey {
    public Guid format; public uint id;
    public PropertyKey(string format, uint id) { this.format = new Guid(format); this.id = id; }
  }
  [StructLayout(LayoutKind.Sequential)] struct PropVariant {
    public ushort type, reserved1, reserved2, reserved3;
    public IntPtr value, padding;
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  interface IPropertyStore {
    void GetCount(out uint count); void GetAt(uint index, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
    void SetValue(ref PropertyKey key, ref PropVariant value); void Commit();
  }
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  static readonly PropertyKey AppId = new PropertyKey("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 5);
  public static void Ensure(string path, string executable, string appId) {
    object instance = new ShellLink();
    try {
      var link = (IShellLinkW)instance;
      var file = (IPersistFile)instance;
      var store = (IPropertyStore)instance;
      var key = AppId;
      if (System.IO.File.Exists(path)) {
        file.Load(path, 0);
        PropVariant existing; store.GetValue(ref key, out existing);
        try {
          if (existing.type == 31 && Marshal.PtrToStringUni(existing.value) == appId) return;
          throw new InvalidOperationException("Shortcut identity conflict");
        } finally { PropVariantClear(ref existing); }
      }
      link.SetPath(executable);
      link.SetArguments("-NoProfile -NonInteractive -WindowStyle Hidden -Command exit");
      link.SetDescription("Coordinate Agents desktop notifications");
      link.SetShowCmd(7);
      var value = new PropVariant { type = 31, value = Marshal.StringToCoTaskMemUni(appId) };
      try { store.SetValue(ref key, ref value); store.Commit(); }
      finally { PropVariantClear(ref value); }
      file.Save(path, true);
    } finally { Marshal.FinalReleaseComObject(instance); }
  }
}
'@
  $programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs)
  if (-not $programs -or -not (Test-Path -LiteralPath $programs -PathType Container)) { throw 'No StartMenu' }
  $shortcut = [IO.Path]::Combine($programs, 'Coordinate Agents Notifications.lnk')
  # Do not follow reparse points at the identity destination.
  if ((Test-Path -LiteralPath $shortcut) -and ((Get-Item -LiteralPath $shortcut -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe shortcut' }
  $appId = 'CoordinateAgents.Workspace'
  # Serializes identity creation across CLI processes. Held only during registration.
  $mutex = New-Object Threading.Mutex($false, 'Local\CoordinateAgents.ToastIdentity.v1')
  $owned = $false
  try {
    try { $owned = $mutex.WaitOne(2000) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { throw 'Identity busy' }
    [CoordinateToastIdentity]::Ensure($shortcut, [IO.Path]::Combine($PSHOME, 'powershell.exe'), $appId)
  } finally { if ($owned) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
  if ([int]$notifier.Setting -ne 0) { [Console]::Write('CA_DISABLED'); exit 0 }
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>')
  $nodes = $xml.GetElementsByTagName('text')
  $nodes.Item(0).AppendChild($xml.CreateTextNode([string]$payload.title)) | Out-Null
  $nodes.Item(1).AppendChild($xml.CreateTextNode([string]$payload.body)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $toast.ExpirationTime = [DateTimeOffset]::Now.AddMinutes(5)
  $notifier.Show($toast)
  [Console]::Write('CA_ACCEPTED')
} catch {
  # Never emit OS error text: it can contain user paths or notification contents.
  [Console]::Write('CA_UNAVAILABLE')
  exit 0
}
