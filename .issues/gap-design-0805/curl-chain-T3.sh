#!/usr/bin/env bash
# T3 取证：经理侧三个端点 + 员工提交 + 资料库多一行，全走真 HTTP。
# ⚠ 中文一律走 heredoc（stdin 不过代码页转换）；本机 curl 会把 argv 里的中文按 GBK 编。
set -u
API=http://127.0.0.1:8199
TMP="$(dirname "$0")"

cat > "$TMP/roster.md" <<'EOF'
# 望江酒店 · 花名册

人员ID：P-0007｜姓名：周雅｜岗位：传菜领班｜部门：前厅部
人员ID：P-0011｜姓名：陈明远｜岗位：厨师长｜部门：后厨

## 项目：宴会厅翻台提速
负责人：周雅
状态：正常
EOF

echo "── 1) ingest ────────────────────────────────────────────"
ING=$(curl -s -X POST "$API/ingest" -F "files=@$TMP/roster.md;type=text/markdown")
CID=$(printf '%s' "$ING" | /c/Python313/python -c "import sys,json;print(json.load(sys.stdin)['context_id'])")
TOK=$(printf '%s' "$ING" | /c/Python313/python -c "import sys,json;print(json.load(sys.stdin).get('owner_token',''))")
echo "context_id=$CID"
echo "owner_token=${TOK:0:12}…"

echo "── 2) GET /team/{cid}/forms ─────────────────────────────"
curl -s "$API/team/$CID/forms" -H "X-Avery-Token: $TOK" \
  | /c/Python313/python -c "
import sys,json
d=json.load(sys.stdin)
for t in d['templates']:
    print('  template', t['id'], '| active', t['active'], '| title', t['title'])
    for f in t['fields']:
        print('     -', f['id'], f['kind'], f['label'], 'required' if f['required'] else 'optional')
"

echo "── 3) POST .../forms/tpl_weekly/links （铸两条）──────────"
MINT=$(curl -s -X POST "$API/team/$CID/forms/tpl_weekly/links" \
  -H "X-Avery-Token: $TOK" -H "Content-Type: application/json" --data-binary @- <<'EOF'
{"recipients":[{"id":"P-0007","name":"周雅"},{"id":"P-0011","name":"陈明远"}]}
EOF
)
printf '%s' "$MINT" | /c/Python313/python -c "
import sys,json
d=json.load(sys.stdin)
print('  period =', d['period'])
for l in d['links']:
    print('  ', l['person_name'], l['status'], l['link'])
"
SHARE=$(printf '%s' "$MINT" | /c/Python313/python -c "import sys,json;print(json.load(sys.stdin)['links'][0]['token'])")

echo "── 4) GET /team/{cid}/forms/submissions （谁交了）───────"
curl -s "$API/team/$CID/forms/submissions" -H "X-Avery-Token: $TOK" \
  | /c/Python313/python -c "
import sys,json
for s in json.load(sys.stdin)['submissions']:
    print('  ', s['person_name'], '|', s['period'], '|', s['status'], '| submitted_at =', s['submitted_at'])
"

echo "── 5) 员工打开 /f/{token} 并提交 ────────────────────────"
curl -s -o /dev/null -w "  GET /f/{token} → %{http_code}\n" "$API/f/$SHARE"
curl -s -o /dev/null -w "  POST submit    → %{http_code}\n" -X POST "$API/f/$SHARE/submit" \
  -H "Content-Type: application/x-www-form-urlencoded" --data-binary @- <<'EOF'
f_done=%E6%99%9A%E5%B8%82%E5%81%9A%E4%BA%86%20120%20%E6%A1%8C&f_missed=%E4%BC%A0%E8%8F%9C%E7%AD%89%E4%BD%8D%E8%B6%85%208%20%E5%88%86%E9%92%9F%EF%BC%8C%E7%BC%BA%E4%B8%80%E4%B8%AA%E4%BA%BA&f_next_goal=%E6%8A%8A%E7%AD%89%E4%BD%8D%E5%8E%8B%E5%88%B0%205%20%E5%88%86%E9%92%9F&f_support=%E5%86%8D%E8%B0%83%E4%B8%80%E4%B8%AA%E4%BC%A0%E8%8F%9C&f_load=72&f_mood=%E5%81%8F%E7%B4%A7
EOF

echo "── 6) 提交后 submissions 状态 ───────────────────────────"
curl -s "$API/team/$CID/forms/submissions" -H "X-Avery-Token: $TOK" \
  | /c/Python313/python -c "
import sys,json
for s in json.load(sys.stdin)['submissions']:
    print('  ', s['person_name'], '|', s['period'], '|', s['status'], '| submitted_at =', s['submitted_at'])
"

echo "── 7) 资料库是否多了一行（T2 的活，这里只验它对 T3 可见）"
curl -s "$API/team/$CID/files" -H "X-Avery-Token: $TOK" \
  | /c/Python313/python -c "
import sys,json
for f in json.load(sys.stdin)['files']:
    print('  ', f['idx'], f['filename'], '|', f.get('status'), '|', f['n_chunks'], 'chunks')
"
echo
echo "CTX=$CID"
echo "TOK=$TOK"
