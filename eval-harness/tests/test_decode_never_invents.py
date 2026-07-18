# -*- coding: utf-8 -*-
"""fixB 收口 — 编码裁决器不许**编造**内容。

上一轮修 B1 时，我把 gb18030 放进了候选梯子，用来救「中文 Windows 上 Excel 存的 CSV」。
救对了，同时开了一个更坏的口子：

    gb18030 的双字节空间 ~99.8% 有定义，它几乎接受任意字节对，而且结果落在常用汉字区。
    于是一份日文（Shift_JIS）花名册被它干净地解成三行**日文里没有的中文**：

        '社員名簿.csv' → '巵柤,晹彁,栶怑 / 揷拞懢榊,塩嬈晹,晹挿'

    implausibility 0.000（没有 PUA、没有部首、没有彝文，一个信号都不响），
    HTTP 200、headline「Ingested 1 file(s)」、/files 里 status=ingested n_chunks=3。
    韩文（EUC-KR）同理。Shift_JIS / EUC-KR 当时根本不在梯子上，连当候选的机会都没有。

修复前是「什么都没读到」，修复后变成「三段查无此据的中文被标成已读取、可被 advisor
当客户原话引用」——后者严重得多，而且正是这一轮纪律要禁的那件事：

    「我没读到」和「客户说没有」是两件事，永远不许混。
    读不到就诚实说读不到，不要替客户编一个默认值。

三亚酒店收到日韩供应商/客人材料、瑞典事务所收到亚洲分包商材料，都是现实场景。

每个 test 都在旧代码（commit 6f838f3）上跑过一遍确认它会 FAIL，输出贴在 progress-fixB.md。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from avery.ingest.parse import DecodeError, decode_text, parse_bytes
from service.app import app


@pytest.fixture()
def client():
    return TestClient(app)

# 同一份「花名册」的四种语言/码页。真实客户手里就是这些字节。
JP_ROSTER = "氏名,部署,役職\n田中太郎,営業部,部長\n鈴木花子,開発部,課長\n佐藤健,総務部,主任\n"
JP_PROSE = "本日の会議はキャンセルになりました。来週の進捗報告は金曜日までに提出してください。\n"
KR_ROSTER = "이름,직위,부서\n김철수,과장,영업부\n박영희,대리,개발부\n이민호,사원,총무부\n"
KR_PROSE = "이번 주 회의는 취소되었습니다. 다음 주까지 진행 상황 보고서를 제출해 주세요.\n"
CN_ROSTER = "姓名,职位,团队\n张伟,产品经理,产品组\n李娜,设计师,设计组\n王芳,工程师,研发组\n"
CN_SCORES = "姓名,绩效评分,排名,主管评语\n张伟,92,1,表现优异\n李娜,78,2,稳定\n王芳,65,3,需改进\n"
TW_ROSTER = "姓名,職位,團隊\n張偉,產品經理,產品組\n李娜,設計師,設計組\n"
TW_PROSE = "本專案的進度報告：施工圖已完成，預計下月開始驗收作業。目前無重大風險。\n"
SV_PROSE = "Projektet i Malmö går enligt plan. Björn ansvarar för fasaden och Åsa för taket.\n"
DE_PROSE = "Grüße aus München; die Straße ist gesperrt, Änderungen folgen. Größe und Maße stimmen.\n"


# ==============================================================================================
# 每一种码页的文件都必须解回它自己，一个字不差
# ==============================================================================================

@pytest.mark.parametrize("label,encoding,text", [
    # 🔴 这四条是本次回归的核心：旧代码把它们解成 gb18030 的编造中文（前两条）/
    #    cp1252 的拉丁垃圾（TW roster），且全部 HTTP 200 标 ingested。
    ("日文花名册 Shift_JIS", "shift_jis", JP_ROSTER),
    ("日文正文 Shift_JIS", "shift_jis", JP_PROSE),
    ("韩文花名册 EUC-KR", "euc-kr", KR_ROSTER),
    ("韩文正文 EUC-KR", "euc-kr", KR_PROSE),
    # 港台 Big5：_looks_multibyte 只看「高位字节连不连成串」时，Big5 的**低位尾字节**
    # （姓 = A9 6D，名 = A6 57）让它整份文件看起来像西欧单字节，于是走 cp1252 解成
    # '©m¦W,Â¾¦ì,¹Î¶¤'。梯子上写着的 Traditional 支持从来没真的被走到过。
    ("繁体花名册 Big5", "big5", TW_ROSTER),
    ("繁体正文 Big5", "big5", TW_PROSE),
    # 这几条是「修日韩不许弄坏中文/西欧」的护栏，必须和上面同批跑。
    ("简体花名册 GB18030", "gb18030", CN_ROSTER),
    ("简体评分表 GB18030", "gb18030", CN_SCORES),
    ("瑞典文 cp1252", "cp1252", SV_PROSE),
    ("德文 cp1252", "cp1252", DE_PROSE),
    ("简体 UTF-8", "utf-8", CN_ROSTER),
    ("日文 UTF-8", "utf-8", JP_ROSTER),
    ("韩文 UTF-8", "utf-8", KR_ROSTER),
])
def test_every_code_page_round_trips_to_its_own_text(label, encoding, text):
    """解出来的必须**就是原文**。断言相等而不是断言"没报错"：一个编造的答案同样不报错，
    上一轮就是这么过的门。"""
    got, used, _penalty = decode_text(text.encode(encoding), label)
    assert got == text, f"{label}: 解成了别的语言 -> {got[:48]!r} (用 {used})"


@pytest.mark.parametrize("encoding,text,forbidden", [
    # 具体到字：这些是旧代码真的产出过的字符串前缀，一个都不许再出现。
    ("shift_jis", JP_ROSTER, "巵柤"),      # 日文被 gb18030 解成的「中文」
    ("euc-kr", KR_ROSTER, "捞抚"),         # 韩文被 gb18030 解成的「中文」
    ("big5", TW_ROSTER, "©m¦W"),           # 繁体被 cp1252 解成的拉丁垃圾
])
def test_the_exact_fabricated_strings_never_come_back(encoding, text, forbidden):
    """回归钉子：不只是"结果对"，而是"旧代码那个具体的错误答案"必须消失。"""
    got, _used, _penalty = decode_text(text.encode(encoding), "x.csv")
    assert forbidden not in got


# ==============================================================================================
# 读不出来的，必须**报成读不出来**，不许降级成"能看的字"
# ==============================================================================================

@pytest.mark.parametrize("label,raw", [
    # 审查者点名的小号例子：cp1252 里 0x81 无定义，旧代码于是掉进 CJK 梯子，
    # 把 81 65 解成「乪」，回给用户 'caf乪' —— 一个凭空长出来的汉字焊在英文单词上。
    ("拉丁文里的坏字节", b"caf\x81e"),
    # 任何码页都读不通的字节：早就该失败，这里钉住它不因为新增候选而"读通"了。
    ("随机二进制", bytes([0x81, 0x7F, 0x92, 0x2B, 0xFE, 0x66, 0x8F, 0x3D, 0xA0, 0x41] * 4)),
    # 我们不支持的单字节码页。诚实的答案是"没读进去"，不是一屏拉丁重音垃圾。
    ("西里尔 cp1251", "Привет команда, отчёт готов сегодня вечером".encode("cp1251")),
    ("希腊 cp1253", "Καλημέρα ομάδα, η αναφορά είναι έτοιμη".encode("cp1253")),
])
def test_unreadable_bytes_raise_instead_of_being_dressed_up(label, raw):
    with pytest.raises(DecodeError):
        decode_text(raw, label)


def test_refusal_says_it_did_not_read_the_file_rather_than_blaming_the_customer():
    """错误文案本身也归这条纪律管：不许写成"这份文件是空的/有问题"，要写成"我没读进去"。"""
    with pytest.raises(DecodeError) as excinfo:
        decode_text(b"caf\x81e", "报价单.csv")
    message = str(excinfo.value)
    assert "报价单.csv" in message
    assert "UTF-8" in message                    # 给一条用户自己能走的路
    assert "has NOT been read" in message or "could not read" in message


def test_a_file_we_cannot_decode_is_a_failed_file_not_an_empty_one():
    """DecodeError 是 ParseError 的子类，上游据此把文件标 failed。这条钉的是那个继承关系：
    一旦有人把它改成"返回空字符串"，界面就会重新开始说「Ingested 1 file(s): 0 people」。"""
    from avery.ingest.parse import ParseError
    assert issubclass(DecodeError, ParseError)
    with pytest.raises(ParseError):
        parse_bytes("坏文件.csv", b"caf\x81e")


# ==============================================================================================
# 走完整条 parse_bytes：日韩文件的正文必须是它自己，meta 必须自报可信度
# ==============================================================================================

@pytest.mark.parametrize("name,encoding,text,expected_encoding,must_contain", [
    ("社員名簿.csv", "shift_jis", JP_ROSTER, "shift_jis", "田中太郎"),
    ("직원명부.csv", "euc-kr", KR_ROSTER, "euc_kr", "김철수"),
    ("員工花名冊.csv", "big5", TW_ROSTER, "big5", "張偉"),
    ("员工花名册.csv", "gb18030", CN_ROSTER, "gb18030", "张伟"),
])
def test_parse_bytes_keeps_the_customers_own_words(name, encoding, text, expected_encoding, must_contain):
    doc = parse_bytes(name, text.encode(encoding))
    assert must_contain in doc.text, doc.text[:60]
    assert doc.meta["encoding"] == expected_encoding, doc.meta


@pytest.mark.parametrize("name,encoding,text,fabricated", [
    ("社員名簿.csv", "shift_jis", JP_ROSTER, "巵柤"),
    ("직원명부.csv", "euc-kr", KR_ROSTER, "捞抚"),
])
def test_real_http_ingest_never_stores_words_the_file_does_not_contain(
        client, name, encoding, text, fabricated):
    """端到端，真打 /ingest。旧代码在这里回 HTTP 200、headline「Ingested 1 file(s)」、
    /files 里 status=ingested n_chunks=3 —— 而入库的三段中文，这份日文/韩文档案里
    一个字都没有。全链路没有一处存疑信号，advisor 之后可以把它们当客户原话引用。

    这个 test 不接受"没报错"作为通过条件：它去语料里翻客户自己写的那一行。"""
    from service.ingest_api import active_registry

    resp = client.post("/ingest", files={"files": (name, text.encode(encoding), "text/csv")})
    assert resp.status_code == 200, resp.text[:300]
    body = resp.json()

    # 清单侧：文件标成读进去了、还报了 3 个 chunk。旧代码在这里和新代码**一模一样** ——
    # 这正是这条 finding 的要害，所以断言不能停在这里。
    manifest = client.get(f"/team/{body['context_id']}/files",
                          headers={"X-Avery-Token": body["owner_token"]})
    assert manifest.status_code == 200, manifest.text[:300]
    entry = manifest.json()["files"][0]

    # 🔴 断言落在 **advisor 真正会引用的那份语料** 上（MaterialChunk.text），不能只看
    # /ingest 的响应体：响应里只有 people / projects / briefing，而日韩花名册两种读法都抽
    # 不出人，编造出来的三行中文一个字都不会在响应里露面 —— 只看响应的 test 在旧代码上
    # 照样绿，等于没测。
    chunks = active_registry().get(body["context_id"]).extraction.materials
    corpus = "\n".join(chunk.text for chunk in chunks)
    assert fabricated not in corpus, f"编造出来的中文进了可引用语料: {corpus[:200]!r}"
    if entry["status"] == "ingested":
        # 标了 ingested，语料里就必须真有客户写下的字。
        assert text.splitlines()[0].split(",")[0] in corpus, corpus[:200]


def test_meta_ships_confidence_next_to_the_encoding_claim():
    """`{'bytes': 72, 'encoding': 'gb18030'}` 是旧 meta 的全部内容 —— 它在那份被编造出来的
    日文花名册上看起来和真货一模一样，读它的人无从分辨。编码是个**判断**，判断要带可信度。"""
    doc = parse_bytes("员工花名册.csv", CN_ROSTER.encode("gb18030"))
    assert doc.meta["decode_confidence"] == "high"
    assert doc.meta["decode_penalty"] == 0.0


# ==============================================================================================
# 裁决器内部：每个信号单独钉住，改坏了要能指出是哪一个
# ==============================================================================================

def test_correct_japanese_is_not_penalised_for_containing_kana():
    """旧的 debris 区间是 0x2E80–0x4E00，它把假名（U+3040–U+30FF）和中日标点
    （U+3000–U+303F）一并算作"解码跑歪的残渣"。后果是同一份日文正文：
    正确的 shift_jis 读法得分 0.800，编造中文的 gb18030 读法得分 0.000 —— 裁决器
    在**惩罚正确答案**。"""
    from avery.ingest.parse import _implausibility
    assert _implausibility("本日の会議はキャンセルになりました。") == 0.0
    assert _implausibility("預計下月開始驗收作業。目前無重大風險。") == 0.0
    # 真正的残渣还得照罚（部首/康熙部首区 + 私用区）。
    assert _implausibility("⺀⺁⻯") > 0.0
    assert _implausibility("") > 0.0


def test_big5_bytes_are_recognised_as_multibyte_despite_ascii_trail_bytes():
    """Big5 / Shift_JIS 的尾字节可以落在 ASCII 区（姓 = A9 6D），所以「高位字节连不连成串」
    这一个信号会把整份繁体文件判成西欧单字节。密度信号补的就是这个盲点。"""
    from avery.ingest.parse import _looks_multibyte
    assert _looks_multibyte(TW_ROSTER.encode("big5")) is True
    assert _looks_multibyte(JP_ROSTER.encode("shift_jis")) is True
    # 补进来的密度信号不许反过来把西欧文件判成 CJK。
    assert _looks_multibyte(SV_PROSE.encode("cp1252")) is False
    assert _looks_multibyte(DE_PROSE.encode("cp1252")) is False


def test_hangul_evidence_only_counts_when_the_reading_is_coherently_korean():
    """第一版把「出现谚文/假名」直接当正面证据，结果**偷走了三份中文文件**：
    一份 GBK 评分表被 euc_kr 解成 '檎츰,섀槻팀롸'（三分之一是谚文），奖励分让它赢了
    正确的 gb18030。真韩文是**通篇**韩文，误读是汉谚各半 —— 判据是连贯性，不是出现。"""
    from avery.ingest.parse import _script_profile
    _incoherence, evidence = _script_profile("이름,직위,부서\n김철수,과장,영업부")
    assert evidence > 0.0                               # 通篇韩文 → 算证据
    incoherence, evidence = _script_profile("檎츰,섀槻팀롸,탤츰,寮밗팀刀")
    assert incoherence > 0.10 and evidence == 0.0       # 汉谚混杂 → 不算，还要扣分
    _incoherence, evidence = _script_profile("莉こ冪燴,玻珇竒瞶")
    assert evidence == 0.0                              # 零星一个假名 → 是残渣不是语言


def test_gb18030_must_show_that_what_it_produced_is_actually_chinese():
    """gb18030 几乎接受任意字节对，所以它得自证。判据用「GB2312 ∪ Big5 的常用字集」而不是
    GB2312 单独 —— 后者会把一份**合法的繁体文件**判成 0.652 的可疑，属于修日文弄坏港台。"""
    from avery.ingest.parse import _rare_han_share
    assert _rare_han_share("姓名,职位,团队,张伟,产品经理") == 0.0     # 简体
    assert _rare_han_share("姓名,職位,團隊,張偉,產品經理") == 0.0     # 繁体，同样不许扣
    assert _rare_han_share("巵柤晹彁栶怑揷拞懢榊") > 0.3             # 日文被误读出来的东西


def test_a_western_shaped_file_is_never_read_as_chinese():
    """梯子的收尾规则：字节看起来是孤立西欧重音、又没有任何西欧码页接受它时，
    正确答案是「读不出来」，不是「那就当中文吧」。'caf乪' 就是从这条兜底里掉出来的。"""
    from avery.ingest.parse import _candidate_ladder
    ladder = _candidate_ladder(SV_PROSE.encode("cp1252"))
    assert all("gb18030" not in rung for rung in ladder), ladder


def test_dense_halfwidth_katakana_is_mojibake_not_japanese():
    """把 shift_jis 放上梯子，等于给每一种我们不支持的单字节码页开了一条新的"读通"路径：
    Shift_JIS 把 0xA1–0xDF 一字节一个映射成半角片假名，于是泰文 cp874 干净地解成
    'ﾊﾇﾑﾊｴﾕ､ﾃﾑｺ'。半角片假名是 1980 年代终端/POS 的产物，真日文材料几乎不用。"""
    from avery.ingest.parse import _halfwidth_kana_density
    assert _halfwidth_kana_density("ﾊﾇﾑﾊｴﾕ､ﾃﾑｺ ﾂﾔｹｴﾕｵ") > 0.0
    assert _halfwidth_kana_density(JP_PROSE) == 0.0
    # 端到端：这一句泰文旧代码解成半角片假名、标 ingested；现在整份被判读不出来。
    # （🔴 不是所有泰文都被挡住——见 progress-fixB.md 的"已知残留"，短句仍可能被
    #   gb18030 解成看似正常的中文。那一条不是本次能确定性解决的，已如实记录。）
    with pytest.raises(DecodeError):
        decode_text("สวัสดีครับ ยินดีต้อนรับ เอกสารพร้อมแล้ว กรุณาตรวจสอบ\n".encode("cp874"), "th.csv")
