# Vystra Launcher — Copyright (c) 2026 Stefan Reibnegger (Vystra)
# FSL-1.1-ALv2 (Functional Source License) — no competing commercial product.
# Oeffnet einen fremden Launcher, sucht die Woerter/Knoepfe (Bibliothek / Library),
# klickt sie und legt danach ein Koordinatenraster ueber das Fenster. An jedem
# Rasterpunkt wird der UI-Name gelesen - so landen die Kacheln in der Liste,
# auch wenn die App keine echte Liste exportiert.
# Ausgabe: eine JSON-Zeile auf stdout.
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [int]$TimeoutSec = 28,
  [int]$RasterSpalten = 6,
  [int]$RasterZeilen = 5,
  [int]$MaxSeiten = 18
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VlWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$TRUE = [System.Windows.Automation.Condition]::TrueCondition

function Out-Result($obj) {
  $obj | ConvertTo-Json -Compress -Depth 6
  exit 0
}

$WOERTER = @(
  'Meine Bibliothek', 'My Library', 'Bibliothek', 'Library',
  'Meine Spiele', 'My Games', 'My games', 'Spiele', 'Games',
  'Sammlung', 'Collection', 'Installiert', 'Installed',
  'Besitz', 'Owned', 'Home Library'
)
$NOISE = '^(Datei|File|Bearbeiten|Edit|Ansicht|View|Hilfe|Help|Fenster|Window|Start|Home|Store|Shop|Suchen|Search|Einstellungen|Settings|Freunde|Friends|Profil|Profile|Konto|Account|Community|News|Nachrichten|Downloads|Download|Warteschlange|Queue|Filter|Sortieren|Sort|Mehr|More|Schlie.en|Close|Minimieren|Minimize|Maximieren|Maximize|Wiederherstellen|Restore|Zur.ck|Back|.ffnen|Open|Neu|New|Beenden|Exit|Quit|Anwendung|Application|Systemmen.|OK|Abbrechen|Cancel|Ja|Yes|Nein|No|Weiter|Next|Zur.ck|Previous)$'

function Bring-Front([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return }
  if ([VlWin]::IsIconic($h)) { [VlWin]::ShowWindow($h, 9) | Out-Null }
  [VlWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [VlWin]::SetForegroundWindow($h) | Out-Null
  [VlWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}

function Get-Elements($root) {
  try { return $root.FindAll($TS::Descendants, $TRUE) } catch { return @() }
}

function Activate($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return "invoke" }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return "select" }
  $r = $el.Current.BoundingRectangle
  if ($r.Width -gt 8 -and $r.Height -gt 8) {
    $old = New-Object VlWin+POINT
    [VlWin]::GetCursorPos([ref]$old) | Out-Null
    [VlWin]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
    [VlWin]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
    [VlWin]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [VlWin]::SetCursorPos($old.X, $old.Y) | Out-Null
    return "klick"
  }
  return $null
}

function Find-WindowForPid([int]$pid) {
  foreach ($w in $A::RootElement.FindAll($TS::Children, $TRUE)) {
    try {
      if ([int]$w.Current.ProcessId -eq $pid -and $w.Current.BoundingRectangle.Width -gt 200) {
        return $w
      }
    } catch {}
  }
  return $null
}

function Find-ProcessForExe([string]$exe) {
  $basis = [IO.Path]::GetFileNameWithoutExtension($exe)
  $treffer = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      if ($_.Path -and ([string]$_.Path).ToLower() -eq $exe.ToLower()) { return $true }
      if ($_.ProcessName -and $_.ProcessName -ieq $basis) { return $true }
    } catch {}
    return $false
  })
  if ($treffer.Count -gt 0) { return $treffer[0] }
  return $null
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

function Name-Sauber([string]$n) {
  if (-not $n) { return $null }
  $t = ($n -replace '\s+', ' ').Trim()
  if ($t.Length -lt 2 -or $t.Length -gt 120) { return $null }
  if ($t -match $NOISE) { return $null }
  foreach ($w in $WOERTER) { if ($t -ieq $w) { return $null } }
  return $t
}

if (-not (Test-Path -LiteralPath $ExePath)) {
  Out-Result @{ ok = $false; gefunden = $false; geklickt = $false; fehler = "exe fehlt" }
}

