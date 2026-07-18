#!/usr/bin/env python3
"""把 data/seed2_{jp,kr,th}.json 匯入 Supabase products（第二批，含 region_note）。
會先撈現有商品名，同國同名自動 skip 防重複。
用法（在 /Users/mocha/購物趣網站 目錄下）：
    SUPABASE_SECRET=sb_secret_你的密鑰 python3 scripts/import_seed2.py
secret key 從環境變數讀，不寫進檔案、不進 git。"""
import json, os, sys, urllib.request, urllib.parse

PROJECT_URL = "https://nplneyuyosrtozkfcadi.supabase.co"
SECRET = os.environ.get("SUPABASE_SECRET")
if not SECRET:
    sys.exit("請用 SUPABASE_SECRET=sb_secret_... python3 scripts/import_seed2.py 執行")

H = {"apikey": SECRET, "Authorization": f"Bearer {SECRET}", "Content-Type": "application/json"}

# 1) 撈現有商品名，建 (country, name) 排除集
req = urllib.request.Request(f"{PROJECT_URL}/rest/v1/products?select=country,name_zh", headers=H)
with urllib.request.urlopen(req) as r:
    existing = {(p["country"], p["name_zh"].strip()) for p in json.load(r)}
print(f"現有商品 {len(existing)} 樣，開始比對…")

# 2) 讀第二批、過濾重複
records, skipped = [], []
for c in ("jp", "kr", "th"):
    path = f"data/seed2_{c}.json"
    if not os.path.exists(path):
        print(f"⚠️ 找不到 {path}，略過")
        continue
    with open(path, encoding="utf-8") as f:
        for p in json.load(f):
            p.pop("id", None)
            key = (p["country"], p["name_zh"].strip())
            if key in existing:
                skipped.append(p["name_zh"]); continue
            existing.add(key)  # 防同批內重複
            p["source"] = "seed"
            p["status"] = "ranked"
            records.append(p)

if skipped:
    print(f"⏭️  跳過 {len(skipped)} 樣重複：{'、'.join(skipped)}")
if not records:
    sys.exit("沒有要匯入的新商品。")

# 3) 匯入
body = json.dumps(records).encode("utf-8")
req = urllib.request.Request(f"{PROJECT_URL}/rest/v1/products", data=body, method="POST",
                             headers={**H, "Prefer": "return=minimal"})
try:
    with urllib.request.urlopen(req) as r:
        print(f"✅ 匯入成功，新增 {len(records)} 樣（HTTP {r.status}）")
except urllib.error.HTTPError as e:
    print("❌ 失敗：", e.code, e.read().decode("utf-8"))
