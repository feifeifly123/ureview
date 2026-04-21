# OpenAgent.review — 产品设计哲学

_写于 2026-04-20, commit-of-record: 第 6 轮改版后 (trending-driven pivot)_

这份文档是**产品北极星**。任何改动, 包括功能增加、schema 调整、UI 重构, 都先过一遍这里的原则。如果新改动违反了下面任何一条, 要么在这里改掉原则、说明为什么, 要么放弃那次改动。

---

## 1. 核心命题 (Core thesis)

**一句话**: 当一篇 arXiv 论文在 HF 上 trending, 我们跑一份结构化的 AI review, 发出来, 就这样。

- **Trending-driven, not calendar-driven**。没有每日配额, 没有编辑日历, 没有"今天要发几篇"的 KPI。看到了 trending 的论文 → 跑 pipeline → 发布。
- **Reactive pipeline, not scheduled**。cron 可以每小时去 poll 一次 HF, 但"poll 结果是空"是正常状态。pipeline 能容忍一整天没动作。
- **One review per arXiv paper, ever**。同一篇论文不管 trending 多少次, 只有一条 review。需要刷新时明确 `--force`。
- **Information, not opinion about the site itself**。我们只负责把 paper 的结构化 judgment 送出去, 不做 PR、不做榜单、不做编辑年度盘点。

---

## 2. 产品是什么 (What the product is)

一个 **paper triage surface**。把同一份 agent review 的信息, 分三层暴露, 服务三个阅读任务:

| 阅读任务 | 所需时间 | 对应视图 |
|---------|---------|---------|
| "这篇值不值得点开" | 30 秒 | Home/Browse feed 卡片 |
| "值不值得精读" | 2 分钟 | Review 详情页 Structured 模式 |
| "agent 原话是啥, 我要自己判断一下" | 5 分钟 | Review 详情页 Raw 模式 |

这三层读的是同一份 review JSON, 不是三份独立的内容。**一次生成, 三种视图**, 是核心工程杠杆。

---

## 3. 产品不是什么 (What it explicitly isn't)

显式声明的 non-goal, 对每一次需求评估都适用:

- **不是同行评审**。AI review 是一遍过的语言模型意见, 没有人工校验, 没有 area chair, 没有 publication decision。About 页顶部的 disclaimer 不能被"设计简洁"为名拿掉。
- **不做编辑日历**。没有"今天的 N 篇"这种概念。`/day/` 页 (已删) 就是违反这条的遗物。
- **不把四维度压成一个总分**。Soundness 3、Originality 2、Significance 4, **不能被平均成 3.0**。展示时必须四个分开。这条是 M3 圆桌会议记录在案的死原则。
- **不假装客观中立**。"positive / mixed / critical" 是**色带**, 不是"共识评级"。色带只 communicate agent 的倾向, 不 communicate "社区怎么看"。
- **不做作者回复流**。没有 rebuttal 线程, 没有 author portal, 没有 version 分歧。这块 scope 在 commit `88cf525` 被砍掉了, 砍得干净。
- **不做个人化**。没有用户账号、没有收藏夹、没有 following、没有评论。这些是 P2+ 项, 不是 P0 的 MVP。

---

## 4. 数据模型铁律 (Data model rules)

### 字段的权威来源 (who owns what)

| 字段 | 权威来源 | 我们做什么 |
|------|---------|-----------|
| `title`, `abstract`, `paper_url`, `arxiv_categories` | **arXiv API** | 纯 passthrough, 原文不修改 |
| `hf_rank` | HF Trending | **一次性记录**, 首次观察到的排名 |
| `ai_review.*` (summary, strengths, 4 ratings, questions, limits, rec, conf, ethics) | **LLM** | 生成, 从此只读 |
| `review_highlights.*` (why_read, why_doubt, leaning) | LLM (或从 ai_review 派生) | 生成, 用于 feed 展示 |
| `id`, `slug`, `date` | pipeline | 派生自 title + 首次 review 时间 |
| `updated_at` | pipeline | 最后一次写 JSON 的时刻 |

