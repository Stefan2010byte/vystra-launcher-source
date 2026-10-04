# Vystra Launcher — Copyright (c) 2026 Stefan Reibnegger (Vystra)
# Polyform Noncommercial 1.0.0 — commercial use forbidden.
# Liest die Bibliothek der Xbox-App aus.
#   -Mode uia   : Spielnamen per UI Automation sammeln (scrollt die Liste durch)
#   -Mode shots : statt Text Screenshots je Scroll-Seite nach -OutDir schreiben (fuer die Vision-KI)
# Ausgabe: genau eine JSON-Zeile auf stdout.
param(
  [ValidateSet("uia", "shots")][string]$Mode = "uia",
  [string]$OutDir = "",
  [int]$MaxPages = 25,
  [int]$TimeoutSec = 40
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VxWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@

$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$TRUE = [System.Windows.Automation.Condition]::TrueCondition

function Out-Result($obj) {
  $obj | ConvertTo-Json -Compress -Depth 5
  exit 0
}

function Find-XboxFrame {
  foreach ($w in $A::RootElement.FindAll($TS::Children, $TRUE)) {
    try { if ($w.Current.Name -match '^xbox$') { return $w } } catch {}
  }
  return $null
}

function Bring-Front([IntPtr]$h) {
  if ([VxWin]::IsIconic($h)) { [VxWin]::ShowWindow($h, 9) | Out-Null }
  # ALT kurz druecken hebt die Vordergrund-Sperre von Windows auf.
  [VxWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [VxWin]::SetForegroundWindow($h) | Out-Null
  [VxWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}

function Get-Elements($root) {
  try { return $root.FindAll($TS::Descendants, $TRUE) } catch { return @() }
}

$NAV = '^(Meine Bibliothek|Bibliothek|My Library|Library|Meine Spiele|My games)$'
$NOISE = '^(Xbox|XBOX|Startseite|Home|Game Pass|Store|Shop|Suchen|Search|Filter|Sortieren|Sort|Mehr|More|Installieren|Install|Spielen|Play|Verwalten|Manage|Einstellungen|Settings|Benachrichtigungen|Notifications|Freunde|Friends|Profil|Profile|Zur.ck|Back|Schlie.en|Close|Minimieren|Minimize|Maximieren|Maximize|Wiederherstellen|Restore|Bibliothek|Meine Bibliothek|My Library|Library|Installiert|Installed|Alle|All|Cloud Gaming|Community|Erfolge|Achievements|Herunterladen|Download|Downloads|Warteschlange|Queue|Systemmen.|System|Anwendung|Application|Konto|Account|.ffnen|Open|Weiter|Next|Vorherige|Previous|Seite \d+|Page \d+|[0-9 .,:%/+-]*)$'
$TILE_TYPES = @($CT::ListItem, $CT::Button, $CT::Hyperlink, $CT::DataItem, $CT::Group, $CT::Image)

function Collect-Titles($root, $set, $raw) {
  foreach ($e in (Get-Elements $root)) {
    try {
      $c = $e.Current
      $n = ($c.Name -replace '\s+', ' ').Trim()
      if (-not $n -or $n.Length -lt 2 -or $n.Length -gt 120) { continue }
      if ($TILE_TYPES -notcontains $c.ControlType) { continue }
      if ($raw.Count -lt 600) { [void]$raw.Add(($c.ControlType.ProgrammaticName -replace 'ControlType\.', '') + '|' + $n) }
      if ($n -match $NOISE) { continue }
      [void]$set.Add($n)
    } catch {}
  }
}

function Find-Scroller($root) {
  $best = $null; $bestArea = 0
  foreach ($e in (Get-Elements $root)) {
    try {
      $sp = $null
      if ($e.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$sp)) {
        if ($sp.Current.VerticallyScrollable) {
          $r = $e.Current.BoundingRectangle
          $area = $r.Width * $r.Height
          if ($area -gt $bestArea) { $best = $sp; $bestArea = $area }
        }
      }
    } catch {}
  }
  return $best
}

function Activate($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return "invoke" }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return "select" }
  $r = $el.Current.BoundingRectangle
  if ($r.Width -gt 0) {
    $old = New-Object VxWin+POINT
    [VxWin]::GetCursorPos([ref]$old) | Out-Null
    [VxWin]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
    [VxWin]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
    [VxWin]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    [VxWin]::SetCursorPos($old.X, $old.Y) | Out-Null
    return "klick"
  }
  return $null
}

