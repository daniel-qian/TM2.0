// ── issue #81 · lite2 的 icon 体系（唯一入口）────────────────────────────────────────
//
// 0809 拍板：引入 **@phosphor-icons/react**（v2 是 per-icon ESM 模块、tree-shakeable，
// 只打包 import 到的那几枚）。改造前全仓零 icon 库：lite2 的全部图形 = 3 个手绘 SVG
// （火花 / 回形针 / 铃铛）+ 6 种 unicode 字形（× → ↗ ▴▾ ⚙），fill 派与 stroke 派并存，
// 跨字体渲染还不一致——「icon 不好看」的另一半病根就在这儿。
//
// 🔴 本文件存在的理由是**一致性锁**：weight 与 size 在这里定一次，调用方只挑语义。
//    直接从 '@phosphor-icons/react' import 到组件里，下一个人就会顺手换一个 weight，
//    于是同一排按钮里出现两种笔触——那正是我们要消灭的现象。
//      · WEIGHT 恒 'bold'：Phosphor regular 的笔画是 16/256 ≈ 6.25% 字号，渲到 17px 只有
//        1.1px，在墨底小圆钮上糊成一团；bold 是 24/256 ≈ 9.4%（17px → 1.6px），
//        与既有铃铛的 stroke 1.8@24（7.5%）同一量级，是本仓最接近的现成锚点。
//      · aria-hidden + focusable=false + **显式 width/height**：三条都是既有纪律
//        （sweep D6c 判零尺寸 svg）。Phosphor 的 width/height 来自 `size`，不传就是
//        `undefined`——所以每个包装都显式给 size，绝不依赖 IconContext 的隐式默认。
//
// 🔴 统一范围**只限对话页这一套**（票 #81 拍板）：composer 的附件/发送/停止 + 侧栏新对话。
//    顶栏铃铛（LiteBell 手绘 SVG）、设置齿轮 `⚙`、跳转箭头 `↗`、抽屉 `▴▾`、移除 `×`
//    本票一律不碰——顶栏在 54 张像素基线的**每一张**里，动它＝全量重冻（#79 先例：
//    tab 改名 50 张全漂）。全应用 icon 统一是 carry-over。
//    ⚠ 悬浮胶囊**收起态 pill** 上的手绘 SparkIcon 同理不动：像素数据态 14 张里胶囊都是
//    收起 pill，动它 14 张全漂。展开态（走 composer）才用本文件的 icon。
//    ⚠ #84 追加了一族「资料库」icon（左栏分区 + 表格行动作）。范围仍然守着上面那条线：
//      顶栏/铃铛/齿轮一个没碰，所以 54 张基线里只有 files 那 4 张会漂（票面预期内）。
import {
  ArrowUp, ArrowsClockwise, Buildings, CaretDown, DotsThreeOutline, DownloadSimple, FileText,
  FolderSimple, MagnifyingGlass, NotePencil, Notepad, Paperclip, Stop, Trash, UploadSimple,
} from '@phosphor-icons/react'

// 一族一个笔触。改这个常量＝改整套 icon 的观感，改之前先看上面那段。
const WEIGHT = 'bold' as const

/** composer 控件行里的 icon 尺寸（34px 圆钮/方钮内）。 */
const CONTROL_SIZE = 17
/** 与文字并排的 icon 尺寸（侧栏「新对话」钮）。 */
const INLINE_SIZE = 16
/** #84 · 资料库左栏行内与表格行内的 icon 尺寸（34px 行 / 13px 正文旁）。 */
const RAIL_SIZE = 15

/** 发送这一问。取代文字钮「提问」与悬浮胶囊的 unicode `→`。 */
export function SendIcon() {
  return <ArrowUp size={CONTROL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 停止生成。取代文字钮「停止」（壳仍是 danger 描边——打断不是危险操作，只借色不借实底）。 */
export function StopIcon() {
  return <Stop size={CONTROL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 带文件一起问。取代手绘 PaperclipIcon（AskRefComposer 里那份 16×16 fill path）。 */
export function AttachIcon() {
  return <Paperclip size={CONTROL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 开一场新对话（侧栏置顶）。Claude 侧栏同位用的也是「纸+笔」而不是加号。 */
export function NewChatIcon() {
  return <NotePencil size={INLINE_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

// ── #84 · 资料库（左栏分区 + 工具条 + 表格行动作）────────────────────────────────────
// 全部走同一个 WEIGHT 与 RAIL_SIZE：这一族一次上齐，就不会出现「后加的那两枚笔触不一样」。

/** 左栏「文件」分区。 */
export function FilesZoneIcon() {
  return <FolderSimple size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 左栏「常驻表单」分区。 */
export function FormsZoneIcon() {
  return <Notepad size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** #85 · 左栏「资料更新」分区（补料改了什么的只读流水）。
 *  用「转了一圈」而不是铃铛/感叹号：拍板③ 定的是**安静更新**，一枚警示形状的 icon 会把
 *  一条事后流水读成一堆待办。 */
export function ChangesZoneIcon() {
  return <ArrowsClockwise size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 左栏「新建一家公司」/「这台电脑上传过的公司」。 */
export function CompanyZoneIcon() {
  return <Buildings size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 销毁类：清空这份档案 / 删除一份文件。 */
export function TrashIcon() {
  return <Trash size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 工具条主钮「上传文件」。 */
export function UploadIcon() {
  return <UploadSimple size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 工具条「在这些文件里找…」。 */
export function SearchIcon() {
  return <MagnifyingGlass size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 表格行首的文档字形。 */
export function DocIcon() {
  return <FileText size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 表格行动作：下载这一份。 */
export function DownloadIcon() {
  return <DownloadSimple size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** ≤860 的行尾溢出菜单开关（桌面 hover 直接现两枚钮，这枚 CSS 收起）。 */
export function OverflowIcon() {
  return <DotsThreeOutline size={RAIL_SIZE} weight={WEIGHT} aria-hidden="true" focusable="false" />
}

/** 自绘下拉（排序）的三角。取代原生 `<select>` 那枚跟着系统走的箭头。 */
export function CaretDownIcon() {
  return <CaretDown size={11} weight={WEIGHT} aria-hidden="true" focusable="false" />
}
