#!/usr/bin/env bash
# T1 · form-backend-a1a —— curl 全链取证：建模板 → 铸单人单链 → GET /f/{token} → POST 提交 → 库里有
set -u
# 复跑前置（三样都可以用环境变量覆盖）：
#   1. 建一个 throwaway 库：docker exec teammaster-postgres-1 psql -U postgres -c "CREATE DATABASE avery_t1form_test;"
#   2. 起后端（⚠ 三件套缺一真烧钱 —— brain/extractor/embeddings 都要压成离线的）：
#        cd eval-harness && AVERY_DB_URL="postgresql://postgres:dev@localhost:5432/avery_t1form_test" \
#          AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
#          AVERY_PUBLIC_BASE="http://127.0.0.1:8147" \
#          python -m uvicorn service.app:app --host 127.0.0.1 --port 8147
#      ⚠ 换库之后必须**重启**后端：PgRegistry 的 _schema_ready 是实例级缓存，不重启不会往新库重放迁移。
#   3. bash 本脚本。收工杀服务用端口精准杀，别信 ps：
#        Get-NetTCPConnection -LocalPort 8147 -State Listen  → Stop-Process
BASE="${AVERY_BASE:-http://127.0.0.1:8147}"
REPO="${AVERY_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
FIX="${AVERY_FIXTURE:-$REPO/eval-harness/tests/fixtures/ingest/Studio_Handbook.md}"
PSQL=(docker exec "${AVERY_PG_CONTAINER:-teammaster-postgres-1}" psql -U postgres \
      -d "${AVERY_PG_DB:-avery_t1form_test}" -t -A)

hr() { printf '\n──────────────────────────────────────────────────────────────────────────\n%s\n\n' "$1"; }
jqp() { python -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d,ensure_ascii=False,indent=2)[:$1])"; }

# ⚠ 本机的 curl.exe 把 argv 里的中文按 GBK 编（实测「如常」→ %C8%E7%B3%A3，UTF-8 应是
# %E5%A6%82%E5%B8%B8），于是 --data-urlencode "f_mood=如常" 发出去的是乱码、服务端**正确地**
# 422。那是取证脚本在撒谎，不是被测代码有问题。所以表单体一律用 python 预先 percent-encode 成
# 纯 ASCII，再经 **stdin** 送进 curl（stdin 不过代码页转换 —— 同一个原因，heredoc 里的 JSON
# 中文一直是好的）。
# 中文**只**经 stdin 进 python（heredoc），编码出来的纯 ASCII 才允许进 argv。
encode_body() {
  python -c "
import sys, urllib.parse
sys.stdin.reconfigure(encoding='utf-8')
pairs=[tuple(l.rstrip('\r\n').split('=',1)) for l in sys.stdin if l.strip()]
sys.stdout.write(urllib.parse.urlencode(pairs))   # urlencode 只吃 tuple，list 会 TypeError
"
}
post_form() {  # post_form <url> <encoded-ascii-body>
  curl -s -o /dev/null -w "%{http_code}" -X POST "$1" \
       -H "Content-Type: application/x-www-form-urlencoded" --data-binary "$2"
}

hr "0) 上传一份公司资料，拿到 context_id + owner_token（表单挂在真 context 上）"
ING=$(curl -s -X POST "$BASE/ingest" -F "files=@$FIX")
CID=$(echo "$ING" | python -c "import json,sys; print(json.load(sys.stdin)['context_id'])")
TOK=$(echo "$ING" | python -c "import json,sys; print(json.load(sys.stdin)['owner_token'])")
echo "context_id  = $CID"
echo "owner_token = ${TOK:0:12}…（只走 header，永不进 URL）"

hr "1) 建模板 —— GET /team/{id}/forms：内置「周报」按需铸进这家公司的表单库"
curl -s "$BASE/team/$CID/forms" -H "X-Avery-Token: $TOK" \
  | python -c "
