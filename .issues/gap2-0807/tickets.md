# gap2 战役 · 2026-08-07（主动 / 追加对比 / 模板生命周期）

> 缘起：0805 差距战役（T1–T8，#50–#57）收官上产后，Danny 0807 复盘：三亚那句承诺里
> 「**主动**」和「**按时间交叉对比**」还要真实现，模板要能**建/改**；「三亚 demo 脚本」取消。
> 本档案 = grill 拍板记录 + 三路读码侦察的共享事实图（ultracode workflow `wf_50e47702-67c`，
> 三名读码员 128 次工具调用，逐条 file:line）。**票的正源在 gh issue**（#58/#59/#60），本文件是战役底稿。

## 五条拍板（0807 grill，Danny 逐条选定）

1. **主动的半径 = 站内为先**：不出 App、零新通道基建。邮件通道不在本役——站内版落地后单独评估。
2. **自动铸链 = 照抄上期、可改**：沿用上期收件人 + project_ref 绑定，界面明示「沿用上期（N 人）· 去调整」。
   名单是经理上期亲手选的，不算替经理断言。
3. **补传后的吵闹度 = 安静更新**：旧读数被新资料顶掉时卡片直接显新值、出处指新资料，不打扰；
   只有互相矛盾/新的更糟才上今天页（沿用现有双栏对照规则）。
4. **模板答案去向 = 三个现成开关 + 其余进资料库**：situational（→情境信号/阻塞）、负载自述、情绪自述
   （→人卡）；没勾的题只进资料库那份提交文档。不做完整映射器。
5. **排期 = 全排碰头后**：碰头前 Danny 先做用户视角演习，不上产新功能；碰头讲「现状 + 已排上的三张票」。

## 共享事实图（侦察结论，票里引用的都在这）

**通知与调度（T9 的地基）**
- NotifKind 只有 4 种，全部前端本地合成、存 localStorage，后端零投递（notifyStore.ts:24, 163-197）。
- 后端与部署**没有任何定时任务基建**；现有周期性工作（demo GC）挂流量顺手做（service/demo.py:69-84）。
- 内置模板就是「首次 GET 按需铸、幂等」先例（form.py:380-395）——lazy 触发有正统范式。
- mint_links **故意不幂等**（form_api.py:176-180），库里也没有 (person, period, template) 唯一约束
  （0013_form_templates.sql:81-86）。铸链即建行，「谁没交」= open 行（form_api.py:224-225）。
- period 只在服务端算（form_api.py:198；form.py:122-126）；过期是读时现算，没有清理任务（form.py:129-144）。
- **今天页规则引擎完全不吃表单数据**（decision_grading.py:873-876 签名；registry.py:562-598 调用链）——
  「还差 X 人没交」不是加条规则就完事，要先修一段新管线。
- 上期收件人 + 绑定能从库里查回来（pg_registry.py:985-999）——自动铸链的数据基础是真的。

**追加与归并（T10 的地基）**
- POST /ingest 恒新建 context（ingest_api.py:309-314）；pipeline 的 context_id 参数是**覆盖**语义不是追加
  （pipeline.py:96-162）；pg put() = DELETE+INSERT 快照替换（pg_registry.py:401-406）。
- **追加的正统范式已存在且天天在用**：form_append.py:192-257 的 get→原地 mutate→put
  （文件头 4-9 行命门注释：绝不新造 CompanyContext）。嵌入只嵌新增块、facts.md 整份重写。
- 人卡有增量合并原语（PersonIndex + merge_person_reading，extract.py:1860-2021）；
  **项目卡没有等价物**（只有整表重建和手编 CRUD，registry.py:213-246）。
- 直接重跑 _dedupe_entities 的四个坑逐条写在 merge_person_reading docstring（extract.py:1988-1999）：
  吞手编/软删/provenance、旧冲突重复报、held_src 记错、signals 换尺重筛。
- 时间轴 = SourceDocument.uploaded_at（decision_grading.py:170-189, 249-270），追加自然并入；
  R-STALE-EVIDENCE / R-FRESH-CONTRADICTS-STALE / R-CROSS-DOC-CONFLICT 都已上线。
- **纪律推论**：补传只进资料库不动卡片 = 时间轴说新、卡片还旧，「过期证据」提醒会闭嘴而卡片在撒谎——
  所以 T10 必须连实体归并一起做，不能砍半。

**模板（T11 的地基）**
- 员工填表页**已是数据驱动渲染**（_FIELD_RENDERERS 表 + 启动期一致性断言，form_api.py:421-427），
  不是写死五个输入框。控件现有 text/choice/number 三种（form.py:35-45）。
- 建模板端点已在（POST /team/{id}/forms，form_api.py:87-168），前端零调用者（当年刻意不做，
  session-handoff-T3.md:58）；FilesScreen 表单区本来就按模板列表渲染（FilesScreen.tsx:93-158）。
- 1~5 分 = number 收窄 min/max，**今天的校验就放行**（form.py:236）；yes/no 要新增 kind，
  隔壁快问有现成姊妹实现（ask.py:30；ask_api.py:521-538；h5.py:37 的 .h5-scale CSS 已在）。
- **自述回流认文案不认结构**（正则认 label 里的「××自述」，extract.py:1419-1462）——换个说法就静默丢；
  situational 开关那条则是结构化的（form_reflow.py:103-155）。两者要统一成结构化。
- 改/删已被提交引用的 field.id = 老答案对不上号（form_api.py:144-145，设计边界）；
  form_templates 无版本列，回流读**当时最新**模板（form_api.py:522/554）。
- 评分类字眼会被红线门整发 422（gate_form_red_line，form.py:149-183）——「读旧表格起草」必须处理。
- 服务端硬上限 MAX_FIELDS=12 / MAX_CHOICES=8 / number 0..100（form.py:35-45），前端必须镜像。
- demo 克隆刻意不复制表单表（0013_form_templates.sql:28-32）。

## 三张票

| # | issue | 一句话 |
|---|---|---|
| T9 | #58 | 站内主动：流量触发自动补铸（照抄上期可改）+ 'form' 通知 + 今天页缺交规则 |
| T10 | #59 | 补资料门：追加上传 + 实体增量归并（安静更新）+ 跨期对比接通 |
| T11 | #60 | 模板拼装器：建/改模板 UI + yes/no 与 1~5 控件 + Avery 读旧表格起草 |

依赖关系：三票互相独立可并行；但 T9 的「谁交了」通知与 T10 的卡片更新都会动 FilesScreen，
合 main 时像素基线在**主检出**重冻（老规矩）。

## 本役明确不开票（免得后人猜）

- **邮件/短信/微信通道**（出 App 的主动）：新基建，站内版落地后再评估。
- **03 表（目标与指标）长成指标卡**：`/paperwork` 那套表单已进产品（下载入口在上传框旁），
  残余差距只有这一条，Danny 未要求。
- **模板版本快照**：v1 用「禁改已用 field.id + 停用不删」守住口径。
- **议事室引用编号换客户文档名**：0805 战役留的记录，仍等 Danny 拍板。
