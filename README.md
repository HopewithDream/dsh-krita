# DSH-Krita：让智能体在真实 Krita 里画画

把 **Krita 5.x** 接进 **DeepSeek Harness (DSH)**：一个 token 友好的 Host 插件、一套渐进披露的绘画 skill，以及一个可直接选择的 **「Krita 画师」模式**。智能体可以建画布、画线、铺色、选区、图层、滤镜、导出预览，并看着导出的 PNG 迭代修改。

![demo](docs/demo.png)

_上图由 DSH 的 `krita` 工具在本机 Krita 5.3.4.1 中实际绘制（15 条命令的批次，相对路径导出）。_

Krita 端没有重新造轮子：HTTP 桥基于 MIT 开源的 [`krita-cli` / `krita-mcp`](https://github.com/edithatogo/krita-cli) 的 Krita Python 插件，做了 vendoring 和 v1.1 扩展。DSH 端只保留**一个**模型可见工具 `krita`，其余能力通过 skill 按需加载。

## 能力

| 类别 | 能力 |
|---|---|
| 画布 | 新建/打开/保存 `.kra`/导出 PNG、关闭/切换文档、撤销/重做、清空、取色、画布信息 |
| 绘画 | 笔刷预设、颜色、自由笔触、填充、矩形/椭圆/直线、渐变（`py`）、文字/矢量（`py`） |
| 选区 | 矩形/按颜色/按透明度、反选、扩/缩/边框、统计、保存/加载选区通道；椭圆/多边形/组合选区 API 在 Krita 5.3 缺失（见 skill 的 workaround） |
| 图层 | 列表/新建/选择/删除/重命名/透明度/可见性，复制/合并/拼合/分组/混合模式（`layer` 或 `py`） |
| 滤镜 | 列出 Krita 全部滤镜；`filter_config` 查参数，`filter` 按默认或自定义 `config`/`seed` 应用（已实测模糊、HSV 调整） |
| 全功能入口 | `actions`/`action` 搜索并触发任意 Krita QAction；`py` 在 Krita 主线程执行任意 Krita Python API |
| 资源 | 笔刷/图案/渐变/调色板/符号/工作区列表 |
| 批量 | `seq` 一次 HTTP 往返执行多条命令；Host 侧 `commands` 数组自动合并 |

“带该软件所有可以使用的功能”在这里落地为三层：**高层命令**（常用绘画操作）、**QAction 触发**（菜单里的一切）、**Python API**（脚本能做的极限）。详见 [PROTOCOL.md](PROTOCOL.md) 和 [skills/krita/references/](skills/krita/references/)。

## 架构

```
DSH「Krita 画师」session
├── persona          画师工作流与安全约束
├── krita tool       Host 插件：唯一的模型可见工具（commands 数组）
│     ├── status / start / setup        Host 侧生命周期
│     └── POST http://127.0.0.1:5678    桥命令（seq 合并往返）
├── skills/krita     SKILL.md + references（按需加载）
├── tool-fs          read / read_image / write
├── tool-skill       skill 目录/加载
├── ask-user         创作选择
└── compaction       长绘画会话压缩

Krita 进程
└── krita-plugin/kritamcp（扩展自 krita-cli，MIT）
      ├── QTimer 主线程命令队列 + HTTP server
      ├── 52 个原有绘画/选区/图层/导出动作
      └── v1.1：seq / py / actions / filters / filter_config / filter / docs / layer / resources / info
```

关键设计：**一个工具 + 一个命令数组**。模型每轮只看到约 300 tokens 的 schema（约 150 词）；一次调用可发 3–10 条命令（Host 自动用 `seq` 合并成一次 HTTP 请求），大幅减少往返和 JSON 开销。Krita 工具和 skill **只存在于「Krita 画师」模式**，其他模式零 token 成本。

## 目录

```
dsh-krita/
├── index.js                 # DSH Host 插件入口
├── lib/                     # config / HTTP bridge / install / tool 定义
├── cordis.patch.yml         # 插入 agent preset「Krita 画师」
├── krita-plugin/            # vendored + extended Krita Python 插件
├── skills/krita/            # SKILL.md + references
├── extras/                  # 可选 profile 级修复 bundle（malformed JSON 重试）
├── tests/host/              # 离线 smoke test / 临时验证 bundle
├── scripts/                 # 安装辅助脚本
├── PROTOCOL.md              # 桥协议（Host 与 Krita 的共同契约）
├── THIRD-PARTY.md           # 上游 MIT 归属
└── README.md
```

## 安装

### 1. 安装 DSH bundle

```powershell
# 在 DSH 中（把 <repo> 换成本仓库路径）：
plugin_manager install_bundle target="<repo>"
```

安装后 profile 的 `package.json` 会多出 `dsh-krita-painter` 依赖，并在插件列表中看到 `preset-krita`（active）。新开一个 session，在模式选择器里选 **Krita 画师**。

> Krita 路径会按 `KRITA_PATH` 环境变量 → 常见安装位置自动探测；非标准安装请在 preset 的
> `kritaPath` 配置里指定，例如 `C:\Program Files\Krita (x64)\bin\krita.exe`。

### 2. 安装 Krita 端桥（两种方式）

**方式 A（推荐，在 Krita 画师 session 里让智能体做）：**

```json
{"commands":[{"action":"setup"}]}
```

`setup` 会把 `krita-plugin/kritamcp` 和 `kritamcp.desktop` 复制到
`%APPDATA%\krita\pykrita`，并在 `%LOCALAPPDATA%\kritarc` 的 `[python]` 段写入
`enable_kritamcp=true`（保留其他配置）。随后：

- **如果 Krita 正在运行**：手动关闭并重新打开 Krita（`start` 检测到已有进程时会拒绝启动第二个实例）；
- **如果 Krita 已关闭**：可以直接让智能体启动它：

```json
{"commands":[{"action":"start"}]}
```

**方式 B（手动）：**

```powershell
# 复制 krita-plugin/kritamcp 和 krita-plugin/kritamcp.desktop
# 到 %APPDATA%\krita\pykrita\，然后在 kritarc 写入：
[python]
enable_kritamcp=true
```

重启 Krita 后，`http://127.0.0.1:5678/health` 应返回 `protocol_version: 1.1.0`。

### 3. 验证

在 Krita 画师 session 里：

```json
{"commands":[{"action":"status"}]}
```

返回 `status: "running"`、Krita 版本、当前文档/图层/颜色/笔刷即成功。

## 使用

### 一个最小的绘画批次

```json
{"commands":[
  {"action":"new_canvas","params":{"width":1024,"height":768,"background":"#ffffff"}},
  {"action":"create_layer","params":{"name":"Sketch"}},
  {"action":"set_brush","params":{"preset":"Basic-5 Size","size":12}},
  {"action":"set_color","params":{"color":"#222222"}},
  {"action":"stroke","params":{"points":[[120,420],[260,300],[420,380],[600,260],[820,360]]}},
  {"action":"save","params":{"path":"krita-out/v01.png"}}
]}
```

然后 `read_image` 看 `v01.png`，判断构图/明暗，再发下一批命令。相对路径（如
`krita-out/v01.png`）由 Host 按 Session 工作目录解析，`save`/`doc_save` 的父目录会自动创建；
但导出后仍要用 `read_image` 确认文件真的写出来了。完整命令表见
[skills/krita/references/protocol.md](skills/krita/references/protocol.md)，绘画工作流见
[skills/krita/references/recipes.md](skills/krita/references/recipes.md)。

### 全功能入口

```json
{"commands":[{"action":"py","params":{"code":"print(app.version()); print([n.name() for n in doc.rootNode().childNodes()])"}}]}
```

```json
{"commands":[
  {"action":"actions","params":{"q":"blur","limit":5}},
  {"action":"action","params":{"id":"krita_filter_gaussian blur"}}
]}
```

```json
{"commands":[
  {"action":"filter_config","params":{"name":"blur"}},
  {"action":"filter","params":{"name":"blur","layer":"paint","config":{"halfWidth":18,"halfHeight":18,"strength":100}}}
]}
```

`py` 在 Krita 主线程执行，命名空间跨调用保留；`krita`、`Krita`、`app`、`doc`、
`window`、`layer`、`InfoObject`、`QColor`、`QImage` 已预绑定。`py` 是“所有功能”的最终
逃生口，也是唯一需要谨慎使用的入口（见 skill 的安全规则）。

## 稳定性：`tool input is invalid JSON` 失败模式

DeepSeek Messages 偶尔会输出**结构不完整的 tool-call JSON**（实测是一条长 `py`
命令在 `"params": {...}` 边界少了一个 `}`），DSH 原生适配器会把它判为
`MALFORMED_RESPONSE` 并终止整个 turn。这里做了两层修复：

1. **`py` 文件模式**（Krita 桥已生效）：长脚本不要塞进 JSON，先用 `write` 写
   `.py` 文件，再调用 `{"action":"py","params":{"file":"D:/.../script.py"}}`。
   工具参数只剩一个路径，模型不再需要转义整段代码；`__file__` 会绑定到该路径。
2. **Malformed JSON 重试**（已安装并 active，无需重启 DSH）：
   `plugin_manager install_bundle target="<repo>\extras\malformed-json-retry"`
   安装一个全局 `agent/request-error` 监听器；只对 `MALFORMED_RESPONSE` 在同一个
   turn/step 内最多重试 2 次（800ms/1500ms 退避），超过后交给原策略。模型重新生成
   一次合法调用即可继续，不再直接结束会话。

两项都已生效：Krita 侧 `py` 文件模式加载在桥里，重试插件是 live 的全局 listener。

## Token 设计

- **单一工具**：`krita(commands, timeoutMs)`，schema 约 300 tokens（约 150 词）；没有 50+ 个工具定义。
- **批量**：`commands` 数组 → Host 自动 `seq` 合并，一次 HTTP 请求；返回每条命令一行结果。
- **按需 skill**：目录里只有一条 `krita` 摘要；`SKILL.md` 在第一次画画时加载，协议/API/配方在 `references/` 里按需读取。
- **模式隔离**：tool + skill 只在「Krita 画师」模式挂载，标准模式完全看不到。
- **结果上限**：单次工具结果默认 16k 字符截断；`actions`/`filters`/`resources` 支持 `q`/`limit` 收敛。
- **图像反馈**：不返回原始像素，导出 PNG 后用 `read_image` 查看。

## 验证

```powershell
cd <repo>
node tests/host/smoke.mjs                  # Host 工具离线测试（无需 Krita）
node tests/krita/verify-save-selection.mjs # 需要 Krita + 桥：save/load 选区往返
```

本机验证结果：Krita 端 E2E **60/60**（脚本 `tests/krita/e2e.ps1`，生成的
`tests/out/` 与报告已通过 `.gitignore` 排除），含 health、`py` introspection、绘画、
选区、图层、滤镜、actions、`.kra` 保存、PNG 导出；DSH 工具实际绘制并相对路径导出
（`docs/demo.png`）；`save_selection`→`load_selection` 二值掩码往返 400→0→400 通过。

## 已知限制

- Krita 必须是**带 GUI 的桌面进程**；桥不提供无头渲染。
- HTTP 桥只绑定 `127.0.0.1:5678`，本机任意进程可调用；`py` 等价于本机代码执行，只对可信用户开放。
- **`py` 里不要调用会弹模态框或阻塞主线程的 API**（`doc.close()`、另存为对话框、对修改中文档做 flatten/merge 等）。这类调用会卡住 Krita 主线程并让整个桥失去响应；此时只能由用户关闭并重开 Krita（未保存内容会丢）。日常关闭/保存请用 `doc_save` / `doc_close {save:true}`，或先询问用户。
- `filter` 先查 `filter_config` 拿到真实属性名/类型，再传 `config`；例如模糊用
  `{halfWidth,halfHeight,strength}`，HSV 用 `{h,s,v}`。部分滤镜无法导出配置
  （如 `halftone`）会返回 `UNSUPPORTED`，直接用默认参数或 `py`。
- `select_ellipse` / `select_polygon` 在 5.3 上没有对应 libkis API（`supported:false`）；用 `select_rect` 或 `py` 掩码。`combine_selections`、`fill_selection`、选区通道仍受上游 5.3 兼容问题影响，skill 给了 `py`/QAction 替代。
- `doc_close` 拒绝关闭有未保存修改的文档（`UNSAVED_CHANGES`），以避免模态保存对话框卡死主线程；先 `doc_save` 或传 `save:true`。
- 触发会弹对话框的 QAction 是异步的：只保证“已触发”，不等待用户操作。
- `save`/`doc_save` 会由 Host 自动建父目录，且 bridge 会校验 `exportImage` 真的写了文件；导出后仍应 `read_image` 验证。
- `seq` 不建立回滚快照；需要快照回滚时使用原有的 `batch` + `rollback`。
- `layer` 的 `parent`/`index` 重排没有 libkis API，返回 `UNSUPPORTED`；其余 layer 操作见 bridge README。
- 上游 `kritamcp` 的 `save` 语义是导出图片；原生 `.kra` 保存请用 `doc_save`。

## 参考与许可

- [krita-cli / krita-mcp](https://github.com/edithatogo/krita-cli) — Krita HTTP 桥与绘画动作（MIT，见 [THIRD-PARTY.md](THIRD-PARTY.md)）
- [Krita Python Scripting API](https://docs.krita.org/en/user_manual/python_scripting/)
- 本项目：MIT（见 [LICENSE](LICENSE)）

## 发布说明

- 只发布本目录 `dsh-krita/`；不要把工作区里的 `refs/`（含无许可证的参考项目）或用户级 skills 一起提交。
- 本项目与 Krita 项目、DeepSeek 官方无隶属关系；Krita 是其权利人的商标，本仓库不包含 Krita 官方素材。
- 本仓库不包含 Endfield UI skill（上游无根许可证）或 Emil Kowalski skills；如需附带后者，请保留其 MIT LICENSE 与出处。
- `tests/out/`、`*.kra~`、`node_modules/`、`__pycache__/` 已在 `.gitignore` 中排除。
