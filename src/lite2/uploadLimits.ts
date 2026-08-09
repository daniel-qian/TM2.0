// #73 · 上传上限的前端预检口径。
//
// 🔴 为什么要在前端存一份数字（这是债，不是设计）：**后端没有任何端点把上限暴露出来**。
//    开工时逐个确认过全部已注册路由——`/health` 只回 brain/embeddings/extractor/memory 那几项，
//    没有 `/config`、没有 `/limits`。413 响应体里那些人话数字（upload_guard.py:227/287/300）
//    是**踩线之后**服务端才吐的，选文件之前查不到。票面要「选文件时就预检、不等 413」，
//    就只能自己维护一份，靠注释与后端互指。
//
// 🔴 数字必须对齐**生产 env**，不是 `guards.py` 的代码默认值：
//      guards.py 默认 8 MiB/文件、15 个文件；生产容器用
//      `AVERY_MAX_UPLOAD_BYTES=10485760`(10 MiB) + `AVERY_MAX_FILES=10` 覆盖。
//      guards.py:42-47 有明文警告——2026-07-20 有人照默认值判定「前端文案在撒谎」，
//      按那个结论改反而会真造出一个 bug。
//
// 同一批数字今天散在三处，本票只新增这一处并把三处互指清楚，收敛归 #76 / S2（他们正在那个文件里）：
//   ① 本文件（议事室 composer 的预检）
//   ② `src/lite2/UploadPanel.tsx:28` 的 ACCEPT（扩展名那一半）
//   ③ `eval-harness/avery/ingest/guards.py:87-88` 的 SUPPORTED_EXTS（权威）
//      与 `guards.py:39-64` 的三个上限读取函数（权威）
//
// 预检只做**看得见就能判**的三件事（数量 / 单文件大小 / 整批总量）。类型与 zip 炸弹那些要读
// 字节才判得了的，照旧交给后端 415/413——前端不装能力。

/** 与 `UploadPanel.tsx:28` 逐字一致；对应后端 `guards.py:87-88` 的 SUPPORTED_EXTS。 */
export const ATTACH_ACCEPT = '.pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt'

/** 生产 `AVERY_MAX_FILES`。后端在 `upload_guard.enforce_count` 按**单次请求**的文件数判。 */
export const MAX_ATTACH_FILES = 10
/** 生产 `AVERY_MAX_UPLOAD_BYTES` = 10485760。 */
export const MAX_ATTACH_FILE_BYTES = 10 * 1024 * 1024
/** `AVERY_MAX_TOTAL_UPLOAD_BYTES` 默认值（生产未覆盖）。整批总量。 */
export const MAX_ATTACH_TOTAL_BYTES = 32 * 1024 * 1024

/**
 * 字节数转人话。刻意只给整数 MB / KB——预检文案是给经理看「传不了」的理由，
 * 不是精度报告；`10.49 MB` 这种读数只会让人怀疑是不是自己算错了。
 */
export function humanBytes(n: number): string {
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export type AttachPrecheckFail =
  | { kind: 'too-many'; max: number }
  | { kind: 'too-large'; name: string; max: string }
  | { kind: 'batch-too-large'; max: string }

/**
 * 选文件那一刻就判，判不过**整批拒收**（不做「传一半」——半批入库之后经理没法回退，
 * 而资料库里会多出他并不想要的文件）。返回 null = 可以传。
 */
export function precheckAttachments(files: File[]): AttachPrecheckFail | null {
  if (files.length > MAX_ATTACH_FILES) {
    return { kind: 'too-many', max: MAX_ATTACH_FILES }
  }
  for (const f of files) {
    if (f.size > MAX_ATTACH_FILE_BYTES) {
      return { kind: 'too-large', name: f.name, max: humanBytes(MAX_ATTACH_FILE_BYTES) }
    }
  }
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > MAX_ATTACH_TOTAL_BYTES) {
    return { kind: 'batch-too-large', max: humanBytes(MAX_ATTACH_TOTAL_BYTES) }
  }
  return null
}
