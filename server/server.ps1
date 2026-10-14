# Сервер игры PROJECT COMMANDO для прямого подключения — без Python: PowerShell + встроенный C# (есть в любой Windows 10/11).
# То же, что server.py: раздаёт файлы игры и пересылает игровые сообщения между хостом и гостями по WebSocket (/ws).
# Одна комната на сервер (/ws): гости — по адресу хоста (локальная сеть, Radmin VPN и т. п.).
#   powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1 [-Port 8000] [-Open] [-Report файл] [-Dev]
# Раздаёт папку game/ (рядом с server/); -Dev — ещё и /dev/… из папки dev (страницы тестов).
param([int]$Port = 8000, [switch]$Open, [string]$Report = '', [switch]$Dev, [switch]$NetCheck)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Сети, из которых гости, скорее всего, не войдут (брандмауэр Windows): общественные (Public) и без профиля — обычно раздача
# Wi-Fi с этого ПК (Windows считает её общественной). При первом запуске сервера Windows спрашивает про доступ; разрешили только
# частные сети — в общественных PowerShell запрещён. Исправить: сделать сеть частной или один раз server\Разрешить подключения.bat.
# -NetCheck: только напечатать это (server.py берёт текст отсюда) и выйти.
function NetWarning {
    try { $profiles = @(Get-NetConnectionProfile -ErrorAction Stop) } catch { return '' }
    $known = @($profiles | ForEach-Object { $_.InterfaceIndex })
    $ipsOf = { param($i) @(Get-NetIPAddress -InterfaceIndex $i -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress }) -join ', ' }
    $pub = @($profiles | Where-Object { $_.NetworkCategory -eq 'Public' })
    $bare = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
        $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $known -notcontains $_.InterfaceIndex -and
        (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq 'Up' })
    if ($pub.Count -eq 0 -and $bare.Count -eq 0) { return '' }
    $lines = @('')
    if ($pub.Count) {
        $lines += '  ВНИМАНИЕ: Windows считает эту сеть общественной — гости из неё, скорее всего, не войдут (брандмауэр):'
        foreach ($c in $pub) { $ip = & $ipsOf $c.InterfaceIndex; $lines += "    «$($c.Name)» — $($c.InterfaceAlias)" + $(if ($ip) { " ($ip)" } else { '' }) }
        $lines += '  Дома (у себя или у друзей) сделайте её частной: Параметры → Сеть и Интернет → подключение → «Частная сеть».'
        $lines += '  В кафе, гостинице и т. п. сеть не меняйте — играйте через Radmin VPN / ZeroTier / Tailscale.'
    }
    if ($bare.Count) {
        $lines += '  Раздача Wi-Fi с этого ПК (сеть без профиля — для брандмауэра она общественная):'
        foreach ($a in $bare) { $lines += "    $($a.InterfaceAlias) — друзьям: http://$($a.IPAddress):$Port" }
    }
    $lines += '  Гости не входят — один раз запустите server\Разрешить подключения.bat (спросит права администратора;'
    $lines += "  разрешит только порт $Port и только из своей сети)."
    $lines += ''
    return ($lines -join "`n")
}
if ($NetCheck) { Write-Output (NetWarning); exit }

$src = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

public static class PCServer {
    static string Root, Report, DevRoot;
    static readonly object Lk = new object();
    const int MaxGuests = 7;
    class Room { public Conn Host; public readonly Dictionary<int, Conn> Guests = new Dictionary<int, Conn>(); public int NextId = 1;
        public string Label { get { return "Комната"; } } }
    static readonly Room TheRoom = new Room();

    class Conn {
        public TcpClient C; public NetworkStream S; public bool Closed;
        readonly object w = new object();
        public void Send(string text) {
            if (Closed) return;
            byte[] data = Encoding.UTF8.GetBytes(text);
            var head = new List<byte> { 0x81 };
            if (data.Length < 126) head.Add((byte)data.Length);
            else if (data.Length < 65536) { head.Add(126); head.Add((byte)(data.Length >> 8)); head.Add((byte)data.Length); }
            else { head.Add(127); for (int i = 7; i >= 0; i--) head.Add((byte)((long)data.Length >> (8 * i))); }
            try { lock (w) { S.Write(head.ToArray(), 0, head.Count); S.Write(data, 0, data.Length); } }
            catch { Closed = true; }
        }
        public void Pong(byte[] p) {
            try { lock (w) { S.WriteByte(0x8A); S.WriteByte((byte)p.Length); S.Write(p, 0, p.Length); } } catch { Closed = true; }
        }
        public void Close() { Closed = true; try { C.Close(); } catch { } }
    }

