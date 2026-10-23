"""
LxMusic 插件一键构建脚本
- 重算 entryHash (main.js SHA256) 和 zipHash (canonical zip hash)
- 更新 plugin.json (保留 LF 换行)
- 按 Songloft 规范打包 lx-music-plugin.jsplugin.zip
  - 顺序: main.js, plugin.json, static/ (dir), static/index.html, icon.svg
  - 文件 DEFLATE, 目录 STORED
  - 文件 external_attr=0, 目录 external_attr=0x10
  - version_made_by=0x0014, version_needed=0x000a, flag_bits=0
"""
import zipfile, os, struct, hashlib, json, sys

# Repo 根目录（脚本所在目录）
REPO = os.path.dirname(os.path.abspath(__file__))
ZIP_PATH = os.path.join(REPO, 'lx-music-plugin.jsplugin.zip')

# ---------- 1. 计算 hash ----------
def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

with open(os.path.join(REPO, 'main.js'), 'rb') as f:
    entry_hash = sha256_hex(f.read())

# Canonical zip hash: 排除 plugin.json, 按 path Unicode 升序, 每行 "path\nhex\n", 最后整体 sha256
files = []
for root, dirs, fs in os.walk(REPO):
    # 跳过 .git 和脚本自身
    if '.git' in root.split(os.sep): continue
    for fn in fs:
        # 只把插件运行所需文件算进 zipHash（与打包进 ZIP 的文件保持一致）
        if fn == 'plugin.json': continue
        rel_dir = os.path.relpath(root, REPO).replace('\\', '/')
        rel = os.path.join(rel_dir, fn).replace('\\', '/') if rel_dir != '.' else fn
        # 白名单：main.js, icon.svg, static/index.html
        if rel not in ('main.js', 'icon.svg', 'static/index.html'): continue
        full = os.path.join(root, fn)
        files.append(rel)
files.sort()

parts = []
for rel in files:
    full = os.path.join(REPO, rel.replace('/', os.sep))
    with open(full, 'rb') as f:
        h = sha256_hex(f.read())
    parts.append(f"{rel}\n{h}\n")
zip_hash = sha256_hex(''.join(parts).encode('utf-8'))

print(f"entryHash: {entry_hash}")
print(f"zipHash:   {zip_hash}")
print(f"Files in zip:")
for f in files: print(f"  {f}")

# ---------- 2. 更新 plugin.json (保留 LF) ----------
pj_path = os.path.join(REPO, 'plugin.json')
with open(pj_path, 'r', encoding='utf-8') as f:
    pj = json.load(f)
pj['entryHash'] = entry_hash
pj['zipHash'] = zip_hash
with open(pj_path, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(pj, f, indent=2, ensure_ascii=False)
    f.write('\n')
print(f"plugin.json updated")

# ---------- 3. 构建 ZIP ----------
if os.path.exists(ZIP_PATH):
    os.remove(ZIP_PATH)

entries = [
    ("main.js", "main.js", False),
    ("plugin.json", "plugin.json", False),
    (None, "static/", True),
    (os.path.join("static", "index.html"), "static/index.html", False),
    ("icon.svg", "icon.svg", False),
]

with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for local_path, arcname, is_dir in entries:
        if is_dir:
            info = zipfile.ZipInfo(arcname, date_time=(2026, 10, 23, 0, 0, 0))
            info.create_system = 0; info.create_version = 20; info.extract_version = 10
            info.flag_bits = 0; info.external_attr = 0x10; info.compress_type = zipfile.ZIP_STORED
            zf.writestr(info, b'')
        else:
            full = os.path.join(REPO, local_path)
            with open(full, 'rb') as f: data = f.read()
            info = zipfile.ZipInfo(arcname, date_time=(2026, 10, 23, 0, 0, 0))
            info.create_system = 0; info.create_version = 20; info.extract_version = 10
            info.flag_bits = 0; info.external_attr = 0; info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

# 后处理: 清零 external_attr / 修正 version 字段
with open(ZIP_PATH, 'rb') as f: data = bytearray(f.read())
i = 0
while i < len(data) - 4:
    sig = struct.unpack('<I', data[i:i+4])[0]
    if sig == 0x02014b50:  # Central dir
        name_len = struct.unpack('<H', data[i+28:i+30])[0]
        name = bytes(data[i+46:i+46+name_len]).decode('utf-8', errors='replace')
        if not name.endswith('/'): data[i+38:i+42] = b'\x00\x00\x00\x00'
        data[i+4:i+6] = struct.pack('<H', 20); data[i+6:i+8] = struct.pack('<H', 10)
        i += 46 + name_len
    elif sig == 0x04034b50:  # Local header
        data[i+4:i+6] = struct.pack('<H', 10); data[i+6:i+8] = b'\x00\x00'
        name_len = struct.unpack('<H', data[i+26:i+28])[0]
        extra_len = struct.unpack('<H', data[i+28:i+30])[0]
        comp_size = struct.unpack('<I', data[i+18:i+22])[0]
        i += 30 + name_len + extra_len + comp_size
    else: i += 1
with open(ZIP_PATH, 'wb') as f: f.write(data)

# 校验
with zipfile.ZipFile(ZIP_PATH, 'r') as zf:
    for info in zf.infolist(): zf.read(info.filename)
print(f"\nOK -> {ZIP_PATH} ({os.path.getsize(ZIP_PATH)} bytes)")
