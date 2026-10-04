# Vystra Launcher — Copyright (c) 2026 Stefan Reibnegger (Vystra)
# Polyform Noncommercial 1.0.0 — commercial use forbidden.
# Freundensync: Launcher oeffnen, Woerter/Knoepfe suchen (Profil, ID, Freunde),
# klicken, dann ein Koordinatenraster drueberlegen und Name / User-ID / Freunde lesen.
# Ausgabe: eine JSON-Zeile.
param(
  [string]$ExePath = "",
  [string]$ProcessName = "",
  [int]$TimeoutSec = 28,
  [int]$RasterSpalten = 5,
  [int]$RasterZeilen = 8
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FrWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TRUE = [System.Windows.Automation.Condition]::TrueCondition

function Out-Result($obj) {
  $obj | ConvertTo-Json -Compress -Depth 6
  exit 0
}

$PROFIL = @('Mein Profil', 'My Profile', 'Profil', 'Profile', 'Konto', 'Account', 'Benutzer', 'Username', 'Anzeigename', 'Display name')
$FREUNDE = @('Freundesliste', 'Friends list', 'Friend list', 'Meine Freunde', 'My Friends', 'Freunde', 'Friends')
$NAV = @($PROFIL + $FREUNDE)
$NOISE = '^(Datei|File|Bearbeiten|Edit|Ansicht|View|Hilfe|Help|Fenster|Window|Start|Home|Store|Shop|Suchen|Search|Einstellungen|Settings|Bibliothek|Library|Spiele|Games|Community|News|Downloads|Download|Filter|Mehr|More|Schlie.en|Close|Minimieren|Minimize|Maximieren|Maximize|Zur.ck|Back|.ffnen|Open|Neu|New|Beenden|Exit|OK|Abbrechen|Cancel|Ja|Yes|Nein|No|Weiter|Next|Anwendung|Application|Online|Offline|Zuletzt gesehen|Last seen|Status|Chat|Nachricht|Message)$'

function Bring-Front([IntPtr]$h) {
  if ($h -eq [IntPtr]::Zero) { return }
  if ([FrWin]::IsIconic($h)) { [FrWin]::ShowWindow($h, 9) | Out-Null }
  [FrWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [FrWin]::SetForegroundWindow($h) | Out-Null
  [FrWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}
function Get-Elements($root) { try { return $root.FindAll($TS::Descendants, $TRUE) } catch { return @() } }
function Activate($el) {
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return "invoke" }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return "select" }
  $r = $el.Current.BoundingRectangle
  if ($r.Width -gt 8 -and $r.Height -gt 8) {
    $old = New-Object FrWin+POINT
    [FrWin]::GetCursorPos([ref]$old) | Out-Null
    [FrWin]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
    [FrWin]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
    [FrWin]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [FrWin]::SetCursorPos($old.X, $old.Y) | Out-Null
    return "klick"
  }
  return $null
}
function Find-WindowForPid([int]$pid) {
  foreach ($w in $A::RootElement.FindAll($TS::Children, $TRUE)) {
    try { if ([int]$w.Current.ProcessId -eq $pid -and $w.Current.BoundingRectangle.Width -gt 200) { return $w } } catch {}
  }
  return $null
}
function Find-Proc {
  if ($ExePath -and (Test-Path -LiteralPath $ExePath)) {
    $voll = [IO.Path]::GetFullPath($ExePath)
    $basis = [IO.Path]::GetFileNameWithoutExtension($voll)
    $t = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
      try {
        if ($_.Path -and ([string]$_.Path).ToLower() -eq $voll.ToLower()) { return $true }
        if ($_.ProcessName -ieq $basis) { return $true }
      } catch {}
      $false
    })
    if ($t.Count) { return $t[0] }
  }
  if ($ProcessName) {
    $t = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
    if ($t.Count) { return $t[0] }
  }
  return $null
}
function Klick-Woerter($frame, $woerter) {
  $elems = Get-Elements $frame
  $kand = @()
  foreach ($e in $elems) {
    try {
      $n = ($e.Current.Name -replace '\s+', ' ').Trim()
      if (-not $n) { continue }
      foreach ($w in $woerter) {
        if ($n -ieq $w -or $n -like "*$w*") {
          $r = $e.Current.BoundingRectangle
          $kand += [pscustomobject]@{ el = $e; name = $n; w = $w; flaeche = $r.Width * $r.Height }
          break
        }
      }
    } catch {}
  }
  foreach ($k in @($kand | Sort-Object { $woerter.IndexOf($_.w) }, flaeche)) {
    $art = Activate $k.el
    if ($art) { return @{ label = $k.name; art = $art } }
  }
  return $null
}
function Name-Sauber([string]$n) {
  if (-not $n) { return $null }
  $t = ($n -replace '\s+', ' ').Trim()
  if ($t.Length -lt 2 -or $t.Length -gt 80) { return $null }
  if ($t -match $NOISE) { return $null }
  foreach ($w in $NAV) { if ($t -ieq $w) { return $null } }
  return $t
}
function Ist-Id([string]$t) {
  if ($t -match '^7656119\d{10}$') { return $true }
  if ($t -match '^[0-9]{8,20}$') { return $true }
  if ($t -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { return $true }
  if ($t -match '^(ID|User ID|Steam ID|Account ID|Spieler-ID|XUID)\s*[:#]?\s*(\S+)$') { return $true }
  return $false
}
function Id-Wert([string]$t) {
  if ($t -match '^(ID|User ID|Steam ID|Account ID|Spieler-ID|XUID)\s*[:#]?\s*(\S+)$') { return $Matches[2] }
  return $t
}
function Raster-Lesen($frame, $hwnd) {
  $rect = New-Object FrWin+RECT
  [FrWin]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  $winW = [Math]::Max(1, $rect.Right - $rect.Left)
  $winH = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $feldL = $rect.Left + [int]($winW * 0.14)
  $feldO = $rect.Top + [int]($winH * 0.16)
  $feldW = [Math]::Max(80, $winW - [int]($winW * 0.18))
  $feldH = [Math]::Max(80, $winH - [int]($winH * 0.24))
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  for ($z = 0; $z -lt $RasterZeilen; $z++) {
    for ($s = 0; $s -lt $RasterSpalten; $s++) {
      $x = [int]($feldL + ($feldW * ($s + 0.5) / $RasterSpalten))
      $y = [int]($feldO + ($feldH * ($z + 0.5) / $RasterZeilen))
      try {
        $hit = $A::FromPoint((New-Object System.Windows.Point $x, $y))
        if (-not $hit) { continue }
        $nm = Name-Sauber $hit.Current.Name
        if (-not $nm) {
          $p = $hit
          for ($i = 0; $i -lt 3 -and $p; $i++) {
            try { $p = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($p) } catch { $p = $null }
            if ($p) { $nm = Name-Sauber $p.Current.Name; if ($nm) { break } }
          }
        }
        if ($nm) { [void]$set.Add($nm) }
      } catch {}
    }
  }
  return @($set)
}

$selbst = $false
$proc = Find-Proc
if (-not $proc) {
  if ($ExePath -and (Test-Path -LiteralPath $ExePath)) {
    Start-Process -FilePath ([IO.Path]::GetFullPath($ExePath)) -WorkingDirectory ([IO.Path]::GetDirectoryName($ExePath)) | Out-Null
    $selbst = $true
  } elseif ($ProcessName -ieq 'XboxPcApp') {
    Start-Process "shell:AppsFolder\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App" | Out-Null
    $selbst = $true
  } else {
    Out-Result @{ ok = $false; fehler = "Launcher nicht gefunden" }
  }
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$frame = $null
while ((Get-Date) -lt $deadline) {
  if (-not $proc) { $proc = Find-Proc }
  if ($proc) { $frame = Find-WindowForPid ([int]$proc.Id) }
  if ($frame) { break }
  Start-Sleep -Milliseconds 400
}
if (-not $frame) { Out-Result @{ ok = $false; fenster = $false; fehler = "Fenster nicht gefunden" } }

$hwnd = [IntPtr]$frame.Current.NativeWindowHandle
Bring-Front $hwnd
Start-Sleep -Milliseconds 600

$profilKlick = Klick-Woerter $frame $PROFIL
Start-Sleep -Milliseconds 700
$frame = Find-WindowForPid ([int]$proc.Id)
if ($frame) { $hwnd = [IntPtr]$frame.Current.NativeWindowHandle; Bring-Front $hwnd }
$profilNamen = @(Raster-Lesen $frame $hwnd)

$username = $null
$userId = $null
foreach ($n in $profilNamen) {
  if (-not $userId -and (Ist-Id $n)) { $userId = Id-Wert $n }
}
foreach ($n in $profilNamen) {
  if ($username) { break }
  if (Ist-Id $n) { continue }
  if ($n -match '^[A-Za-z0-9._\-]{3,32}$' -or $n.Length -ge 3) { $username = $n }
}

$freundeKlick = Klick-Woerter $frame $FREUNDE
Start-Sleep -Milliseconds 800
$frame = Find-WindowForPid ([int]$proc.Id)
if ($frame) { $hwnd = [IntPtr]$frame.Current.NativeWindowHandle; Bring-Front $hwnd }
$freundeNamen = @(Raster-Lesen $frame $hwnd) | Where-Object { $_ -and $_ -ne $username -and -not (Ist-Id $_) }

Out-Result @{
  ok = $true
  fenster = $true
  selbstGestartet = $selbst
  profil = @{ gefunden = [bool]$profilKlick; geklickt = [bool]$profilKlick.art; label = $profilKlick.label }
  freundeSeite = @{ gefunden = [bool]$freundeKlick; geklickt = [bool]$freundeKlick.art; label = $freundeKlick.label }
  username = $username
  userId = $userId
  friends = @($freundeNamen)
}
