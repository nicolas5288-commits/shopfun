#!/usr/bin/env python3
"""把 data/seed_{jp,kr,th}.json 匯入 Supabase products 表（source=seed, status=ranked）。
用法（在 /Users/mocha/購物趣網站 目錄下）：
    SUPABASE_SECRET=sb_secret_你的密鑰 python3 scripts/import_seed.py
secret key 從環境變數讀，不寫進檔案、不會進 git。"""
import json, os, sys, urllib.request

PROJECT_URL = "https://nplneyuyosrtozkfcadi.supabase.co"
SECRET = os.environ.get("SUPABASE_SECRET")
if not SECRET:
    sys.exit("請用 SUPABASE_SECRET=sb_secret_... python3 scripts/import_seed.py 執行")

records = []
for c in ("jp", "kr", "th"):
    with open(f"data/seed_{c}.json", encoding="utf-8") as f:
        for p in json.load(f):
            p.pop("id", None)           # 用資料庫的 uuid，不用種子的 jp-01
            p["source"] = "seed"
            p["status"] = "ranked"
            records.append(p)

body = json.dumps(records).encode("utf-8")
req = urllib.request.Request(
    f"{PROJECT_URL}/rest/v1/products",
    data=body, method="POST",
    headers={
        "apikey": SECRET,
        "Authorization": f"Bearer {SECRET}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    },
)
try:
    with urllib.request.urlopen(req) as r:
        print(f"✅ 匯入成功，共 {len(records)} 筆（HTTP {r.status}）")
except urllib.error.HTTPError as e:
    print("❌ 失敗：", e.code, e.read().decode("utf-8"))
