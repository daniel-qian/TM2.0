# -*- coding: utf-8 -*-
"""把 `make-intake-xlsx.py` 的 FORMS 编译成**前后端共用的一份表定义** —— onboarding-accounts-0805 ①。

为什么要有这个脚本（ADR-0034 后果节点名的那条）：ADR-0034 拍板 1 让 7 张表在 app 内直接填，
于是同一份「列名 / 列序 / 必填 / 下拉词表 / 填写提示」同时被三方消费：

  * `scripts/make-intake-xlsx.py`  —— 生成发给客户的 xlsx 空白件（FORMS，**唯一真源**）
  * `eval-harness/avery/ingest/structured.py` —— 收表格行、按列名确定性映射进实体
  * `src/lite2/intake/…`（前端 7 表录入 UI）—— 画那张网格、做单元格级校验

三处各手写一份 = 三份必然各自漂（AGENTS.md 的「重复的身份/归一规则会静默漂开」是旧账）。
所以真源只有 FORMS 一处，本脚本把它编译成两份**生成产物**，两份都进版本库：

  * `eval-harness/avery/ingest/intake_schema.json`  —— 后端运行时读（与包同目录，随镜像走）
  * `src/shared/intakeSchema.ts`                    —— 前端 import（Vite 打包进 bundle）

漂移门在 `eval-harness/tests/test_structured_intake_contract.py`：重新生成一遍与库里的
逐字节比对，不等就红。所以「改了 FORMS 忘了重跑」和「手改了生成产物」两个方向都拦得住。

重新生成：  python scripts/gen-intake-schema.py
自查是否最新：  python scripts/gen-intake-schema.py --check

字段口径：
  * `key`  —— 列的**稳定键**：表头去掉必填星号与首尾空白（`姓名 *` → `姓名`）。JSON 里的
    行对象、后端映射表、前端网格三处都用它，避免第三套键名（票 #40 硬约束）。
  * `header` —— 表头**原文**（含 ` *`），前端表头单元格照它渲染，与 xlsx 一眼对得上。
  * `hint` —— xlsx 里挂在表头上的批注原文（填写提示）。xlsx 里是悬停小红三角，app 里是
    列提示气泡；同一句话，不重写。
  * `options` —— 下拉词表原文（顺序即 xlsx 的顺序）。空数组 = 自由文本列。
  * `width` —— xlsx 列宽。前端拿它做网格列宽的相对权重（一个已经被人调过的、免费的先验）。
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GENERATOR = REPO / "scripts" / "make-intake-xlsx.py"
JSON_OUT = REPO / "eval-harness" / "avery" / "ingest" / "intake_schema.json"
TS_OUT = REPO / "src" / "shared" / "intakeSchema.ts"

# 生成产物的版本号。**只有形状变了才动它**（加/减字段），改文案不动——它是给读代码的人看的
# 「这份 JSON 长什么样」的锚，不是内容 hash。
SCHEMA_VERSION = 1

BANNER_LINES = [
    "本文件由 `python scripts/gen-intake-schema.py` 生成 —— 请勿手改。",
    "真源是 `scripts/make-intake-xlsx.py` 的 FORMS/WHEN/INTAKE（发给客户的 xlsx 空白件用的同一份）。",
    "漂移门：eval-harness/tests/test_structured_intake_contract.py（重新生成后逐字节比对）。",
]


def load_generator():
    """把 `scripts/make-intake-xlsx.py` 当模块加载（文件名带连字符，import 不了）。

    与 `tests/test_partner_intake_form_contract.py` 同一个套路，刻意不抽公共函数：那个测试
    存在的全部意义就是「不经过任何中间层直接对峙真源」，给它加一层共享工具反而多一个漂移点。
    """
    spec = importlib.util.spec_from_file_location("make_intake_xlsx", GENERATOR)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def column_key(header: str) -> str:
    """表头原文 → 稳定键：剥掉必填星号与首尾空白。

    🔴 只剥 ASCII `*` 和空白，**绝不碰汉字**——`_canon_header` 的兜底是「剥掉非汉字再查表」，
    列名里任何汉字的增删都会让后端整列失联（make-intake-xlsx.py 文件头实测过：带中文括号的
    表头抽出 0 人）。所以这里的规则窄到只剩一件事：去掉那颗给人看的星。
    """
    return header.replace("*", "").strip()


def build_payload(mod) -> dict:
    forms = []
    for sheet, purpose, columns, dropdowns in mod.FORMS:
        tier, when = mod.WHEN[sheet]
        cols = []
        for idx, (header, width, note) in enumerate(columns, start=1):
            cols.append({
                "key": column_key(header),
                "header": header,
                "required": "*" in header,
                "width": width,
                "hint": (note or "").replace("\n", ""),
                "options": list(dropdowns.get(idx, [])),
            })
        forms.append({
            "id": sheet.split(" ", 1)[0],          # "01" …… "07"
            "sheet": sheet,                         # xlsx 的 sheet 名（= 表的正式全名）
            "title": sheet.split(" ", 1)[1],        # 去掉编号的表名，UI 导航用
            "purpose": purpose,
            "tier": tier,                           # 核心必填 / 建议补充
            "when": when,
            "intake": mod.INTAKE[sheet],            # 「Avery 现在吃到哪一层」逐张实话
            "columns": cols,
        })
    return {"version": SCHEMA_VERSION, "forms": forms}


def render_json(payload: dict) -> str:
    doc = {"_generated": BANNER_LINES, **payload}
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def render_ts(payload: dict) -> str:
    banner = "\n".join(f"// {line}" for line in BANNER_LINES)
    body = json.dumps(payload["forms"], ensure_ascii=False, indent=2)
    return f"""{banner}
