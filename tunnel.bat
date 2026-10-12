@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Игра через интернет без общей сети и настроек роутера: публичная ссылка на сервер хоста через Cloudflare Tunnel.
rem Бесплатно и без регистрации. Сначала запустите start.bat, затем этот файл.
if exist cloudflared.exe goto run
echo Скачиваю cloudflared - официальную программу Cloudflare, около 50 МБ...
powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
if exist cloudflared.exe goto run
echo Не удалось скачать cloudflared. Скачайте вручную: github.com/cloudflare/cloudflared/releases - файл cloudflared-windows-amd64.exe,
echo переименуйте в cloudflared.exe и положите в папку игры.
pause
exit /b 1
:run
echo.
echo Через несколько секунд ниже появится ссылка вида https://....trycloudflare.com - отправьте её друзьям.
echo Друзья открывают ссылку в браузере и жмут «Войти». Окно не закрывайте, пока идёт игра.
echo.
cloudflared.exe tunnel --no-autoupdate --url http://localhost:8000
pause
