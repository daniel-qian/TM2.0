# -*- coding: utf-8 -*-
"""fixB — 文件真相：编码、上限、类型、状态。maker != checker 的回归批。

本文件守的是一条纪律，不是四个独立的 bug：

    「我没读到」和「客户说没有」是两件事，永远不许混。

一份 GB18030 的花名册（中文 Windows 上 Excel 存 CSV / 记事本存「ANSI」的默认编码，
也就是三家目标客户里两家最可能的上传方式）此前会走完这样一条链：

    utf-8 硬解 → 每个汉字变 U+FFFD → _MOJIBAKE_MAP 把 U+FFFD 抹成空串（连"解码失败过"
    这个唯一证据也一并销毁）→ 剩一串拉丁垃圾 → 抽 0 人 → HTTP 200 →
    界面写「Ingested 1 file(s): 0 people」→ 文件标 ingested

全链路没有任何一处告诉用户文件没读进去。用户只会得出一个结论：Avery 读不懂中文。
更糟的是同一条链让**红线失效**——一份中文绩效评分表乱码之后不再匹配任何评分词，
于是它安然通过了那道专门为它存在的闸。

每个 test 都在修复前跑过一遍确认它会 FAIL（见 progress-fixB.md 的贴出输出）。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from avery.ingest import HeuristicExtractor, validate_extraction
from avery.ingest.parse import ParseError, parse_bytes
from service import upload_guard
from service.app import app

# 🔴 `DecodeError` / `decode_text` / `_looks_multibyte` / `human_bytes` /
# `office_container_reason` 是本轮新增的 API，**刻意在用到它们的 test 内部 import**，
# 不放在模块顶层。理由是这批 test 必须先在旧代码上跑一遍、逐条看它 FAIL：顶层 import
# 会让整个模块在旧代码上 collect ERROR，于是只能看到一句"导入失败"，看不到
# "GBK 花名册抽出 0 人"这种**能证明这条 test 真的抓着那个 bug** 的输出。


@pytest.fixture()
def client():
    return TestClient(app)


# 同一份内容的四种写法。真实客户手里就是这些字节，不是 ASCII 拼音。
ROSTER_SIMPLIFIED = "姓名,职位,团队\n张伟,产品经理,产品组\n李娜,后端工程师,平台组\n王芳,设计师,产品组\n"
ROSTER_TRADITIONAL = "姓名,職位,團隊\n張偉,產品經理,產品組\n李娜,後端工程師,平台組\n"
# 一份**花名册**，被人多贴了一列「绩效评分」—— 中文 HR 系统导出时最常见的形态，也正是
# extract.py 注释里点名过的那种表。红线必须 HARD-FAIL 它（见 test_redline_zh.py）。
# 🔴 文件名必须是花名册类，否则 sniff_kind 判 'unknown'、根本不抽人，红线也就无从谈起
#（那是路由器的另一个洞，不是编码的洞 —— 记在 progress 的 Notes 里，本轮不顺手改）。
SCORING_ROSTER = "姓名,职位,团队,绩效评分\n张伟,产品经理,产品组,2分\n李娜,后端工程师,平台组,9分\n"
# 瑞典建筑公司的 Windows Excel：cp1252 单字节，重音字母嵌在 ASCII 单词内部。
ROSTER_SWEDISH = "Namn,Roll\nBjörn Åkesson,Platschef\nMalmö Söder,Projektledare\n"


# ==============================================================================================
# B1 — GB18030 / Big5 / UTF-16 / cp1252 都必须真的被读进去
# ==============================================================================================

@pytest.mark.parametrize("encoding,expected", [
    ("utf-8", ["张伟", "李娜", "王芳"]),
    ("gbk", ["张伟", "李娜", "王芳"]),          # ← 修复前这里是 []
    ("gb18030", ["张伟", "李娜", "王芳"]),
    ("utf-16", ["张伟", "李娜", "王芳"]),
    ("utf-8-sig", ["张伟", "李娜", "王芳"]),
])
def test_chinese_roster_yields_people_in_every_common_encoding(encoding, expected):
    """同一份花名册，换个编码就抽不出人 —— 那不是"读不懂中文"，那是没解码。"""
    doc = parse_bytes("员工花名册.csv", ROSTER_SIMPLIFIED.encode(encoding))
    names = [p.name for p in HeuristicExtractor().extract(doc).people]
    assert names == expected, f"{encoding} 编码的花名册抽出 {names}，应为 {expected}"


def test_traditional_chinese_roster_is_not_read_as_simplified():
    """Big5 的字节在 gb18030 里往往**也**合法 —— first-match-wins 会把港台花名册读成一串
    错字（而且不报错）。三亚的酒店确实会收到港台文件，所以这不是理论问题。"""
    doc = parse_bytes("員工名冊.csv", ROSTER_TRADITIONAL.encode("big5"))
    assert doc.meta["encoding"] == "big5", f"选错了编码: {doc.meta.get('encoding')}"
    names = [p.name for p in HeuristicExtractor().extract(doc).people]
    assert "張偉" in names, f"繁体花名册读成了 {names}"


def test_swedish_cp1252_roster_is_not_read_as_chinese():
    """反方向的陷阱：'Björn' 的 cp1252 字节（42 6A F6 72 6E）在 gb18030 里**干净地**解出一个
    汉字 —— 不报任何错。瑞典建筑公司的花名册会整份变成乱码。"""
    doc = parse_bytes("personal.csv", ROSTER_SWEDISH.encode("cp1252"))
    assert doc.meta["encoding"] == "cp1252", f"选错了编码: {doc.meta.get('encoding')}"
    assert "Björn Åkesson" in doc.text and "Malmö Söder" in doc.text, repr(doc.text)


def test_gbk_scoring_sheet_still_hits_the_red_line():
    """🔴 本批最危险的一条：乱码不只是"读不到"，它让**红线被绕过**。

    UTF-8 的绩效评分表会被 validate_extraction 硬拦（person-score-text）。同一份表存成 GBK 后，
    评分词不再匹配任何规则 —— 那道专门为它存在的闸直接失效，一份给人打分的表安然入库。"""
    for encoding in ("utf-8", "gbk"):
        doc = parse_bytes("员工花名册.csv", SCORING_ROSTER.encode(encoding))
        result = validate_extraction(HeuristicExtractor().extract(doc))
        assert not result.ok, f"{encoding} 编码的绩效评分表绕过了红线闸"
        assert any(v.kind == "person-score-text" for v in result.violations), \
            f"{encoding}: 命中的违规类型是 {[v.kind for v in result.violations]}"


def test_gbk_roster_over_real_http_ingest(client):
    """端到端：真打 /ingest，不是只测 parse。修复前 HTTP 200 + people: []。"""
    resp = client.post("/ingest", files={
        "files": ("员工花名册.csv", ROSTER_SIMPLIFIED.encode("gbk"), "text/csv")})
    assert resp.status_code == 200, resp.text[:400]
    names = [p["name"] for p in resp.json()["people"]]
    assert set(names) == {"张伟", "李娜", "王芳"}, f"/ingest 抽出的人是 {names}"


def test_gbk_scoring_sheet_is_refused_over_real_http(client):
    """红线绕过的端到端版本：GBK 绩效评分表必须像 UTF-8 版一样被 422 拒收。"""
    resp = client.post("/ingest", files={
        "files": ("员工花名册.csv", SCORING_ROSTER.encode("gbk"), "text/csv")})
    assert resp.status_code == 422, \
        f"给人打分的表以 {resp.status_code} 入库了: {resp.text[:300]}"


# ==============================================================================================
# B1 — 读不出来时必须说出来，不许静默产出一份空壳
# ==============================================================================================

def test_undecodable_bytes_raise_instead_of_becoming_an_empty_document():
    """没有任何候选编码能解的字节。修复前：utf-8 + errors='replace' 永远"成功"，
    产出一份看起来正常、实则空的文档。现在必须抛错，且错误里要说清是编码问题。"""
    from avery.ingest.parse import DecodeError
    junk = bytes([0x80, 0x81, 0x8D, 0x90, 0x9D, 0xFF, 0xFE, 0x81, 0x81, 0x8F])
    with pytest.raises(DecodeError) as excinfo:
        parse_bytes("坏文件.csv", junk)
    message = str(excinfo.value)
    assert "encoding" in message.lower(), f"错误没提编码: {message}"
    assert "UTF-8" in message, f"错误没给出可执行的自救办法: {message}"
    # 老调用方只认 ParseError —— 子类关系保证"标 failed"那条既有链路不用改一行。
    assert isinstance(excinfo.value, ParseError)


def test_undecodable_file_is_reported_as_failed_not_silently_ingested(client):
    """混批：一份能读的 + 一份读不出来的。context 照建，但那份读不出来的必须在清单里
    标成 failed —— 「你的文件」里绝不能有一份没读进去的文件冒充读进去了。"""
    junk = bytes([0x80, 0x81, 0x8D, 0x90, 0x9D, 0xFF, 0xFE, 0x81]) * 4
    resp = client.post("/ingest", files=[
        ("files", ("员工花名册.csv", ROSTER_SIMPLIFIED.encode("gbk"), "text/csv")),
        ("files", ("坏文件.csv", junk, "text/csv")),
    ])
    assert resp.status_code == 200, resp.text[:400]
    body = resp.json()
    token = body["owner_token"]
    manifest = client.get(f"/team/{body['context_id']}/files",
                          headers={"X-Avery-Token": token})
    assert manifest.status_code == 200, manifest.text[:300]
    by_name = {f["filename"]: f["status"] for f in manifest.json()["files"]}
    assert by_name["员工花名册.csv"] == "ingested", by_name
    assert by_name["坏文件.csv"] == "failed", \
        f"读不出来的文件在清单里标成了 {by_name['坏文件.csv']}"


def test_all_undecodable_batch_explains_the_encoding_in_the_422(client):
    """整批都读不出来 → 422。body 里必须带着能自救的那句话，否则用户只看到
    「that file type isn't accepted」，永远不会想到是编码。"""
    junk = bytes([0x80, 0x81, 0x8D, 0x90, 0x9D, 0xFF, 0xFE, 0x81]) * 4
    resp = client.post("/ingest", files={"files": ("坏文件.csv", junk, "text/csv")})
    assert resp.status_code == 422, resp.text[:300]
    blob = resp.text.lower()
    assert "encoding" in blob, f"422 的 body 里没有编码线索: {resp.text[:400]}"


