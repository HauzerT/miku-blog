"""一次性检查：所有生成页面里的站内链接与资源是否都存在。"""
import os
import re
from urllib.parse import unquote

# 相对脚本定位仓库根目录：项目挪过位置，写死绝对路径会悄悄扫到 0 个页面
# （而且"0 个页面 / 全部存在"看起来还像通过了）。
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATTR = re.compile(r'(?:href|src)="([^"]+)"')

pages, missing, checked = [], [], 0
for base, _dirs, files in os.walk(ROOT):
    if ".git" in base:
        continue
    for f in files:
        if f.endswith(".html"):
            pages.append(os.path.join(base, f))

for page in pages:
    with open(page, encoding="utf-8") as fh:
        html = fh.read()
    for href in ATTR.findall(html):
        if href.startswith(("http", "mailto:", "#", "data:")):
            continue
        target = href.split("#")[0]
        if not target:
            continue
        checked += 1
        path = os.path.normpath(os.path.join(os.path.dirname(page), unquote(target)))
        if not os.path.exists(path):
            missing.append((os.path.relpath(page, ROOT), href))

print(f"页面 {len(pages)} 个，站内链接/资源 {checked} 条")
if missing:
    print("缺失：")
    for page, href in missing:
        print(f"  {page}  ->  {href}")
else:
    print("全部存在 ✓")