### id 的语义

- `id = "{date}-{slug}"`, 例如 `2026-04-09-scaling-laws-for-neural-language-models`。
- `date` 是 **首次 review 的日期**, **不是** arXiv 提交日期, **不是** HF trending 日期。
- 一旦一个 review 有 id, id **永远不变**。即使同一篇论文再 trending, 我们跳过 (见 §1)。

### 去重键

**`paper_url` 是去重键**。pipeline 在生成新 review 前, 读所有现有 `data/reviews/*.json`, 构建一个 paper_url set, 匹配就跳过。regex 提取 arXiv ID (`arxiv\.org/abs/([^/?#]+)`) 作为规范化。

### schema 演化

- **加可选字段**: 安全, 不需要 R2 republish。
- **加必填字段** / **修改嵌套对象形状**: 破坏性, 需要 `--force` republish, 所有历史 review 要么重跑 LLM 要么手动补齐。
- **删字段**: 一律破坏性。执行前要 explicit approval。

---

## 5. Feed 排序规则 (Feed ordering rule)

**`latest.json.reviews[]` 按 `updated_at` desc 排**。理由:

- `updated_at` 是 **我们这边** 的时钟。这是我们负责的内容的最后修订时刻, 对读者来说"最近一次有人碰过这条"语义清晰。
- **不按 `hf_rank` 排**。HF 的热度信号属于上游, 不应该把上游信号当我们的排序轴。把别人的 ranking 当自己的, 是假装权威。`hf_rank` 只 surface 在卡片上作为 chip, 不驱动排序。
- **不按 `date` (首次 review 日) 排**。因为 `updated_at` 对 `date` 大部分情况相等, 但万一因为 `--force` 刷新, `updated_at` 会带最新日期, 这正是我们想要的行为 (刷新后回到 feed 顶)。

如果以后加入"editor's picks" / "reader favorites" 之类的 surface, **它们应该是独立的 feed**, 不能污染 `latest.json` 的时间轴排序。

---

## 6. 进化边界 (Evolution boundaries)

- **新视图扩展 , 不替换**。P0 的 Structured/Raw toggle 已经建立了 "同一份 data, 多种渲染" 的模式。P2 的 Reader / Reviewer / Form 三模式应该继续这个模式, 而不是重写 review.astro。
- **LaTeX 只在 review 详情页加载 KaTeX**。不在首页、browse 页加载。每个页面的 JS bundle 必须审视, 不能因为"一个小 feature"把 70KB 加到所有人。
- **Raw view 永远不能被折叠掉**。哪怕未来加"AI 总结的总结"多少花哨功能, 原始 agent prose 的入口**永远可点**, 永远在同一个页面。这是用户 audit 的前提, 丢掉它 = 丢掉可信度。
- **R2 publisher 的三层保险不能绕过**。Layer 1 (responses/ 排除) / Layer 2 (reviews append-only) / Layer 3 (typed confirmation) 这三个是防 bad-state-clobber 的底线。想把它们自动化, 先想清楚"自动化这条就坏了会怎样"再说。

---

## 7. 已规划但未做 (Parked for P1/P2)

按 PM 建议分层排好, 现在不做但保留思路:

### P1 (下一轮)

- **Browse 页 review-aware filters**: recommendation band, confidence band, ethics flagged, key_questions_count, soundness concern。数据已经在 latest.json 里 flatten 好了, 只差 UI。
- **Compare view**: 2-3 篇并排, 共享 dimension 轴, 看出差异。
- **Form view**: 按 NeurIPS/ICML review form 严格顺序渲染, 方便复制粘贴。
- **搜索覆盖 ai_review 字段**: 目前只搜 title+abstract; 扩到 summary + strengths_weaknesses + limitations + key_questions。需要 debounce。

### P2 (更远)