def test_replacement_chars_are_counted_before_they_are_scrubbed():
    """_MOJIBAKE_MAP 把 U+FFFD 抹成空串 —— 它销毁的正是"解码失败过"的证据。
    零星的仍然清掉（facts.md 是可引用语料，feat-023 的诉求不变），但数量要留痕。"""
    doc = parse_bytes("note.txt", "Ofﬁce workﬂow � broken".encode("utf-8"))
    assert "�" not in doc.text, "零星 U+FFFD 应当仍被清出语料"
    assert doc.meta["replacement_chars"] == 1, f"证据没留下: {doc.meta}"


def test_a_document_made_of_replacement_chars_fails_loudly():
    """成篇的 U+FFFD 不是"一个坏字形"，是"根本没解码"。那种文档不许被清成一份空壳。"""
    from avery.ingest.parse import DecodeError
    with pytest.raises(DecodeError):
        parse_bytes("scan.txt", ("�" * 40 + "abc").encode("utf-8"))


def test_detected_encoding_is_recorded_on_the_doc():
    """排查一张支持工单时，"这份花名册是按 gb18030 读的"是第一个要知道的事实。"""
    doc = parse_bytes("员工花名册.csv", ROSTER_SIMPLIFIED.encode("gbk"))
    assert doc.meta["encoding"] == "gb18030", doc.meta


