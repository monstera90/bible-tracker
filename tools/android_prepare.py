#!/usr/bin/env python3
"""Подготовка Android-сборки: собирает веб-часть в android/app/src/main/assets/www/ и иконку.

Запускается из workflow и вручную: python3 tools/android_prepare.py
Что делает:
  1. Копирует файлы из белого списка tools/www-files.txt в assets/www/ (без versions/, *_test.js, sw.js).
  2. Проверяет, что в index.html нет внешних (CDN) скриптов и стилей и что всё подключённое лежит в списке,
     а также что все файлы из ASSETS в sw.js есть в списке. Иначе останавливается с понятным сообщением.
  3. Читает APP_VERSION из sw.js и пишет assets/www/version.json.
  4. Копирует icon-512x512.png в ресурсы иконки приложения.
  5. Если задан GITHUB_OUTPUT, пишет version (v0.38.39) и version_name (0.38.39).
  6. С ключом --zip-dir DIR дополнительно собирает веб-бандл для live-update: DIR/web-<версия>.zip
     (в корне index.html, тот же белый список и version.json), проверяет его и пишет zip_name, zip_path,
     zip_sha256. Используется workflow web-release.yml. Zip детерминированный: одинаковое содержимое
     даёт одинаковый sha256.
"""
import json
import os
import pathlib
import re
import hashlib
import shutil
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WWW = ROOT / "android" / "app" / "src" / "main" / "assets" / "www"
ICON_SRC = ROOT / "icon-512x512.png"
ICON_DST = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable-nodpi" / "ic_launcher_src.png"


def read_whitelist():
    files = []
    for raw in (ROOT / "tools" / "www-files.txt").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            files.append(line)
    return files


def normalize(url):
    url = url.split("?")[0].split("#")[0]
    while url.startswith("./"):
        url = url[2:]
    return url


def make_zip(dst_dir, version):
    """Собирает DIR/web-<версия>.zip из assets/www/ (детерминированно) и проверяет результат."""
    dst_dir = pathlib.Path(dst_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"web-{version}.zip"
    if dst.exists():
        dst.unlink()
    files = sorted(p for p in WWW.rglob("*") if p.is_file())
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            info = zipfile.ZipInfo(f.relative_to(WWW).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            z.writestr(info, f.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(dst) as z:
        names = set(z.namelist())
        if z.testzip() is not None:
            print("ОШИБКА: собранный zip повреждён", file=sys.stderr)
            sys.exit(1)
        for need in ("index.html", "my.js", "version.json"):
            if need not in names:
                print(f"ОШИБКА: в zip нет {need} в корне", file=sys.stderr)
                sys.exit(1)
        if json.loads(z.read("version.json").decode("utf-8")).get("version") != version:
            print("ОШИБКА: version.json внутри zip не совпадает с версией", file=sys.stderr)
            sys.exit(1)
    sha = hashlib.sha256(dst.read_bytes()).hexdigest()
    print(f"Zip: {dst} ({dst.stat().st_size / 1024:.0f} КБ, sha256 {sha})")
    return dst, sha


def main():
    zip_dir = None
    if "--zip-dir" in sys.argv:
        i = sys.argv.index("--zip-dir")
        if i + 1 >= len(sys.argv):
            print("--zip-dir требует папку", file=sys.stderr)
            sys.exit(2)
        zip_dir = sys.argv[i + 1]
    errors = []
    listed = read_whitelist()
    listed_set = set(listed)

    # 1. Файлы из списка существуют.
    for rel in listed:
        if not (ROOT / rel).is_file():
            errors.append(f"в tools/www-files.txt указан файл, которого нет в репозитории: {rel}")

    # 2a. index.html: внешние ссылки и файлы вне списка.
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    for m in re.finditer(r'<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]+)"', html):
        url = m.group(1)
        if re.match(r"^(?:https?:)?//", url):
            errors.append(f"index.html подключает внешний ресурс {url}: в APK нужна локальная копия (папка vendor/)")
            continue
        if url.startswith(("data:", "blob:", "#")):
            continue
        if normalize(url) not in listed_set:
            errors.append(f"index.html подключает {url}, а в tools/www-files.txt его нет")

    # 2b. sw.js: ASSETS.
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    block = re.search(r"const\s+ASSETS\s*=\s*\[(.*?)\];", sw, flags=re.S)
    if not block:
        errors.append("в sw.js не найден список ASSETS")
    else:
        for item in re.findall(r'"([^"]+)"', block.group(1)):
            if item in ("./", "./sw.js"):
                continue
            if normalize(item) not in listed_set:
                errors.append(f"в sw.js ASSETS есть {item}, а в tools/www-files.txt его нет")

    # 3. Версия.
    ver = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', sw)
    if not ver:
        errors.append("в sw.js не найден APP_VERSION")
    elif not re.fullmatch(r"v?[0-9]+(\.[0-9]+){1,3}", ver.group(1)):
        errors.append(f"APP_VERSION \"{ver.group(1)}\" не подходит для live-update: нужен вид v0.38.41 (цифры через точки)")

    if errors:
        print("ОШИБКИ подготовки Android-сборки:", file=sys.stderr)
        for e in errors:
            print(" - " + e, file=sys.stderr)
        sys.exit(1)

    version = "v" + ver.group(1).lstrip("vV")
    version_name = version[1:]

    # Копирование.
    if WWW.exists():
        shutil.rmtree(WWW)
    total = 0
    for rel in listed:
        dst = WWW / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dst)
        total += dst.stat().st_size
    (WWW / "version.json").write_text(json.dumps({"version": version}, ensure_ascii=False) + "\n", encoding="utf-8")

    # Иконка.
    ICON_DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ICON_SRC, ICON_DST)

    print(f"Готово: {len(listed)} файлов, {total / 1024:.0f} КБ, версия веб-части {version}")

    zip_info = None
    if zip_dir:
        zip_info = make_zip(zip_dir, version)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"version={version}\n")
            f.write(f"version_name={version_name}\n")
            if zip_info:
                f.write(f"zip_name={zip_info[0].name}\n")
                f.write(f"zip_path={zip_info[0]}\n")
                f.write(f"zip_sha256={zip_info[1]}\n")


if __name__ == "__main__":
    main()