$exeVoll = [IO.Path]::GetFullPath($ExePath)
$proc = Find-ProcessForExe $exeVoll
$selbstGestartet = $false
if (-not $proc) {
  Start-Process -FilePath $exeVoll -WorkingDirectory ([IO.Path]::GetDirectoryName($exeVoll)) | Out-Null
  $selbstGestartet = $true
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$frame = $null
while ((Get-Date) -lt $deadline) {
  if (-not $proc) { $proc = Find-ProcessForExe $exeVoll }
  if ($proc) { $frame = Find-WindowForPid ([int]$proc.Id) }
  if ($frame) { break }
  Start-Sleep -Milliseconds 400
}
if (-not $frame) {
  Out-Result @{ ok = $false; gefunden = $false; geklickt = $false; fenster = $false; fehler = "Fenster nicht gefunden" }
}

$hwnd = [IntPtr]$frame.Current.NativeWindowHandle
Bring-Front $hwnd
Start-Sleep -Milliseconds 700

$elems = Get-Elements $frame
$navLabel = $null
$navArt = $null
$kandidaten = @()
foreach ($e in $elems) {
  try {
    $n = ($e.Current.Name -replace '\s+', ' ').Trim()
    if (-not $n) { continue }
    foreach ($w in $WOERTER) {
      if ($n -ieq $w -or $n -like "*$w*") {
        $r = $e.Current.BoundingRectangle
        $kandidaten += [pscustomobject]@{ el = $e; name = $n; w = $w; flaeche = $r.Width * $r.Height }
        break
      }
    }
  } catch {}
}
$kandidaten = @($kandidaten | Sort-Object { $WOERTER.IndexOf($_.w) }, flaeche)
foreach ($k in $kandidaten) {
  $navArt = Activate $k.el
  if ($navArt) { $navLabel = $k.name; break }
}

Start-Sleep -Milliseconds 900
$frame = Find-WindowForPid ([int]$proc.Id)
if (-not $frame) { $frame = Find-WindowForPid ([int]$proc.Id) }
if ($frame) { $hwnd = [IntPtr]$frame.Current.NativeWindowHandle; Bring-Front $hwnd }

$rect = New-Object VlWin+RECT
[VlWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$winW = [Math]::Max(1, $rect.Right - $rect.Left)
$winH = [Math]::Max(1, $rect.Bottom - $rect.Top)
# Inhalt, nicht Titelleiste/Seitenleiste: Raster liegt auf dem Spielfeld.
$randL = [int]($winW * 0.16)
$randR = [int]($winW * 0.04)
$randO = [int]($winH * 0.18)
$randU = [int]($winH * 0.08)
$feldL = $rect.Left + $randL
$feldO = $rect.Top + $randO
$feldW = [Math]::Max(80, $winW - $randL - $randR)
$feldH = [Math]::Max(80, $winH - $randO - $randU)

$set = New-Object 'System.Collections.Generic.HashSet[string]'
$rasterRoh = New-Object System.Collections.ArrayList
$scroller = Find-Scroller $frame
$stabil = 0

for ($seite = 0; $seite -lt $MaxSeiten; $seite++) {
  $vorher = $set.Count
  for ($z = 0; $z -lt $RasterZeilen; $z++) {
    for ($s = 0; $s -lt $RasterSpalten; $s++) {
      $x = [int]($feldL + ($feldW * ($s + 0.5) / $RasterSpalten))
      $y = [int]($feldO + ($feldH * ($z + 0.5) / $RasterZeilen))
      try {
        $pt = New-Object System.Windows.Point $x, $y
        $hit = $A::FromPoint($pt)
        if (-not $hit) { continue }
        $nm = Name-Sauber $hit.Current.Name
        if (-not $nm) {
          try { $nm = Name-Sauber $hit.Current.HelpText } catch {}
        }
        if (-not $nm) {
          $p = $hit
          for ($i = 0; $i -lt 3 -and $p; $i++) {
            try { $p = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($p) } catch { $p = $null }
            if ($p) { $nm = Name-Sauber $p.Current.Name; if ($nm) { break } }
          }
        }
        if ($nm) {
          [void]$set.Add($nm)
          if ($rasterRoh.Count -lt 80) {
            [void]$rasterRoh.Add("$s,$z|$nm")
          }
        }
      } catch {}
    }
  }
  if (-not $scroller) { break }
  try {
    $pct = $scroller.Current.VerticalScrollPercent
    if ($pct -ge 99.5 -or $pct -lt 0) { break }
    if ($set.Count -eq $vorher) { $stabil++ } else { $stabil = 0 }
    if ($stabil -ge 2) { break }
    $scroller.ScrollVertical([System.Windows.Automation.ScrollAmount]::LargeIncrement)
  } catch { break }
  Start-Sleep -Milliseconds 450
}

Out-Result @{
  ok = $true
  gefunden = [bool]$navLabel
  geklickt = [bool]$navArt
  label = $navLabel
  navArt = $navArt
  fenster = $true
  selbstGestartet = $selbstGestartet
  raster = @{ spalten = $RasterSpalten; zeilen = $RasterZeilen }
  titel = @($set)
  rasterRoh = @($rasterRoh)
}