def test_empty_file_is_not_a_decode_failure():
    """空文件是空文件，不是编码错误 —— 别把它也报成读不出来。"""
    from avery.ingest.parse import decode_text
    text, encoding = decode_text(b"")
    assert text == "" and encoding == "utf-8"


@pytest.mark.parametrize("raw,expected", [
    ("张伟 李娜 王芳".encode("gbk"), True),        # 汉字：每个字 >=2 个连续高位字节
    ("Björn Åkesson Malmö".encode("cp1252"), False),   # 西欧：高位字节是孤立的单个
    (b"plain ascii only", False),
])
def test_multibyte_run_signal_separates_the_two_families(raw, expected):
    """区分 CJK 码页和西欧码页的那一个信号，直接读原始字节 —— 所以它不会被一次已经
    走歪的解码骗到。这是 gb18030 和 cp1252 不互相抢文件的全部原因。"""
    from avery.ingest.parse import _looks_multibyte
    assert _looks_multibyte(raw) is expected


# ==============================================================================================
# M2 — 上限只有一个真源，而且说人话
# ==============================================================================================

def test_limit_messages_are_in_units_a_person_can_act_on():
    """前端曾自带一份写死的上限（「10 files, 10MB each」），两个数字都是错的，而且单文件那个
    比真上限还大 —— 用户照着它重试永远失败。真源只有服务端，所以服务端得把话说明白。"""
    assert upload_guard.human_bytes(8 * 1024 * 1024) == "8 MB"
    assert upload_guard.human_bytes(32 * 1024 * 1024) == "32 MB"
    assert upload_guard.human_bytes(1536) == "1.5 KB"


