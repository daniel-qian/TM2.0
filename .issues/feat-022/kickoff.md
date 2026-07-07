# feat-022 kickoff — seed 端到端验收 gate(双层机器门,先立必红)

冷启动三件:① 读 `.issues/live-rescue-0707/plan.md`(§0 决策记录 + §S1)② 读 ADR-0022 ③ 读根 `session-handoff.md`(2026-07-07 收盘版)确诊部分。

一句话:把 2026-07-07 的手工复现固化成机器断言——离线 golden 层(每次必跑,无 key 绿)+ 集成层(真起 :8137、真传两个 seed、具名断言 Lin Qing/Chen Mingyuan、假人黑名单=0、pdf≥2 项目、cite 命中、mojibake 门)+ 前端浏览器自驱(live 全流程,story 名词黑名单=0)。**立完就该红**(现状正则抽取必挂具名断言)——红是成功,绿等 feat-023/024。

seed 源:`D:\teammaster-master\teammaster-master\seed-rag\`(拷为 tracked fixtures)。红线:人卡零数字断言复用现有。坑:headless rAF 停摆 → DOM 断言 + `transition:none` 旁路;残留 uvicorn 清理。
