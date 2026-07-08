# feat-023 kickoff — LLM 抽取引擎(修绿 feat-022 后端断言)

冷启动三件:① 读 `.issues/live-rescue-0707/plan.md`(§0 + §S1)② 读 ADR-0022 决策 2 ③ 读 `eval-harness/avery/ingest/extract.py` 头注释(Extractor 协议 + 红线结构)。

一句话:`LLMExtractor` 接 pluggable brain(**现实可用 = M3 + DeepSeek;`claude` 仅代码路径无 key,不得假设**):喂带行号解析文本 → 一次结构化输出多 Person/Project/Signal,每实体带来源行号(cite 链不断)→ 产物过同一 `redline_extract` 门(PersonEntity 类型层无数字字段不变);无 key/失败自动退 HeuristicExtractor(离线 AFK 门保绿)。顺带 pypdf mojibake 清洗 + 检索质量调到 "who leads design" cite 命中 Lin Qing 行。正则不修,降级为测试/兜底。

依赖:feat-022 的断言先在(红着),你的完工判定 = 后端断言全绿,不是自报。
