param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$TitleMatch = "",
  [string]$Path = "",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [int]$Delta = -720
)

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class VystraWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, int d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@ | Out-Null

function Find-Target {
  $want = $TitleMatch
  $hits = New-Object System.Collections.Generic.List[object]
  $cb = [VystraWin+EnumProc]{
    param($h, $l)
    if (-not [VystraWin]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 512
    [void][VystraWin]::GetWindowText($h, $sb, $sb.Capacity)
    $t = $sb.ToString()
    if (-not $t) { return $true }
    if ($t -notmatch $want) { return $true }
    $r = New-Object VystraWin+RECT
    [void][VystraWin]::GetWindowRect($h, [ref]$r)
    $ww = $r.R - $r.L; $hh = $r.B - $r.T
    if ($ww -lt 200 -or $hh -lt 200) { return $true }
    $hits.Add([pscustomobject]@{
      hwnd = [int64]$h
      title = $t
      x = $r.L; y = $r.T; w = $ww; h = $hh
    })
    return $true
  }
  [void][VystraWin]::EnumWindows($cb, [IntPtr]::Zero)
  $hits | Sort-Object { $_.w * $_.h } -Descending | Select-Object -First 1
}

if ($Action -eq "find") {
  $hit = Find-Target
  if (-not $hit) { Write-Output '{"ok":false}'; exit 0 }
  $hit | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq "focus") {
  $hit = Find-Target
  if (-not $hit) { Write-Output '{"ok":false}'; exit 0 }
  $ptr = [IntPtr]$hit.hwnd
  [void][VystraWin]::ShowWindow($ptr, 9)
  [void][VystraWin]::SetForegroundWindow($ptr)
  Start-Sleep -Milliseconds 250
  $hit | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq "shot") {
  Add-Type -AssemblyName System.Drawing | Out-Null
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size $W, $H))
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output '{"ok":true}'
  exit 0
}

if ($Action -eq "click") {
  [void][VystraWin]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 80
  [VystraWin]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [VystraWin]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Write-Output '{"ok":true}'
  exit 0
}

if ($Action -eq "scroll") {
  [void][VystraWin]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 60
  [VystraWin]::mouse_event(0x0800, 0, 0, $Delta, [UIntPtr]::Zero)
  Write-Output '{"ok":true}'
  exit 0
}

if ($Action -eq "ocr") {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
  })[0]
  function Await($op, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }
  [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $eng) { Write-Output '{"ok":false,"error":"ocr-engine"}'; exit 0 }
  $res = Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $words = @()
  foreach ($line in $res.Lines) {
    foreach ($w in $line.Words) {
      $b = $w.BoundingRect
      $words += [pscustomobject]@{
        text = [string]$w.Text
        x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height
      }
    }
  }
  $out = [pscustomobject]@{ ok = $true; text = [string]$res.Text; words = $words }
  $out | ConvertTo-Json -Compress -Depth 5
  exit 0
}

Write-Output '{"ok":false,"error":"unknown-action"}'
exit 1
