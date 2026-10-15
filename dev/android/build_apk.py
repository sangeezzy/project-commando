"""Сборка .apk для Android: python dev/android/build_apk.py → dist/commando-<версия>.apk

Без Gradle и Android Studio — прямо инструментами SDK (поставить один раз: python dev/android/setup.py --accept-licenses):
  1. dev/build.py → dist/ (index.html + game.js), копия — в assets/game/ приложения;
  2. aapt2 compile/link: ресурсы (иконки, тема) и AndroidManifest.xml → base.apk, R.java;
  3. javac + d8: MainActivity → classes.dex; 4. zipalign + apksigner (ключ — commando.keystore в папке инструментов).
Версия приложения — GAME_VERSION игры (сервер хоста сверяет её при входе), номер сборки — минуты с 2026-01-01.
Ключ подписи хранится вне проекта: потеряли — новую сборку поверх старой не поставить (только удалить и поставить заново).
"""
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'dev'))
from setup import TOOLS, jdk_home        # noqa: E402
import build as web_build                 # noqa: E402

APP = HERE / 'app'
SDK = TOOLS / 'sdk'
BT = SDK / 'build-tools' / '34.0.0'
ANDROID_JAR = SDK / 'platforms' / 'android-34' / 'android.jar'
KEYSTORE = TOOLS / 'commando.keystore'
KS_PASS = 'commando'                     # ключ для установки «из файла», не для магазина
MIN_SDK, TARGET_SDK = 24, 34

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass


def run(cmd, **kw):
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)
    if r.returncode:
        print(r.stdout[-3000:], r.stderr[-3000:])
        sys.exit(f'ошибка: {Path(str(cmd[0])).name}')
    return r


def main():
    jdk = jdk_home()
    if not jdk or not ANDROID_JAR.exists() or not (BT / 'aapt2.exe').exists():
        sys.exit('нет инструментов: python dev/android/setup.py --accept-licenses')
    env = dict(os.environ, JAVA_HOME=str(jdk), PATH=str(jdk / 'bin') + os.pathsep + os.environ.get('PATH', ''))
    version = re.search(r"GAME_VERSION = '([^']+)'", (ROOT / 'game' / 'js' / 'data.js').read_text(encoding='utf-8')).group(1)
    code = int((time.time() - 1767225600) // 60)          # минуты с 2026-01-01: каждая сборка новее прошлой

    web_build.build()                                      # dist/: index.html + game.js
    work = TOOLS / 'build'
    if work.exists():
        shutil.rmtree(work)
    for d in ('assets', 'gen', 'classes', 'dex'):
        (work / d).mkdir(parents=True)
    shutil.copytree(web_build.DIST, work / 'assets' / 'game', ignore=shutil.ignore_patterns('*.apk'))   # прошлые .apk в dist/ — не внутрь

    print('aapt2: ресурсы и манифест…')
    run([BT / 'aapt2.exe', 'compile', '--dir', APP / 'res', '-o', work / 'res.zip'])
    run([BT / 'aapt2.exe', 'link', '-o', work / 'base.apk', '-I', ANDROID_JAR, '--manifest', APP / 'AndroidManifest.xml',
         '-A', work / 'assets', '--java', work / 'gen', '--min-sdk-version', MIN_SDK, '--target-sdk-version', TARGET_SDK,
         '--version-code', code, '--version-name', version, '--auto-add-overlay', work / 'res.zip'])

    print('javac + d8: код приложения…')
    srcs = list((APP / 'src').rglob('*.java')) + list((work / 'gen').rglob('*.java'))
    run([jdk / 'bin' / 'javac.exe', '-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', '-Xlint:-options',
         '-bootclasspath', ANDROID_JAR, '-classpath', BT / 'core-lambda-stubs.jar',      # лямбды: d8 разворачивает их сам
         '-d', work / 'classes'] + srcs, env=env)
    classes = list((work / 'classes').rglob('*.class'))
    run([BT / 'd8.bat', '--release', '--min-api', MIN_SDK, '--lib', ANDROID_JAR, '--output', work / 'dex'] + classes, env=env)
    with zipfile.ZipFile(work / 'base.apk', 'a', zipfile.ZIP_DEFLATED) as z:
        z.write(work / 'dex' / 'classes.dex', 'classes.dex')

    print('zipalign + apksigner…')
    run([BT / 'zipalign.exe', '-f', '-p', '4', work / 'base.apk', work / 'aligned.apk'])
    if not KEYSTORE.exists():
        run([jdk / 'bin' / 'keytool.exe', '-genkeypair', '-keystore', KEYSTORE, '-alias', 'commando', '-keyalg', 'RSA',
             '-keysize', '2048', '-validity', '10000', '-storepass', KS_PASS, '-keypass', KS_PASS,
             '-dname', 'CN=Project Commando'], env=env)
    out = web_build.DIST / f'commando-{version}.apk'
    run([BT / 'apksigner.bat', 'sign', '--ks', KEYSTORE, '--ks-key-alias', 'commando', '--ks-pass', f'pass:{KS_PASS}',
         '--key-pass', f'pass:{KS_PASS}', '--out', out, work / 'aligned.apk'], env=env)
    run([BT / 'apksigner.bat', 'verify', out], env=env)
    print(f'готово: {out.relative_to(ROOT)} ({out.stat().st_size // 1024} КБ), версия {version} ({code})')


if __name__ == '__main__':
    main()