//
// 表头、下拉词表、填写提示一律**中文原文**：它们是发给客户的 xlsx 上印着的字，也是后端按列名
// 认列的键（`avery/ingest/structured.py`）。英文壳里也照原样显示——把它们翻译掉等于让屏幕上的
// 表和用户手里的模板对不上，也等于把后端的列键改掉。界面外壳（按钮/说明/校验提示）走 i18n。

export interface IntakeColumn {{
  /** 稳定键：表头去掉必填星号。行对象、后端映射、校验规则三处共用。 */
  key: string
  /** 表头原文（含 ` *`）——网格表头照它渲染，与 xlsx 一眼对得上。 */
  header: string
  required: boolean
  /** xlsx 列宽，用作网格列宽的相对权重。 */
  width: number
  /** xlsx 表头批注原文（填写提示）。空串 = 这列没有提示。 */
  hint: string
  /** 下拉词表（顺序即 xlsx 顺序）。空数组 = 自由文本列。 */
  options: string[]
}}

export interface IntakeForm {{
  /** "01" … "07" */
  id: string
  /** xlsx 的 sheet 名（表的正式全名，含编号） */
  sheet: string
  /** 去掉编号的表名 */
  title: string
  purpose: string
  /** 核心必填 / 建议补充 */
  tier: string
  when: string
  /** 「Avery 现在吃到哪一层」——逐张说实话 */
  intake: string
  columns: IntakeColumn[]
}}

export const INTAKE_SCHEMA_VERSION = {payload["version"]}

export const INTAKE_FORMS: IntakeForm[] = {body}

export function intakeFormById(id: string): IntakeForm | undefined {{
  return INTAKE_FORMS.find((f) => f.id === id)
}}
"""


def main(argv: list[str]) -> int:
    check_only = "--check" in argv
    payload = build_payload(load_generator())
    wanted = {JSON_OUT: render_json(payload), TS_OUT: render_ts(payload)}

    stale: list[Path] = []
    for path, text in wanted.items():
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current == text:
            continue
        stale.append(path)
        if not check_only:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8", newline="\n")

    if check_only:
        if stale:
            for path in stale:
                print(f"STALE  {path.relative_to(REPO)}")
            print("run: python scripts/gen-intake-schema.py")
            return 1
        print("intake schema is up to date")
        return 0

    for path in wanted:
        print(f"wrote {path.relative_to(REPO)}  ({path.stat().st_size} bytes)")
    print(f"  · {len(payload['forms'])} forms, "
          f"{sum(len(f['columns']) for f in payload['forms'])} columns")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