def test_oversize_file_413_states_the_real_limit_in_human_units(client, monkeypatch):
    monkeypatch.setenv("AVERY_MAX_UPLOAD_BYTES", str(2 * 1024 * 1024))
    resp = client.post("/ingest", files={
        "files": ("big.txt", b"x" * (3 * 1024 * 1024), "text/plain")})
    assert resp.status_code == 413, resp.text[:200]
    detail = str(resp.json())
    assert "2 MB" in detail, f"413 没说人能看懂的上限: {detail}"
    assert "2097152" not in detail, f"413 还在说字节数: {detail}"


def test_too_many_files_413_states_the_real_count(client, monkeypatch):
    monkeypatch.setenv("AVERY_MAX_FILES", "3")
    files = [("files", (f"f{i}.txt", b"a line of content here\n", "text/plain"))
             for i in range(4)]
    resp = client.post("/ingest", files=files)
    assert resp.status_code == 413, resp.text[:200]
    detail = str(resp.json())
    assert "the limit is 3" in detail, f"413 没说清真实的文件数上限: {detail}"


# ==============================================================================================
# m6 — 加密的 xlsx 是合法文件，不是伪装
# ==============================================================================================

def _fake_encrypted_xlsx() -> bytes:
    """一个最小的 OLE2/CFB 容器，带 ECMA-376 加密 OOXML 必有的那两个流名
    （CFB 目录里以 UTF-16LE 存）。检测器认的就是这两个名字，所以这份构造件走的是真实分支。"""
    header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 504
    return header + "EncryptionInfo".encode("utf-16-le") + b"\x00" * 32 + \
        "EncryptedPackage".encode("utf-16-le") + b"\x00" * 256


def test_password_protected_xlsx_is_not_called_a_forgery():
    """回 magic-byte mismatch 等于当面说用户改了扩展名骗人。带密码的 xlsx 是**合法文件**
    （Excel 的"用密码加密"产出的是 OLE2 容器，不是 zip），财务/HR 表格天天这么发。"""
    reason = upload_guard.office_container_reason("2026预算.xlsx", _fake_encrypted_xlsx())
    assert reason is not None, "加密 xlsx 没有被识别出来"
    assert "password" in reason.lower(), reason
    assert "magic" not in reason.lower() and "mismatch" not in reason.lower(), \
        f"仍然在指控用户伪装文件: {reason}"


def test_legacy_xls_renamed_gets_a_fix_not_an_accusation():
    """另一类 OLE2：真的旧格式 .xls 被改名成 .xlsx。仍然不该收，但该说的是"另存为新格式"。"""
    reason = upload_guard.office_container_reason(
        "旧报表.xlsx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 600)
    assert reason is not None
    assert ".xls" in reason and "Save As" in reason, reason
    assert "mismatch" not in reason.lower(), f"仍然在指控用户伪装文件: {reason}"


def test_encrypted_xlsx_over_http_says_password(client):
    resp = client.post("/ingest", files={
        "files": ("2026预算.xlsx", _fake_encrypted_xlsx(),
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert resp.status_code == 415, resp.text[:300]
    assert "password" in resp.text.lower(), resp.text[:300]


def test_a_real_zip_xlsx_still_passes_the_container_check():
    """m6 的护栏不能把正常的 xlsx（真 zip）也拦下来 —— 它只管 OLE2 那一支。"""
    assert upload_guard.office_container_reason("ok.xlsx", b"PK\x03\x04" + b"\x00" * 64) is None
    # 也不该越界去管文本类型。
    assert upload_guard.office_container_reason("roster.csv", b"\xd0\xcf\x11\xe0") is None
