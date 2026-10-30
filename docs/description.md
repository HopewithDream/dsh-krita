# DSH-Krita 描述文案

下面按使用场景分好，可直接复制到 GitHub About、插件市场、README 开头或发布帖。

## 中文

### 一句话

> 给 DSH 智能体一支真实的 Krita 画笔：能画、能看、能改。

### 短描述（插件列表 / 卡片，约 90 字）

> 把本机 Krita 接进 DSH 的绘画插件：一个 token 友好的 `krita` 工具 + 渐进披露的绘画 skill +「Krita 画师」模式。支持笔触、图层、选区、滤镜、导出预览和完整 Krita Python API。

### 标准描述（README / 商店详情，约 260 字）

> DSH-Krita 让智能体在真实运行的 Krita 里完成整幅画，而不是只生成一张图。它通过本地 HTTP 桥连接 Krita，把建画布、笔触、铺色、选区、图层、滤镜、导出预览、QAction 和 Python API 收进一个 token 友好的 `krita` 工具。智能体按「参考 → 起稿 → 线稿 → 平涂 → 明暗 → 高光 → 导出检查」的循环工作，用 `read_image` 看自己的画面并迭代。
>
> 工具、skill 和模式只在「Krita 画师」中挂载，命令自动合并为一次往返，长脚本走 `.py` 文件模式；Malformed JSON 自动重试，避免一次坏调用终结整轮。Krita 端基于 MIT 的 krita-cli 扩展，保留 52 个动作并新增 14 个，共 66 个。

### 长描述（发布帖 / 项目主页）

**不是“出图 API”，是让智能体真的在画布里画。**

DSH-Krita 把 DeepSeek Harness 和一个正在运行的 Krita 桌面应用连起来。智能体会先看参考、规划画布和图层，再分批下笔、导出 PNG、用 `read_image` 检查，然后继续修改——整个过程和人类画师的工作流一致。

**能力**
- 画布与文档：新建/打开/保存 `.kra`、导出 PNG/JPG、切换/关闭文档、撤销重做。
- 绘画：笔刷预设、颜色、自由笔触、填充、矩形/椭圆/直线、渐变、文字/矢量（`py`）。
- 图层与选区：常规图层操作、矩形选区、按颜色/透明度选择、扩缩边、选区通道、统计。
- 滤镜：列出全部滤镜，`filter_config` 查参数，按默认或自定义 `config` 应用；模糊、HSV 调整等已实测。
- 全功能入口：`actions` 搜索并触发任意 Krita QAction（本机 688 个），`py` 执行任意 Krita Python API。
- 资源与审阅：笔刷/图案/渐变/调色板资源列表；导出预览 + 图片审阅闭环。

**为什么适合智能体**
- 单一工具 `krita(commands, timeoutMs)`：模型每轮只看到一个紧凑 schema，而不是几十个工具定义。
- 命令按批执行，Host 自动合并成一次 HTTP 往返；结果紧凑、可截断。
- `SKILL.md` 只在第一次画画时加载，协议、配方、API 速查按需打开。
- 只在「Krita 画师」模式挂载，其他模式零 token 成本。

**稳定性**
- `py` 支持文件模式：长脚本先用 `write` 写成 `.py`，再传路径，避免长 JSON 转义错误。
- 内置 malformed tool-call JSON 自动重试（最多 2 次/步），一次坏生成不再终结整轮。
- Krita 5.3 兼容性修复：滤镜配置、导出父目录、`save_selection` 掩码、选区提交等。
- 验证：Krita 端 60/60 E2E、Host 离线测试、真实画布绘制与迭代导出。

**适合谁**
- 想在 DSH 里做「会画画」的智能体，而不是只生成图片的开发者。
- 需要可复现、可检查、可版本化绘画流程的数字艺术家。
- 想把桌面创作软件接进 agent 工作流的工具作者。

### 关键词

`DSH` · `DSH 插件` · `Krita` · `AI 绘画` · `智能体` · `数字绘画` · `绘画工作流` · `Agent Skill`

---

## English

### Tagline

> Give your DSH agent a real Krita brush: it paints, looks, and iterates.

### Short

> A DSH plugin that connects a live Krita desktop app: one token-efficient `krita` tool, a progressive painting skill, and a "Krita Painter" mode. Paint strokes, layers, selections, filters, previews, and the full Krita Python API.

### Standard

> DSH-Krita lets an agent finish a drawing inside a running Krita instead of merely generating an image. A local HTTP bridge turns canvas, stroke, fill, selection, layer, filter, export, QAction, and Python API operations into one compact `krita` tool. The agent follows a reference → block-in → lineart → flat color → shading → highlights → export-review loop, inspecting its own PNGs with `read_image`.
>
> The tool, skill, and preset stay scoped to the Krita Painter mode; commands batch into one round trip, long scripts run from `.py` files, and malformed tool-call JSON is retried. The Krita bridge vendors the MIT krita-cli plugin and extends it to 66 actions.

### GitHub About (≤ 350 chars)

> Connect a live Krita desktop app to DeepSeek Harness. One token-efficient `krita` tool, a progressive painting skill, and a "Krita Painter" agent preset let an agent create canvases, paint, manage layers/selections, apply filters, export previews, and iterate — with QAction and Python escape hatches. MIT.

### Topics

`dsh` `dsh-plugin` `krita` `ai-agent` `digital-painting` `agent-skill` `creative-tools` `artwork`