- **Reader / Reviewer / Form 三模式切换**: 在 review 页顶部。
- **Section 深链接**: `#judgment`, `#questions` 等 (已部分实现)。
- **JSON / Markdown export 按钮**: 直接把这份 review 导出成 markdown 或原始 JSON。
- **Local shortlist**: localStorage 里存 review id 列表。不做账号, 只做本地收藏。
- **Review 版本历史**: 如果以后允许 `--force` 刷新保留 v1/v2, 详情页加"过往版本"链接。

### 不进路线图 (Out of scope, intentionally)

- 用户账号、登录、评论、点赞
- 作者回复流 (砍掉了, 不加回来)
- RSS / email newsletter (用户可以自己 watch GitHub)
- 多语言 (中英以外)

---

## 8. 做决定的诀 (Decision making)

遇到一个"要不要加这个功能"的问题时, 依次问:

1. **它服务三个阅读任务里的哪一个?** (30 秒扫 / 2 分钟读 / 5 分钟审) 如果一个都不沾, 拒绝。
2. **它是不是引入了新信息源?** 如果是, 说明清楚 (哪个 API / 人工 / 算法), 否则拒绝。
3. **它是否可以从已有 `ai_review` JSON 派生?** 如果可以, 就在前端派生, 不要让 LLM 多输出一个字段。
4. **它改变了现有 URL 或 JSON shape 吗?** 如果是, 需要迁移 + R2 republish, 严格评估代价。
5. **它是否违反任何上面 §3 的 non-goal?** 如果违反, 回到 §3 把 non-goal 写掉, 或者放弃。

---

## 9. Authoring surfaces (Writer vs Reader)

**公共站点是只读的**。`apps/web/` 发布出去的 `openagent.review` 永远不包含编辑界面 — 它从 R2 拉 JSON, 渲染, 结束。

**写入发生在 `apps/studio/`**, 一个 Node 小服务器, 绑定 `0.0.0.0:4311` (允许同网段 LAN 访问, 不上公网)。Studio 的职责:

- 同步 HF Trending, 展示候选论文
- 拉 arXiv metadata, 预填只读区域
- 提供"粘贴 LLM 输出"的区域, 让作者把结构化 review JSON 贴进去
- 派生 feed-card 字段 (why_read / why_doubt / verdict_leaning), 或接受作者手写
- 表单校验 → 写 `data/reviews/{id}.json` → 触发 `build_indexes.py`

**关键工程纪律**:

- Studio **和公共站共用 `data/reviews/` 这个目录**。不论是命令行手写, 还是 studio 界面保存, 写入路径一致, 仓库里的 JSON 文件**永远是单一真实来源**。
- Studio **不具备 publish 能力**。Publish 是 CLI-only 的职责, 只走 `tools/publish_r2.py` (或 `pnpm publish:data:prod` 等), 三层保险 (dry-run → 打字确认 → apply) 只存在于 CLI 一条路径, 跟 §6 "R2 publisher 的三层保险不能绕过" 强一致。新增 publish 入口前先读 §6。
- Studio **不存 state**。关掉服务器等于零副作用。所有持久化都在 `data/**`。
- Studio **没有账号**。0.0.0.0 + 无认证意味着"同网段能连到端口的人就能改 `data/reviews/`", 所以只应在可信网络 (家里 / 公司内网) 里跑, 加登录只是表演, 真正的防线是网络边界和"publish 路径不在这里"。

这条原则让"写作者使用什么工具"和"读者看到什么"彻底解耦。以后就算 studio 被另一个工具取代 (比如 VSCode 扩展, 或真 LLM 自动写), 只要新的写入工具仍然产出合法的 `data/reviews/*.json`, 整条发布流水线完全不知道发生了什么变化。

---

## 附录: 关键 commit 路标

- `c7f7e2e` — R2-first migration (数据层和代码层解耦)
- `88cf525` — Scope cut (砍 scores / confidence / author replies)
- `3df0cd8` — Structured AI review (4 层详情页 + KaTeX)
- `b3895af` — Trending pivot + philosophy doc
- `(this round)` — Studio local authoring app + real HF/arXiv fetchers

下次有人问"为什么网站是这样而不是别的", 先读这份, 再读那几个 commit message。
