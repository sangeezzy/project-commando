# Брандмауэр Windows: пускать гостей к серверу игры из любой сети этого ПК — и из общественной, и из раздачи Wi-Fi с ПК
# (у раздачи нет сетевого профиля, Windows считает её общественной).
# Зачем: при первом запуске сервера Windows спрашивает про доступ; разрешили только частные сети — она сама создаёт
# ЗАПРЕТ для PowerShell (и Python) в общественных, а запрет сильнее любого разрешения.
# Что делает (нужны права администратора — попросит сам):
#   1. выключает запрещающие входящие правила для powershell.exe и python.exe (сами правила остаются — можно включить обратно);
#   2. разрешает только порт игры (8000: TCP — игра, UDP — поиск комнат) и только из своей подсети (LocalSubnet: те, кто в той же сети, что и ПК).
# Отменить: Remove-NetFirewallRule -Group 'Project Commando'; запреты — Enable-NetFirewallRule (по имени программы).
param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Write-Host 'Нужны права администратора — Windows спросит разрешение…'
    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port
    exit
}

$progs = @("$PSHOME\powershell.exe")
$py = Get-Command python.exe -ErrorAction SilentlyContinue
if ($py -and $py.Source -notlike '*WindowsApps*') { $progs += $py.Source }

Remove-NetFirewallRule -Group 'Project Commando' -ErrorAction SilentlyContinue
foreach ($p in $progs) {
    $block = @(Get-NetFirewallApplicationFilter -Program $p -ErrorAction SilentlyContinue | Get-NetFirewallRule |
        Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' })
    foreach ($r in $block) { Disable-NetFirewallRule -Name $r.Name; Write-Host "  выключен запрет: $($r.DisplayName) ($($r.Profile))" }
    $name = 'Project Commando — ' + [IO.Path]::GetFileName($p) + " (порт $Port)"
    New-NetFirewallRule -DisplayName $name -Group 'Project Commando' -Direction Inbound -Program $p -Protocol TCP -LocalPort $Port `
        -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
    Write-Host "  разрешено: $name — только из своей подсети"
    # поиск комнат («Список локальных серверов»): запрос по UDP на тот же порт
    New-NetFirewallRule -DisplayName ($name + ' — поиск') -Group 'Project Commando' -Direction Inbound -Program $p -Protocol UDP -LocalPort $Port `
        -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
}
Write-Host "Готово: гости из той же сети (в том числе из раздачи Wi-Fi с этого ПК) могут подключаться к порту $Port."
