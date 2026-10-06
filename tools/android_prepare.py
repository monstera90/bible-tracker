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
"""
import json
import os
import pathlib
import re
import shutil
import sys

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


def main():
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

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"version={version}\n")
            f.write(f"version_name={version_name}\n")


if __name__ == "__main__":
    main()