    public static List<string> LocalAddrs() {
        var set = new SortedSet<string>();
        try { foreach (var a in Dns.GetHostAddresses(Dns.GetHostName())) if (a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)) set.Add(a.ToString()); } catch { }
        return set.ToList();
    }

    public static void Run(string root, int port, string report, bool open, string dev, string warn) {
        Root = Path.GetFullPath(root).TrimEnd('\\') + "\\"; Report = report;
        DevRoot = string.IsNullOrEmpty(dev) ? null : Path.GetFullPath(dev).TrimEnd('\\') + "\\";
        var l = new TcpListener(IPAddress.Any, port);
        l.Start();
        Console.WriteLine("PROJECT COMMANDO — сервер запущен, порт " + port + " (без Python)");
        Console.WriteLine("  Хост (этот компьютер):  http://localhost:" + port);
        var addrs = LocalAddrs();
        if (addrs.Count > 0) {
            Console.WriteLine("  Друзьям — один из адресов (свой у каждой сети; 26.x.x.x — Radmin VPN):");
            foreach (var a in addrs) Console.WriteLine("    http://" + a + ":" + port);
        }
        Console.WriteLine("  Гость не может войти? Пусть откроет адрес в браузере: не открывается — брандмауэр Windows");
        Console.WriteLine("  (разрешите PowerShell для частных сетей) или устройства в разных сетях.");
        if (!string.IsNullOrEmpty(warn)) Console.WriteLine(warn);
        Console.WriteLine("  Не закрывайте это окно, пока идёт игра.");
        if (open) { try { System.Diagnostics.Process.Start("http://localhost:" + port + "/"); } catch { } }
        while (true) {
            var c = l.AcceptTcpClient();
            var t = new Thread(() => Handle(c)); t.IsBackground = true; t.Start();
        }
    }

    static bool ReadExact(Stream s, byte[] buf, int n) {
        int got = 0;
        while (got < n) { int k = s.Read(buf, got, n - got); if (k <= 0) return false; got += k; }
        return true;
    }

    static void Handle(TcpClient c) {
        try {
            c.NoDelay = true;
            var s = c.GetStream();
            var hb = new List<byte>();
            while (hb.Count < 16384) {
                int b = s.ReadByte(); if (b < 0) { c.Close(); return; }
                hb.Add((byte)b);
                int n = hb.Count;
                if (n >= 4 && hb[n - 4] == 13 && hb[n - 3] == 10 && hb[n - 2] == 13 && hb[n - 1] == 10) break;
            }
            var lines = Encoding.ASCII.GetString(hb.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
            var rl = lines[0].Split(' ');
            if (rl.Length < 2) { c.Close(); return; }
            string method = rl[0], path = Uri.UnescapeDataString(rl[1].Split('?')[0]);
            var hdr = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var ln in lines.Skip(1)) { int i = ln.IndexOf(':'); if (i > 0) hdr[ln.Substring(0, i).Trim()] = ln.Substring(i + 1).Trim(); }
            string up;
            if (path == "/ws" && hdr.TryGetValue("Upgrade", out up) && up.ToLower() == "websocket") {
                string key = hdr.ContainsKey("Sec-WebSocket-Key") ? hdr["Sec-WebSocket-Key"] : "";
                string acc = Convert.ToBase64String(SHA1.Create().ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                var resp = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acc + "\r\n\r\n");
                s.Write(resp, 0, resp.Length);
                var conn = new Conn { C = c, S = s };
                int port = ((IPEndPoint)c.Client.LocalEndPoint).Port;
                try { Serve(TheRoom, conn, string.Join(",", LocalAddrs().Select(a => a + ":" + port))); }
                finally { conn.Close(); }
                return;
            }
            if (method == "POST" && path == "/report" && !string.IsNullOrEmpty(Report)) {
                int n = hdr.ContainsKey("Content-Length") ? int.Parse(hdr["Content-Length"]) : 0;
                var body = new byte[n]; ReadExact(s, body, n);
                File.WriteAllBytes(Report, body);
                Reply(s, "200 OK", "text/plain", new byte[0]);
                c.Close(); return;
            }
            if (method != "GET" && method != "HEAD") { Reply(s, "405 Method Not Allowed", "text/plain", new byte[0]); c.Close(); return; }
            if (path.EndsWith("/")) path += "index.html";
            string bas = Root;
            if (DevRoot != null && path.StartsWith("/dev/")) { bas = DevRoot; path = path.Substring(4); }
            string f = Path.GetFullPath(Path.Combine(bas, path.TrimStart('/').Replace('/', '\\')));
            if (!f.StartsWith(bas, StringComparison.OrdinalIgnoreCase) || !File.Exists(f)) {
                Reply(s, "404 Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Не найдено")); c.Close(); return;
            }
            var data = File.ReadAllBytes(f);
            Reply(s, "200 OK", Mime(f), method == "GET" ? data : new byte[0], data.Length);
            c.Close();
        } catch (Exception ex) {
            Console.WriteLine("Ошибка запроса: " + ex.GetType().Name + ": " + ex.Message);
            try { c.Close(); } catch { }
        }
    }

    static void Reply(Stream s, string status, string ctype, byte[] body, int len = -1) {
        var h = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Type: " + ctype + "\r\nContent-Length: " + (len < 0 ? body.Length : len) +
            "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n");
        s.Write(h, 0, h.Length); s.Write(body, 0, body.Length);
    }

    static string Mime(string f) {
        switch (Path.GetExtension(f).ToLower()) {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "application/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".md": case ".txt": case ".py": case ".bat": case ".ps1": return "text/plain; charset=utf-8";
            case ".png": return "image/png";
            case ".svg": return "image/svg+xml";
            case ".ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    // Следующее текстовое сообщение или null (закрыто)
    static string Recv(Conn k) {
        var buf = new MemoryStream();
        var h = new byte[8];
        while (true) {
            if (!ReadExact(k.S, h, 2)) return null;
            bool fin = (h[0] & 0x80) != 0; int op = h[0] & 0x0F;
            long n = h[1] & 0x7F;
            if (n == 126) { if (!ReadExact(k.S, h, 2)) return null; n = (h[0] << 8) | h[1]; }
            else if (n == 127) { if (!ReadExact(k.S, h, 8)) return null; n = 0; for (int i = 0; i < 8; i++) n = (n << 8) | h[i]; }
            var mask = new byte[4];
            if (!ReadExact(k.S, mask, 4)) return null;          // от браузера кадры всегда с маской
            var data = new byte[n];
            if (n > 0 && !ReadExact(k.S, data, (int)n)) return null;
            for (int i = 0; i < n; i++) data[i] ^= mask[i % 4];
            if (op == 8) return null;
            if (op == 9) { k.Pong(data); continue; }
            if (op == 10) continue;
            buf.Write(data, 0, data.Length);
            if (fin) return Encoding.UTF8.GetString(buf.ToArray());
        }
    }

    // Протокол (заголовок перед JSON игры): хост H, T<id>|…, A|…, K<id>; гость G, M|…
    // сервер → хосту O|адреса, J<id>, L<id>, F<id>|…, E|…; гостю W<id>, M|…, X, E|…
    static void Serve(Room r, Conn k, string addrs) {
        string hello = Recv(k);
        if (hello == "H") {
            lock (Lk) { if (r.Host != null && !r.Host.Closed) { k.Send("E|host-exists"); return; } r.Host = k; }
            k.Send("O|" + addrs);
            Console.WriteLine(r.Label + ": хост создал комнату");
            try {
                while (true) {
                    string m = Recv(k); if (m == null) break;
                    if (m.StartsWith("A|")) { string body = "M|" + m.Substring(2); Conn[] gs; lock (Lk) gs = r.Guests.Values.ToArray(); foreach (var g in gs) g.Send(body); }
                    else if (m.StartsWith("T")) {
                        int bar = m.IndexOf('|'); int id; Conn g = null;
                        if (bar > 1 && int.TryParse(m.Substring(1, bar - 1), out id)) lock (Lk) r.Guests.TryGetValue(id, out g);
                        if (g != null) g.Send("M|" + m.Substring(bar + 1));
                    } else if (m.StartsWith("K")) {
                        int id; Conn g = null;
                        if (int.TryParse(m.Substring(1), out id)) lock (Lk) { if (r.Guests.TryGetValue(id, out g)) r.Guests.Remove(id); }
                        if (g != null) g.Close();
                    }
                }
            } finally {
                Conn[] gs = new Conn[0];
                lock (Lk) { if (r.Host == k) { r.Host = null; gs = r.Guests.Values.ToArray(); r.Guests.Clear(); } }
                if (gs.Length > 0 || r.Host == null) Console.WriteLine(r.Label + ": хост вышел — комната закрыта");
                foreach (var g in gs) { g.Send("X"); g.Close(); }
            }
        } else if (hello == "G") {
            int id; Conn host;
            lock (Lk) { host = r.Host; if (host == null || host.Closed) { k.Send("E|no-host"); return; } if (r.Guests.Count >= MaxGuests) { k.Send("E|full"); return; } id = r.NextId++; r.Guests[id] = k; }
            k.Send("W" + id);
            host.Send("J" + id);
            Console.WriteLine(r.Label + ": гость " + id + " подключился");
            try {
                while (true) {
                    string m = Recv(k); if (m == null) break;
                    if (m.StartsWith("M|")) { Conn h; lock (Lk) h = r.Host; if (h != null) h.Send("F" + id + "|" + m.Substring(2)); }
                }
            } finally {
                bool was; Conn h;
                lock (Lk) { was = r.Guests.Remove(id); h = r.Host; }
                if (was && h != null) h.Send("L" + id);
                Console.WriteLine(r.Label + ": гость " + id + " отключился");
            }
        }
    }
}
'@

Add-Type -TypeDefinition $src -Language CSharp

try {
    $top = Split-Path -Parent $PSScriptRoot      # server/ и game/ лежат рядом
    $devDir = if ($Dev) { Join-Path $top 'dev' } else { '' }
    [PCServer]::Run((Join-Path $top 'game'), $Port, $Report, [bool]$Open, $devDir, (NetWarning))
} catch {
    Write-Host "Не удалось запустить сервер на порту ${Port}: $($_.Exception.InnerException.Message)"
    Write-Host 'Возможно, порт занят (игра уже запущена?). Закройте другое окно сервера или укажите другой порт.'
}
