using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

// Vystra Web-App-Stub: liest url.txt daneben und oeffnet die Seite im
// WINDOWS-STANDARD-Browser (Chrome/Edge) im App-Vollbild mit dem NORMALEN
// Profil -> bestehende Anmeldungen (Google/Discord/...) gelten sofort, und
// Sign-in-Popups laufen ueber den echten Browser (nicht ueber ein isoliertes
// App-Profil). Kopiere die .exe + eine eigene url.txt = neue App.
class VystraWebApp
{
    static void Main()
    {
        try
        {
            string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string txt = Path.Combine(dir, "url.txt");
            string url = File.Exists(txt) ? File.ReadAllText(txt).Trim() : "";
            if (url.Length == 0) return;
            if (url.IndexOf("http://", StringComparison.OrdinalIgnoreCase) != 0 &&
                url.IndexOf("https://", StringComparison.OrdinalIgnoreCase) != 0)
                url = "https://" + url;

            string browser = DefaultChromiumBrowser();
            if (browser != null)
            {
                // Standard-Profil (kein --user-data-dir) -> Logins gelten, Popups
                // laufen im echten Browser.
                var psi = new ProcessStartInfo(browser,
                    "--app=" + url + " --start-fullscreen --no-first-run");
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
            else
            {
                // Kein Chromium als Standard -> URL einfach im Windows-Standardbrowser oeffnen.
                var psi = new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
        }
        catch
        {
            try
            {
                string dir2 = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string u = File.ReadAllText(Path.Combine(dir2, "url.txt")).Trim();
                if (u.IndexOf("http", StringComparison.OrdinalIgnoreCase) != 0) u = "https://" + u;
                Process.Start(new ProcessStartInfo(u) { UseShellExecute = true });
            }
            catch { }
        }
    }

    // Ermittelt den Windows-Standardbrowser; gibt den exe-Pfad zurueck, wenn es
    // ein Chromium (Chrome/Edge/Brave) ist (fuer den sauberen --app-Vollbildmodus),
    // sonst null (dann normaler ShellExecute-Open).
    static string DefaultChromiumBrowser()
    {
        try
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice"))
            {
                string progId = k != null ? (k.GetValue("ProgId") as string) : null;
                if (progId != null)
                {
                    string p = progId.ToLowerInvariant();
                    if (p.Contains("chrome")) { string c = FindChrome(); if (c != null) return c; }
                    if (p.Contains("edge") || p.Contains("msedge")) { string e = FindEdge(); if (e != null) return e; }
                    if (p.Contains("brave")) { string b = FindBrave(); if (b != null) return b; }
                }
            }
        }
        catch { }
        // Fallback-Reihenfolge, wenn ProgId unklar: Chrome, dann Edge.
        return FindChrome() ?? FindEdge();
    }

    static string First(params string[] paths)
    {
        foreach (string c in paths) { try { if (c != null && File.Exists(c)) return c; } catch { } }
        return null;
    }
    static string PF { get { return Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles); } }
    static string PFx86 { get { return Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86); } }
    static string LAD { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }

    static string FindChrome()
    {
        return First(
            Path.Combine(PF, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(PFx86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(LAD, "Google", "Chrome", "Application", "chrome.exe"));
    }
    static string FindEdge()
    {
        return First(
            Path.Combine(PFx86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(PF, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
    static string FindBrave()
    {
        return First(
            Path.Combine(PF, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            Path.Combine(PFx86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            Path.Combine(LAD, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
    }
}
