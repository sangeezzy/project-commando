package com.projectcommando.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;

// Игра — страница из assets (dist/, собранная dev/build.py) в WebView на весь экран, горизонтально.
// Адрес — file:///android_asset/game/index.html?app=1: защищённый контекст (микрофон работает),
// подключение к серверу хоста — обычный ws:// (смешанного содержимого нет). app=1 — режим приложения в игре.
// Телефон может быть и хостом: «Создать комнату» → CommandoApp.startServer() — сервер игры (GameServer) внутри приложения,
// файлы — из тех же assets; друзья входят по адресу телефона (из приложения или из браузера).
public class MainActivity extends Activity {
    private static final int REQ_MIC = 1;
    private WebView web;
    private PermissionRequest pendingMic;
    private GameServer server;

    // Мост для страницы игры (window.CommandoApp): свой сервер на телефоне
    public class Bridge {
        // Запустить сервер (уже запущен — тот же): {"ok":true,"port":8000,"addrs":["192.168.0.5:8000",…]} или {"ok":false,"err":"…"}
        @JavascriptInterface
        public String startServer() {
            synchronized (MainActivity.this) {
                if (server == null) {
                    server = new GameServer((rel) -> {
                        try { return getAssets().open("game/" + rel); } catch (FileNotFoundException e) { return null; }
                    }, null, null, null);
                }
                IOException err = null;
                if (!server.isRunning()) {
                    for (int port = 8000; port <= 8010 && !server.isRunning(); port++) {
                        try { server.start(port); } catch (IOException e) { err = e; }
                    }
                }
                if (!server.isRunning()) return "{\"ok\":false,\"err\":" + json(err == null ? "?" : err.getMessage()) + "}";
                StringBuilder a = new StringBuilder();
                List<String> addrs = GameServer.localAddrs();
                for (int i = 0; i < addrs.size(); i++) a.append(i > 0 ? "," : "").append(json(addrs.get(i) + ":" + server.port()));
                return "{\"ok\":true,\"port\":" + server.port() + ",\"addrs\":[" + a + "]}";
            }
        }

        @JavascriptInterface
        public void stopServer() {
            synchronized (MainActivity.this) { if (server != null) server.stop(); }
        }

        @JavascriptInterface
        public boolean serverRunning() { return server != null && server.isRunning(); }

        // Список серверов: спросить серверы игры в сетях телефона (UDP, ~0,6 с) → {"addrs":[свои адреса],"found":["ip:порт",…]}
        @JavascriptInterface
        public String lanScan() { return GameServer.lanScan(600); }
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : (s == null ? "" : s).toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 32) b.append(' ');
            else b.append(c);
        }
        return b.append('"').toString();
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            // вырез камеры: рисовать и под ним (по короткой стороне)
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(0x1b, 0x1c, 0x1d));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                  // localStorage: позывной, масштаб, адрес хоста
        s.setAllowFileAccess(true);                    // страница игры — из assets
        s.setAllowFileAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);  // звук без лишнего касания
        s.setTextZoom(100);                            // крупный шрифт в системе не ломает интерфейс игры
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                // голосовой чат: getUserMedia → разрешение Android на микрофон → разрешение странице
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                        pendingMic = req;
                        requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MIC);
                    } else req.grant(req.getResources());
                });
            }
        });
        web.addJavascriptInterface(new Bridge(), "CommandoApp");
        setContentView(web);
        hideBars();
        if (state != null) web.restoreState(state);
        else web.loadUrl("file:///android_asset/game/index.html?app=1");
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code != REQ_MIC || pendingMic == null) return;
        if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingMic.grant(pendingMic.getResources());
        else pendingMic.deny();
        pendingMic = null;
    }

    // Полный экран без панелей (появляются по свайпу от края и сами прячутся)
    @SuppressWarnings("deprecation")
    private void hideBars() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    // «Назад»: игра решает сама (appBack в touch.js: в бою — меню ≡, открыто меню — закрыть); не обработала — свернуть приложение
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("typeof appBack === 'function' && appBack()", (r) -> {
            if (!"true".equals(r)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    // Свёрнуто: хост (свой сервер) WebView не притормаживает — игра у друзей идёт дальше, пока Android не остановит приложение
    @Override
    protected void onPause() {
        super.onPause();
        if (server == null || !server.isRunning()) web.onPause();
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        super.onDestroy();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
    }
}