function Save-Shot($root, $file) {
  $r = $root.Current.BoundingRectangle
  if ($r.Width -lt 50 -or $r.Height -lt 50) { return $false }
  $bmp = New-Object System.Drawing.Bitmap([int]$r.Width, [int]$r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
  $g.Dispose()
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return $true
}

$prevFg = [VxWin]::GetForegroundWindow()
$warAktiv = [bool](Get-Process XboxPcApp -ErrorAction SilentlyContinue)
$frame = Find-XboxFrame
$warMinimiert = $false
if ($frame) { $warMinimiert = [VxWin]::IsIconic([IntPtr]$frame.Current.NativeWindowHandle) }

try {
  if (-not $frame) {
    Start-Process "shell:AppsFolder\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App"
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $elems = @()
  while ((Get-Date) -lt $deadline) {
    if (-not $frame) { $frame = Find-XboxFrame }
    if ($frame) {
      Bring-Front ([IntPtr]$frame.Current.NativeWindowHandle)
      Start-Sleep -Milliseconds 800
      $elems = Get-Elements $frame
      if ($elems.Count -gt 10) { break }
    }
    Start-Sleep -Milliseconds 700
  }
  if (-not $frame) { Out-Result @{ ok = $false; fehler = "Xbox-App nicht gefunden"; fenster = $false } }
  if ($elems.Count -le 10) { Out-Result @{ ok = $false; fehler = "Xbox-App zeigt keine Bedienelemente"; fenster = $true } }

  $navLabel = $null; $navArt = $null
  foreach ($e in $elems) {
    try {
      $n = ($e.Current.Name -replace '\s+', ' ').Trim()
      if ($n -match $NAV) { $navArt = Activate $e; if ($navArt) { $navLabel = $n; break } }
    } catch {}
  }
  Start-Sleep -Milliseconds 2500

  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  $raw = New-Object System.Collections.ArrayList
  $shots = New-Object System.Collections.ArrayList
  if ($Mode -eq "shots") {
    if (-not $OutDir) { $OutDir = Join-Path $env:TEMP "vystra-xbox-shots" }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  }

  $scroller = Find-Scroller $frame
  $stabil = 0
  for ($page = 0; $page -lt $MaxPages; $page++) {
    $vorher = $set.Count
    Collect-Titles $frame $set $raw
    if ($Mode -eq "shots") {
      $f = Join-Path $OutDir ("seite-{0:D2}.png" -f $page)
      if (Save-Shot $frame $f) { [void]$shots.Add($f) }
    }
    if (-not $scroller) { break }
    $pct = $scroller.Current.VerticalScrollPercent
    if ($pct -ge 99.5 -or $pct -lt 0) { break }
    if ($Mode -eq "uia" -and $set.Count -eq $vorher) { $stabil++ } else { $stabil = 0 }
    if ($stabil -ge 2) { break }
    try { $scroller.ScrollVertical([System.Windows.Automation.ScrollAmount]::LargeIncrement) } catch { break }
    Start-Sleep -Milliseconds 900
  }

  Out-Result @{
    ok = $true
    fenster = $true
    navigiert = [bool]$navLabel
    navLabel = $navLabel
    navArt = $navArt
    scrollbar = [bool]$scroller
    titel = @($set)
    roh = @($raw)
    shots = @($shots)
  }
} catch {
  Out-Result @{ ok = $false; fehler = $_.Exception.Message }
} finally {
  try {
    if ($frame) {
      $h = [IntPtr]$frame.Current.NativeWindowHandle
      if (-not $warAktiv -or $warMinimiert) { [VxWin]::ShowWindow($h, 6) | Out-Null }
    }
    if ($prevFg -ne [IntPtr]::Zero) { [VxWin]::SetForegroundWindow($prevFg) | Out-Null }
  } catch {}
}
