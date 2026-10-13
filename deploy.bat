@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Онлайн-сервер игры на Cloudflare Workers (бесплатно): игра по ссылке https://project-commando.<имя>.workers.dev
rem и комнаты по коду — друзья заходят из любой точки интернета, без общей сети, VPN и туннелей.
rem Нужен Node.js (nodejs.org, версия LTS) и бесплатный аккаунт Cloudflare. Повторный запуск — обновить игру на сервере.
where npx >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org ^(LTS^), перезапустите этот файл.
  pause
  exit /b 1
)
echo Вход в аккаунт Cloudflare ^(откроется браузер; если уже входили - пропустится^)...
call npx --yes wrangler@4 whoami | findstr /C:"You are logged in" >nul || call npx --yes wrangler@4 login
echo.
echo Выкладываю игру и ретранслятор...
call npx --yes wrangler@4 deploy --config cloud/wrangler.toml
echo.
echo Готово. Ссылка на игру - строка https://....workers.dev выше. Её открывают все игроки:
echo хост жмёт «Создать онлайн-комнату», остальные вводят код комнаты ^(или открывают ссылку-приглашение из лобби^).
pause
