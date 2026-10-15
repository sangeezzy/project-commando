package com.projectcommando.game;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.SocketTimeoutException;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;

// Сервер игры — то же, что server/server.ps1 и server.py: файлы игры по HTTP и одна комната по WebSocket /ws.
// Без Android: в приложении файлы — из assets (MainActivity), на ПК — из папки (main: тесты dev/run_tests.py, сервер «java»).
// Протокол (заголовок перед JSON игры, сервер его не разбирает):
//   хост → сервер: H (создать комнату), T<id>|… (гостю), A|… (всем гостям), K<id> (отключить гостя),
//                  I|json (о комнате для списка серверов — отдаётся в GET /info как есть)
// Поиск серверов: UDP «PCR?» на порт игры → «PCR!<порт>»; GET /info, GET /lan (lanScan) — как у server.py.
//   гость → сервер: G (войти), M|… (хосту)
//   сервер → хосту: O|адреса, J<id> (вошёл), L<id> (вышел), F<id>|… (от гостя), E|ошибка
//   сервер → гостю: W<id> (вошёл), M|… (от хоста), X (хост ушёл), E|ошибка (host-exists, no-host, full)
public class GameServer {
    public interface Files { InputStream open(String path) throws IOException; }   // путь без «/» в начале; нет файла — null
    public interface Log { void line(String s); }

    static final int MAX_GUESTS = 7;               // в игре 4 места; лишние получат от хоста «комната заполнена»
    static final String WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private final Files files, dev;                // dev — страницы тестов по адресу /dev/… (только на ПК)
    private final File report;                     // тесты: POST /report пишется сюда
    private final Log log;
    private ServerSocket ss;
    private volatile boolean running;
    private WS host;                               // комната
    private String info;                           // I|json от хоста
    private DatagramSocket udp;                    // ответ на поиск серверов
    private final String id = String.format("%08x", new Random().nextInt());
    private final Map<Integer, WS> guests = new HashMap<>();
    private int nextId = 1;

    public GameServer(Files files, Files dev, File report, Log log) {
        this.files = files; this.dev = dev; this.report = report; this.log = log;
    }

    // Запустить на порту (занят — IOException); возвращает порт
    public synchronized int start(int port) throws IOException {
        if (running) return ss.getLocalPort();
        ServerSocket s = new ServerSocket();
        s.setReuseAddress(true);
        s.bind(new InetSocketAddress(port));
        ss = s;
        running = true;
        Thread t = new Thread(this::acceptLoop, "commando-accept");
        t.setDaemon(true);
        t.start();
        try {                                       // порт UDP занят — без ответа на поиск (найдут перебором адресов)
            udp = new DatagramSocket(null);
            udp.setReuseAddress(true);
            udp.bind(new InetSocketAddress(s.getLocalPort()));
            Thread u = new Thread(this::lanAnswer, "commando-lan");
            u.setDaemon(true);
            u.start();
        } catch (IOException e) { udp = null; }
        return s.getLocalPort();
    }

    public boolean isRunning() { return running; }
    public int port() { return running ? ss.getLocalPort() : 0; }

