// partner-docs-0728 · 「文件与表单」页的内容模型。
//
// 这一层只描述**文档长什么样**，不描述它怎么被渲染，也不含任何 React。四份正文
// （NDA / DPA / 隐私政策 / 标准表单说明）由合伙人的 .docx 手工转录而来，一次性转、
// 标转录日期；.docx 原件同时放在 public/paperwork/ 下供原样下载，两者不是主从关系——
// **要拿去盖章的是原件**，页内正文只为「不下载也能读」。
//
// 🔴 `note` 与 `p` 必须分开渲染，这不是排版偏好。合伙人的草案里夹着**起草者写给自己人
// 看的批注**，它们不是协议条款：
//   · DPA 第三条后那段「第 3.2 与 3.3 条是保护乙方的关键条款……谈判中甲方可能要求乙方
//     承担脱敏义务，需谨慎权衡」——这是我方的谈判底牌；
//   · 隐私政策第二条后那段「对外不应表述为『不涉及个人信息』」——这是措辞风险提示。
// 混在正文里渲染，等于哪天带客户看这一页时把底牌念出来。所以 note 一律带
// 「内部批注 · 不属于协议正文」的可见标签，且在页面顶部的「给客户看」开关下可整体收起。
export type DocBlock =
  /** 段落正文。 */
  | { kind: 'p'; text: string }
  /** 条款标题（第一条／一、／01 这一级）。 */
  | { kind: 'h'; text: string }
  /** 无序列表（协议里的「包括但不限于」若干项）。 */
  | { kind: 'ul'; items: string[] }
  /** 表格。head 为空数组时不渲染表头行（协议里有若干「项目 / 内容」两列无表头表）。 */
  | { kind: 'table'; head: string[]; rows: string[][] }
  /** 🔴 起草者内部批注——不是协议条款，见文件头。 */
  | { kind: 'note'; text: string }
  /** 落款区（盖章 / 法定代表人 / 日期），渲染成两栏。 */
  | { kind: 'sign' }
  /** 勾选项（DPA 第七条那个「□ 同意 / □ 不同意」）。渲染成不可交互的方框——它是纸面动作。 */
  | { kind: 'choice'; label: string; options: string[] }

export type DocFile = {
  /** 站内绝对路径（public/ 下的静态件）。 */
  href: string
  /** 下载时保存成的文件名。中文名放这里、ASCII 名放 href——URL 干净，落盘可读。 */
  download: string
  /** 人类可读的大小，用于让人在点之前知道要下多大。手填，因为构建期读不到 public/。 */
  size: string
  /** 格式徽章上的字，如 'DOCX' / 'XLSX' / 'PDF'。 */
  format: string
  /** 一句话说明这一份下下来干什么用。 */
  hint?: string
}

export type PaperDoc = {
  id: string
  /** 分区：法律样本 vs 填写表单。可见性与语气都不同，见 catalog.ts。 */
  section: 'legal' | 'forms'
  title: string
  /** 副标题，通常是「（DPA）· 草案 v0.1」这类。 */
  subtitle: string
  /** 谁该读这一份。法律三份的读者不是同一批人，这是本页最容易被搞混的一件事。 */
  audience: string
  /** 源件版本 + 转录日期，逐份显示，漂了一眼看得出来。 */
  provenance: string
  /** 可下载的原件，可以多份（表单是 docx + xlsx + pdf 三件）。 */
  files: DocFile[]
  /** 页内正文。表单那一份不转全文（7 张表转成正文没有意义），只转总说明。 */
  blocks: DocBlock[]
}
