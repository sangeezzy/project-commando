"""Инструменты для сборки .apk — один раз: JDK 17 и Android SDK (без Android Studio, Gradle и Node.js).

    python dev/android/setup.py --accept-licenses

Ставится в %LOCALAPPDATA%\\commando-android (вне папки проекта, ~1,5 ГБ, скачивается ~0,5 ГБ):
  jdk/  — Eclipse Temurin 17 (javac, keytool)
  sdk/  — cmdline-tools, platforms;android-34 (android.jar), build-tools;34.0.0 (aapt2, d8, zipalign, apksigner)
--accept-licenses — согласие с лицензией Android SDK (https://developer.android.com/studio/terms): без него SDK не скачать.
Системный прокси (как у urllib) передаётся и sdkmanager.
"""
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

TOOLS = Path(os.environ.get('COMMANDO_ANDROID', Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'commando-android'))
JDK_URL = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse'
CMDLINE_URL = 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
PACKAGES = ['platforms;android-34', 'build-tools;34.0.0']

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


def download(url, dst):
    if dst.exists():
        return dst
    print(f'  скачиваю {url}')
    tmp = dst.with_suffix('.part')
    req = urllib.request.Request(url, headers={'User-Agent': 'commando-setup/1.0'})     # без него api.adoptium.net отвечает 403
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, 'wb') as f:
        total = int(r.headers.get('Content-Length') or 0)
        done = 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            done += len(b)
            if total:
                print(f'\r  {done >> 20} / {total >> 20} МБ', end='', flush=True)
    print()
    tmp.rename(dst)
    return dst


def unzip(src, into):
    # каждый архив — в свою пустую папку
    if into.exists():
        shutil.rmtree(into)
    into.mkdir(parents=True)
    with zipfile.ZipFile(src) as z:
        z.extractall(into)


def jdk_home():
    d = TOOLS / 'jdk'
    if (d / 'bin' / 'javac.exe').exists():
        return d
    return None


def setup_jdk():
    if jdk_home():
        print('JDK: уже есть')
        return
    print('JDK 17 (Eclipse Temurin)…')
    z = download(JDK_URL, TOOLS / 'downloads' / 'jdk17.zip')
    tmp = TOOLS / 'jdk.tmp'
    unzip(z, tmp)
    inner = next(p for p in tmp.iterdir() if p.is_dir())      # jdk-17.0.x+y
    if (TOOLS / 'jdk').exists():
        shutil.rmtree(TOOLS / 'jdk')
    inner.rename(TOOLS / 'jdk')
    shutil.rmtree(tmp)


def proxy_args():
    p = urllib.request.getproxies().get('https') or urllib.request.getproxies().get('http')
    if not p:
        return []
    hp = p.split('://')[-1].rstrip('/')
    host, _, port = hp.rpartition(':')
    return ['--proxy=http', f'--proxy_host={host}', f'--proxy_port={port}'] if host and port.isdigit() else []


def setup_sdk(accept):
    sdk = TOOLS / 'sdk'
    tool = sdk / 'cmdline-tools' / 'latest' / 'bin' / 'sdkmanager.bat'
    if not tool.exists():
        print('Android cmdline-tools…')
        z = download(CMDLINE_URL, TOOLS / 'downloads' / 'cmdline-tools.zip')
        tmp = TOOLS / 'cmdline.tmp'
        unzip(z, tmp)
        dst = sdk / 'cmdline-tools' / 'latest'
        if dst.exists():
            shutil.rmtree(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        (tmp / 'cmdline-tools').rename(dst)
        shutil.rmtree(tmp)
    need = [p for p in PACKAGES if not (sdk / p.replace(';', os.sep)).exists()]
    if not need:
        print('Android SDK: уже есть')
        return
    if not accept:
        sys.exit('Нужно согласие с лицензией Android SDK (https://developer.android.com/studio/terms): '
                 'запустите с --accept-licenses')
    env = dict(os.environ, JAVA_HOME=str(jdk_home()))
    base = [str(tool), f'--sdk_root={sdk}'] + proxy_args()
    print('Лицензии Android SDK — согласие (--accept-licenses)…')
    subprocess.run(base + ['--licenses'], input=('y\n' * 20).encode(), env=env, check=True, capture_output=True)
    print('Android SDK: ' + ', '.join(need) + '…')
    subprocess.run(base + need, env=env, check=True, input=b'y\n')


def main():
    TOOLS.mkdir(parents=True, exist_ok=True)
    (TOOLS / 'downloads').mkdir(exist_ok=True)
    setup_jdk()
    setup_sdk('--accept-licenses' in sys.argv)
    print(f'Готово: {TOOLS}. Сборка: python dev/android/build_apk.py')


if __name__ == '__main__':
    main()