    public void stop() {
        running = false;
        try { if (ss != null) ss.close(); } catch (IOException e) { /* уже закрыт */ }
        if (udp != null) udp.close();
        List<WS> all = new ArrayList<>();
        synchronized (this) {
            if (host != null) all.add(host);
            all.addAll(guests.values());
            host = null;
            guests.clear();
        }
        for (WS w : all) w.close();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket c = ss.accept();
                Thread t = new Thread(() -> handle(c), "commando-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (!running) break;        // остановлен; иначе (клиент оборвал соединение) — принимаем дальше
            }
        }
    }

    private void lanAnswer() {
        DatagramSocket u = udp;
        byte[] buf = new byte[64];
        byte[] ans = ("PCR!" + ss.getLocalPort()).getBytes(StandardCharsets.US_ASCII);
        while (running && u != null && !u.isClosed()) {
            try {
                DatagramPacket d = new DatagramPacket(buf, buf.length);
                u.receive(d);
                if ("PCR?".equals(new String(d.getData(), 0, d.getLength(), StandardCharsets.US_ASCII)))
                    u.send(new DatagramPacket(ans, ans.length, d.getSocketAddress()));
            } catch (IOException e) { /* закрыт или сбой одного пакета */ }
        }
    }

    // Спросить серверы во всех сетях устройства (широковещательно) → {"addrs":[свои],"found":["ip:порт",…]}
    public static String lanScan(int ms) {
        List<String> addrs = localAddrs();
        Set<String> targets = new TreeSet<>();
        targets.add("255.255.255.255");
        for (String a : addrs) {
            String[] q = a.split("\\.");
            targets.add(q[0] + "." + q[1] + "." + q[2] + ".255");
            if (q[0].equals("10") || q[0].equals("26")) targets.add(q[0] + ".255.255.255");
        }
        Set<String> found = new TreeSet<>();
        try (DatagramSocket u = new DatagramSocket()) {
            u.setBroadcast(true);
            byte[] ask = "PCR?".getBytes(StandardCharsets.US_ASCII);
            for (String t : targets) for (int p = 8000; p < 8004; p++) {
                try { u.send(new DatagramPacket(ask, ask.length, InetAddress.getByName(t), p)); } catch (IOException e) { /* сеть не пускает */ }
            }
            long end = System.currentTimeMillis() + ms;
            byte[] buf = new byte[64];
            while (true) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                u.setSoTimeout((int) left);
                DatagramPacket d = new DatagramPacket(buf, buf.length);
                try { u.receive(d); } catch (SocketTimeoutException e) { break; } catch (IOException e) { continue; }
                String m = new String(d.getData(), 0, d.getLength(), StandardCharsets.US_ASCII);
                if (m.startsWith("PCR!") && m.substring(4).matches("\\d{1,5}") && !d.getAddress().isLoopbackAddress())
                    found.add(d.getAddress().getHostAddress() + ":" + m.substring(4));
            }
        } catch (IOException e) { /* нет сети */ }
        return "{\"addrs\":" + jsonList(addrs) + ",\"found\":" + jsonList(new ArrayList<>(found)) + "}";
    }

    private static String jsonList(List<String> l) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < l.size(); i++) b.append(i > 0 ? "," : "").append('"').append(l.get(i)).append('"');
        return b.append(']').toString();
    }

    private synchronized String infoJson() {
        boolean room = host != null && !host.closed;
        return "{\"commando\":1,\"id\":\"" + id + "\",\"room\":" + room + ",\"guests\":" + guests.size() +
            ",\"info\":" + (room && info != null && !info.isEmpty() ? info : "null") + "}";
    }

    // Адреса этого устройства, по которым к нему могут подключиться (Wi-Fi, точка доступа, ZeroTier, Tailscale…)
    public static List<String> localAddrs() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress() && !a.isLinkLocalAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception e) { /* нет сети */ }
        Collections.sort(out);
        return out;
    }

    // ---------- HTTP: файлы игры + переход на WebSocket ----------
    private void handle(Socket c) {
        try {
            c.setSoTimeout(15000);
            InputStream in = c.getInputStream();
            OutputStream out = c.getOutputStream();
            String head = readHead(in);
            if (head == null) { c.close(); return; }
            String[] lines = head.split("\r\n");
            String[] rl = lines[0].split(" ");
            if (rl.length < 2) { c.close(); return; }
            String method = rl[0];
            Map<String, String> hdr = new HashMap<>();
            for (int i = 1; i < lines.length; i++) {
                int k = lines[i].indexOf(':');
                if (k > 0) hdr.put(lines[i].substring(0, k).trim().toLowerCase(Locale.ROOT), lines[i].substring(k + 1).trim());
            }
            String path = rl[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            int h = path.indexOf('#');
            if (h >= 0) path = path.substring(0, h);
            path = URLDecoder.decode(path.replace("+", "%2B"), "UTF-8");

            if (path.equals("/ws") && "websocket".equalsIgnoreCase(hdr.getOrDefault("upgrade", ""))) {
                String acc = base64(MessageDigest.getInstance("SHA-1").digest((hdr.getOrDefault("sec-websocket-key", "") + WS_MAGIC).getBytes(StandardCharsets.ISO_8859_1)));
                out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acc + "\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                c.setSoTimeout(0);
                c.setTcpNoDelay(true);                  // без задержек мелких пакетов
                WS ws = new WS(c, in, out);
                List<String> addrs = new ArrayList<>();
                for (String a : localAddrs()) addrs.add(a + ":" + c.getLocalPort());
                try { serve(ws, addrs); } finally { ws.close(); }
                return;
            }
            // список серверов в меню: страница может быть с другого адреса (или файлом) — разрешить чтение отовсюду
            String cors = "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n";
            if (method.equals("OPTIONS") && (path.equals("/info") || path.equals("/lan"))) {
                out.write(("HTTP/1.1 204 No Content\r\n" + cors + "Access-Control-Allow-Methods: GET\r\nAccess-Control-Allow-Headers: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
                c.close();
                return;
            }
            if (method.equals("GET") && (path.equals("/info") || path.equals("/lan"))) {
                byte[] body = (path.equals("/info") ? infoJson() : lanScan(700)).getBytes(StandardCharsets.UTF_8);
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n" + cors + "Content-Length: " + body.length +
                    "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
                out.write(body);
                out.flush();
                c.close();
                return;
            }
            if (method.equals("POST") && path.equals("/report") && report != null) {
                int n = Integer.parseInt(hdr.getOrDefault("content-length", "0"));
                byte[] body = readN(in, n);
                try (FileOutputStream f = new FileOutputStream(report)) { f.write(body); }
                reply(out, "200 OK", "text/plain", new byte[0], 0);
                c.close();
                return;
            }
            if (!method.equals("GET") && !method.equals("HEAD")) { reply(out, "405 Method Not Allowed", "text/plain", new byte[0], 0); c.close(); return; }
            if (path.endsWith("/")) path += "index.html";
            Files src = files;
            if (dev != null && path.startsWith("/dev/")) { src = dev; path = path.substring(4); }
            String rel = path.startsWith("/") ? path.substring(1) : path;
            InputStream f = rel.contains("..") || rel.contains("\\") || rel.isEmpty() ? null : openOrNull(src, rel);
            if (f == null) {
                byte[] nf = "Не найдено".getBytes(StandardCharsets.UTF_8);
                reply(out, "404 Not Found", "text/plain; charset=utf-8", nf, nf.length);
                c.close();
                return;
            }
            byte[] data;
            try { data = readAll(f); } finally { f.close(); }
            reply(out, "200 OK", mime(rel), method.equals("GET") ? data : new byte[0], data.length);
            c.close();
        } catch (Exception e) {
            if (!(e instanceof java.net.SocketTimeoutException) && !(e instanceof java.net.SocketException)) say("Ошибка запроса: " + e);
            try { c.close(); } catch (IOException e2) { /* уже закрыт */ }
        }
    }

    private static InputStream openOrNull(Files src, String rel) {
        try { return src.open(rel); } catch (IOException e) { return null; }
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int last4 = 0;                              // последние 4 байта: конец заголовков — \r\n\r\n
        while (b.size() < 16384) {
            int x = in.read();
            if (x < 0) return null;
            b.write(x);
            last4 = last4 << 8 | x;
            if (last4 == 0x0D0A0D0A) return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
        }
        return null;
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int got = 0;
        while (got < n) { int k = in.read(b, got, n - got); if (k < 0) throw new IOException("обрыв"); got += k; }
        return b;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        for (int k; (k = in.read(buf)) > 0; ) b.write(buf, 0, k);
        return b.toByteArray();
    }

    private static void reply(OutputStream out, String status, String type, byte[] body, int len) throws IOException {
        out.write(("HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + len +
            "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String mime(String f) {
        String e = f.substring(f.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (e) {
            case "html": return "text/html; charset=utf-8";
            case "js": return "application/javascript; charset=utf-8";
            case "json": return "application/json; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "png": return "image/png";
            case "svg": return "image/svg+xml";
            case "ico": return "image/x-icon";
            default: return "application/octet-stream";
        }
    }

    // Base64 без java.util.Base64 (его нет до Android 8)
    private static String base64(byte[] d) {
        String abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < d.length; i += 3) {
            int n = (d[i] & 255) << 16 | (i + 1 < d.length ? (d[i + 1] & 255) << 8 : 0) | (i + 2 < d.length ? d[i + 2] & 255 : 0);
            s.append(abc.charAt(n >> 18 & 63)).append(abc.charAt(n >> 12 & 63));
            s.append(i + 1 < d.length ? abc.charAt(n >> 6 & 63) : '=').append(i + 2 < d.length ? abc.charAt(n & 63) : '=');
        }
        return s.toString();
    }

    private void say(String s) { if (log != null) log.line(s); }

    // ---------- Комната: хост и гости, пересылка ----------
    private void serve(WS ws, List<String> addrs) throws IOException {
        String hello = ws.recv();
        if ("H".equals(hello)) {
            synchronized (this) {
                if (host != null && !host.closed) { ws.send("E|host-exists"); return; }
                host = ws;
            }
            ws.send("O|" + String.join(",", addrs));
            say("Комната: хост создал комнату");
            try {
                for (String m; (m = ws.recv()) != null; ) {
                    if (m.startsWith("I|")) {
                        synchronized (this) { info = m.substring(2); }
                    } else if (m.startsWith("A|")) {
                        String body = "M|" + m.substring(2);
                        List<WS> gs;
                        synchronized (this) { gs = new ArrayList<>(guests.values()); }
                        for (WS g : gs) g.send(body);
                    } else if (m.startsWith("T")) {
                        int bar = m.indexOf('|');
                        WS g = null;
                        try { synchronized (this) { g = guests.get(Integer.parseInt(m.substring(1, bar))); } } catch (RuntimeException e) { /* плохой номер */ }
                        if (g != null) g.send("M|" + m.substring(bar + 1));
                    } else if (m.startsWith("K")) {
                        WS g = null;
                        try { synchronized (this) { g = guests.remove(Integer.parseInt(m.substring(1))); } } catch (RuntimeException e) { /* плохой номер */ }
                        if (g != null) g.close();
                    }
                }
            } finally {
                List<WS> gs = null;
                synchronized (this) {
                    if (host == ws) { host = null; info = null; gs = new ArrayList<>(guests.values()); guests.clear(); }
                }
                if (gs != null) {
                    say("Комната: хост вышел — комната закрыта");
                    for (WS g : gs) { g.send("X"); g.close(); }
                }
            }
        } else if ("G".equals(hello)) {
            int gid;
            WS h;
            synchronized (this) {
                h = host;
                if (h == null || h.closed) { gid = -1; }
                else if (guests.size() >= MAX_GUESTS) { gid = -2; }
                else { gid = nextId++; guests.put(gid, ws); }
            }
            if (gid == -1) { ws.send("E|no-host"); return; }
            if (gid == -2) { ws.send("E|full"); return; }
            ws.send("W" + gid);
            h.send("J" + gid);
            say("Комната: гость " + gid + " подключился");
            try {
                for (String m; (m = ws.recv()) != null; ) {
                    if (!m.startsWith("M|")) continue;
                    WS hh;
                    synchronized (this) { hh = host; }
                    if (hh != null) hh.send("F" + gid + "|" + m.substring(2));
                }
            } finally {
                boolean was;
                WS hh;
                synchronized (this) { was = guests.remove(gid) != null; hh = host; }
                if (was && hh != null) hh.send("L" + gid);
                say("Комната: гость " + gid + " отключился");
            }
        }
    }

    // ---------- WebSocket (только текст; ping → pong) ----------
    static final class WS {
        final Socket s;
        final InputStream in;
        final OutputStream out;
        volatile boolean closed;

        WS(Socket s, InputStream in, OutputStream out) { this.s = s; this.in = in; this.out = out; }

        // Следующее текстовое сообщение или null (закрыто)
        String recv() {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try {
                while (true) {
                    int b0 = in.read(), b1 = in.read();
                    if (b0 < 0 || b1 < 0) return null;
                    boolean fin = (b0 & 0x80) != 0;
                    int op = b0 & 0x0F;
                    long n = b1 & 0x7F;
                    if (n == 126) { byte[] e = readN(in, 2); n = (e[0] & 255) << 8 | (e[1] & 255); }
                    else if (n == 127) { byte[] e = readN(in, 8); n = 0; for (byte x : e) n = n << 8 | (x & 255); }
                    if (n > 64 << 20) return null;           // больше 64 МБ — не наш клиент
                    byte[] mask = (b1 & 0x80) != 0 ? readN(in, 4) : null;
                    byte[] data = readN(in, (int) n);
                    if (mask != null) for (int i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
                    if (op == 8) return null;
                    if (op == 9) { frame(0xA, data); continue; }
                    if (op == 0xA) continue;
                    buf.write(data, 0, data.length);
                    if (fin) return new String(buf.toByteArray(), StandardCharsets.UTF_8);
                }
            } catch (IOException e) {
                return null;
            }
        }

        synchronized void frame(int op, byte[] d) throws IOException {
            int n = d.length;
            byte[] h;
            if (n < 126) h = new byte[] { (byte) (0x80 | op), (byte) n };
            else if (n < 65536) h = new byte[] { (byte) (0x80 | op), 126, (byte) (n >> 8), (byte) n };
            else h = new byte[] { (byte) (0x80 | op), 127, 0, 0, 0, 0, (byte) (n >> 24), (byte) (n >> 16), (byte) (n >> 8), (byte) n };
            out.write(h);
            out.write(d);
            out.flush();
        }

        void send(String text) {
            if (closed) return;
            try { frame(1, text.getBytes(StandardCharsets.UTF_8)); } catch (IOException e) { closed = true; }
        }

        void close() {
            closed = true;
            try { s.close(); } catch (IOException e) { /* уже закрыт */ }
        }
    }

    // ---------- На ПК (тесты): java GameServer --port 8000 --root game [--dev dev] [--report файл] ----------
    public static Files dirFiles(final File root) {
        return (rel) -> {
            File f = new File(root, rel);
            if (!f.getCanonicalPath().startsWith(root.getCanonicalPath()) || !f.isFile()) return null;
            try { return new FileInputStream(f); } catch (FileNotFoundException e) { return null; }
        };
    }

    public static void main(String[] a) throws Exception {
        int port = 8000;
        File root = new File("game"), dev = null, report = null;
        for (int i = 0; i < a.length; i++) {
            if (a[i].equals("--port")) port = Integer.parseInt(a[++i]);
            else if (a[i].equals("--root")) root = new File(a[++i]);
            else if (a[i].equals("--dev")) dev = new File(a[++i]);
            else if (a[i].equals("--report")) report = new File(a[++i]);
        }
        GameServer s = new GameServer(dirFiles(root), dev == null ? null : dirFiles(dev), report, System.out::println);
        int p = s.start(port);
        System.out.println("PROJECT COMMANDO — сервер (Java) запущен, порт " + p);
        for (String ad : localAddrs()) System.out.println("    http://" + ad + ":" + p);
        Thread.currentThread().join();
    }
}