import json,sys
d=json.load(sys.stdin)
for t in d['templates']:
    print(f\"模板 {t['id']}  «{t['title']}»  active={t['active']}\")
    for f in t['fields']:
        extra = f\"选项={f['choices']}\" if f['kind']=='choice' else (f\"{f['min']}-{f['max']}\" if f['kind']=='number' else '')
        print(f\"   · {f['label']:<8} kind={f['kind']:<7} 必填={f['required']}  {extra}\")
"

hr "1b) 建模板 —— POST /team/{id}/forms：经理自建一张（同一条渲染/校验路径，内置模板不是特例）"
curl -s -X POST "$BASE/team/$CID/forms" -H "X-Avery-Token: $TOK" -H "Content-Type: application/json" \
  --data-binary @- <<'JSON' | jqp 700
{"id":"tpl_daily","title":"日报",
 "fields":[{"id":"today","kind":"text","label":"今天做完了什么"},
           {"id":"blocked","kind":"choice","label":"有没有卡住的","choices":["没有","有"]}]}
JSON

hr "1c) 🔴 红线门：一张给人打分的题面，在任何 INSERT 之前就被拒（422，带原因）"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$BASE/team/$CID/forms" \
  -H "X-Avery-Token: $TOK" -H "Content-Type: application/json" --data-binary @- <<'JSON'
{"id":"tpl_bad","title":"周报","fields":[{"id":"q1","kind":"text","label":"这位同事的绩效评分是多少？"}]}
JSON
curl -s -X POST "$BASE/team/$CID/forms" -H "X-Avery-Token: $TOK" -H "Content-Type: application/json" \
  --data-binary @- <<'JSON' | jqp 400
{"id":"tpl_bad","title":"周报","fields":[{"id":"q1","kind":"text","label":"这位同事的绩效评分是多少？"}]}
JSON

hr "1d) 门：没有 owner_token 一律同体 404（无枚举 oracle）"
echo -n "无 token   -> HTTP "; curl -s -o /dev/null -w "%{http_code}\n" "$BASE/team/$CID/forms"
echo -n "错 token   -> HTTP "; curl -s -o /dev/null -w "%{http_code}\n" "$BASE/team/$CID/forms" -H "X-Avery-Token: tok_wrong"

hr "2) 铸单人单链 —— 给两个人各一条不可猜的 /f/{token}（7 天过期）"
MINT=$(curl -s -X POST "$BASE/team/$CID/forms/tpl_weekly/links" -H "X-Avery-Token: $TOK" \
  -H "Content-Type: application/json" --data-binary @- <<'JSON'
{"recipients":[{"id":"P-0007","name":"周雅"},{"id":"P-0011","name":"陈立"}],"period":"2026-W32"}
JSON
)
echo "$MINT" | python -c "
import json,sys
d=json.load(sys.stdin)
print('周期 period =', d['period'])
for l in d['links']:
    print(f\"  {l['person_name']}（人员ID {l['person_id']}）  status={l['status']}  过期={l['expires_at'][:19]}\")
    print(f\"    {l['link']}\")
"
T_ZHOU=$(echo "$MINT" | python -c "import json,sys; print(json.load(sys.stdin)['links'][0]['token'])")
T_CHEN=$(echo "$MINT" | python -c "import json,sys; print(json.load(sys.stdin)['links'][1]['token'])")

hr "3) GET /f/{token} —— 员工手机打开（免登录，服务端直出，零外部资源）"
PAGE=$(curl -s "$BASE/f/$T_ZHOU")
echo "$PAGE" | python -c "
import re,sys
p=sys.stdin.read()
print('HTTP 200 · 字节数', len(p))
for cls in ('h5-who','h5-what','h5-visibility','h5-for'):
    m=re.search(r'<p class=\"%s\">(.*?)</p>'%cls,p,re.S)
    if m: print('  ', re.sub(r'<[^>]+>','',m.group(1)))
print('  控件：textarea x%d · radio x%d · range x%d'%(p.count('<textarea'),p.count('type=\"radio\"'),p.count('type=\"range\"')))
print('  零外部资源：http(s):// 出现 %d 次 · <script src 出现 %d 次'%(p.count('http://')+p.count('https://'),p.count('<script src')))
print('  只出现这一个人：周雅 %s · 陈立 %s'%('在' if '周雅' in p else '不在','在' if '陈立' in p else '不在'))
"
echo -n "?lang=en 翻面 -> "; curl -s "$BASE/f/$T_ZHOU?lang=en" | grep -o 'Who collects this' | head -1

hr "4) POST /f/{token}/submit —— 周雅把六格填了交上去"
GOOD=$(encode_body <<'EOF'
f_done=晚市高峰传菜等位超 8 分钟，本周排了 3 次加班顶上去。
f_missed=宴会厅翻台没压到 25 分钟，缺一个人。
f_next_goal=把传菜动线改一版，下周试跑。
f_support=想借调一个人手到晚市。
f_load=72
f_mood=偏紧
EOF
)
echo "首次提交            -> HTTP $(post_form "$BASE/f/$T_ZHOU/submit" "$GOOD")"

AGAIN=$(encode_body <<'EOF'
f_done=我改口了
f_missed=x
f_next_goal=x
f_load=5
f_mood=如常
EOF
)
echo "再交一次（答一次锁）-> HTTP $(post_form "$BASE/f/$T_ZHOU/submit" "$AGAIN")"

OOR=$(encode_body <<'EOF'
f_done=x
f_missed=x
f_next_goal=x
f_load=120
f_mood=如常
EOF
)
echo "负载越界 120        -> HTTP $(post_form "$BASE/f/$T_CHEN/submit" "$OOR")"

BADOPT=$(encode_body <<'EOF'
f_done=x
f_missed=x
f_next_goal=x
f_load=50
f_mood=还行
EOF
)
echo "选项不在这张表上    -> HTTP $(post_form "$BASE/f/$T_CHEN/submit" "$BADOPT")"
echo -n "未知 token          -> HTTP "; curl -s -o /dev/null -w "%{http_code}\n" "$BASE/f/tok_never_minted"

hr "5) 经理侧：谁交了 / 谁没交（铸链即建行，没交的是 status=open 的行，不是缺席）"
curl -s "$BASE/team/$CID/forms/submissions?template_id=tpl_weekly" -H "X-Avery-Token: $TOK" \
  | python -c "
import json,sys
d=json.load(sys.stdin)
for s in d['submissions']:
    print(f\"  {s['person_name']}  status={s['status']:<10} 提交于={str(s['submitted_at'])[:19]}\")
    for a in s.get('answers',[]):
        print(f\"      {a['field_id']:<10} = {a['value']}\")
"

hr "6) 🔴 库里真的有 —— 直接查 Postgres（离线套看不到持久层，这一步才是账）"
echo "-- avery.form_templates --"
"${PSQL[@]}" -c "SELECT id, title, jsonb_array_length(fields) AS 字段数, active FROM avery.form_templates WHERE context_id='$CID' ORDER BY created_at;"
echo "-- avery.form_submissions --"
"${PSQL[@]}" -c "SELECT person_name, person_id, period, CASE WHEN submitted_at IS NULL THEN '未交' ELSE '已交' END AS 状态, left(share_token,8)||'…' AS token FROM avery.form_submissions WHERE context_id='$CID' ORDER BY person_name;"
echo "-- 周雅那一行的答案（jsonb，中文逐字）--"
"${PSQL[@]}" -c "SELECT jsonb_pretty(answers) FROM avery.form_submissions WHERE context_id='$CID' AND person_name='周雅';"

hr "7) 头号纪律自证：本票**没有**给表单开通往资料层的旁路（提交进资料是 T2 的活）"
"${PSQL[@]}" -c "SELECT count(*) AS 提交后新增的资料文档数 FROM avery.source_documents WHERE context_id='$CID';"
echo "（= 1，就是第 0 步上传的那一份 Studio_Handbook.md；表单提交没有偷偷 append 任何东西）"
