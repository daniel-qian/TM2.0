// partner-docs-0728 · 「文件与表单」页的目录。
//
// 两个分区，顺序是有意的：**表单在前，法律样本在后**。
// 到这一页来的人绝大多数是从上传口点过来的「我到底该传什么给 Avery」，那是产品问题；
// 法律样本是给谈合作的人看的物料，读者、频次、紧要程度都低一档。
import { DPA } from './docDpa'
import { FORMS } from './docForms'
import { NDA } from './docNda'
import { PRIVACY } from './docPrivacy'
import type { PaperDoc } from './types'

export const PAPER_DOCS: PaperDoc[] = [FORMS, PRIVACY, NDA, DPA]

export const FORM_DOCS = PAPER_DOCS.filter((d) => d.section === 'forms')
export const LEGAL_DOCS = PAPER_DOCS.filter((d) => d.section === 'legal')

/** 从上传口那条「下载标准表单」直接取的主推件（xlsx）。别在组件里手写路径。 */
export const PRIMARY_FORM_FILE = FORMS.files[0]
