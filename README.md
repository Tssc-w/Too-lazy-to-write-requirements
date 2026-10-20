# 图需工作台

多平台商品图研究与设计交接工具。提交一个我方商品链接和多条参考商品链接后，工作台会尝试读取网页实际返回的标题、品牌、价格、卖点、参数和图片；Amazon 保留专用解析，其他平台使用 Open Graph、Twitter Card 和 Schema.org Product 等常见商品元数据。每条链接都会显示读取方式、已返回字段和失败原因。

商品页和图片内容可识别简体/繁体中文、英语和韩语。套图分析会提取可辨认的图片文字，保留原文并为英语、韩语提供简体中文释义；导出的 Excel 会附带“中英韩图片文字识别”工作表。模糊或无法确认的文字不会猜测。

选择参考商品后，AI 将产品展示图与场景图合并，总结四条该类图片的共性，并为该合并类别提供两项类型级建议；其余出现的图片类型也各给两项建议。每类建议展示对应类型的竞品参考例图及来源链接。页面内容可编辑并导出到 Excel 模板；模板保留原有工作表并追加商品来源记录和 AI 套图分析。

## 本机运行

在 Windows PowerShell 中运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start.ps1
```

打开 `http://127.0.0.1:8766`。需要 Python 3.10+ 和 `openpyxl`；如提示依赖缺失，可运行 `python -m pip install -r requirements.txt`。

## 商品链接读取范围

接受任意平台的公开 `http://` 或 `https://` 商品页链接，不限制 Amazon。先尝试直连读取；直连失败时，使用当前访客自行提供的 Bright Data Web Unlocker 凭据重试。页面会保留两次尝试的状态和原因。仅支持公开网页：需要登录、验证码、JavaScript 才能生成商品内容、要求特定地区/会话，或主动禁止自动读取的页面仍可能失败；失败时会在对应商品卡和采集提醒中说明 HTTP 状态、域名解析、验证码、页面内容或服务配置等原因。工作台读取用户提供的链接，不自动搜索商品。

韩国站点回退会使用 Bright Data 的 `kr` 地区；Coupang 还会请求浏览器渲染，并展示 Web Unlocker 返回的目标站状态和错误码。若 Coupang 仍返回 HTTP 403，页面会说明目标站拒绝或 Bright Data Zone 功能配置问题，用户可据此检查自己的 Zone；访问限制仍可能导致无法读取。

## AI 与采集配置

每位使用者都填写自己的 OpenAI 兼容 API Key 和 Base URL。个人 Key 只保存在当前浏览器标签页的 `sessionStorage`，通过 HTTPS 请求头发送给本服务，不写入服务端设置、任务记录或日志；关闭标签页后浏览器会清除。AI API Base URL 必须使用 HTTPS。AI 调用费用由使用者自己的 API 账户承担。

Bright Data Web Unlocker 是可选的个人回退采集服务。每位访客在「AI 与采集设置」中填写自己的 API Key 和 Zone；凭据只保存在该访客当前浏览器标签页的 `sessionStorage`，仅随其商品采集请求通过 HTTPS 发送，不写入共享配置、任务记录或应用日志。Bright Data 用量和费用由各访客自己的账户承担。没有配置个人 Bright Data 时，仍会尝试直接读取允许访问的页面。

## 发布到 Vercel

仓库已包含 `api/index.py` 和 `vercel.json`。Vercel 使用 Python Function 提供 API 和网页文件。商品采集按链接单独请求；AI 按每批 4 张图片独立识别，最后单独汇总。浏览器最多并行两批，每批完成即保存在当前标签页的 `sessionStorage`；刷新后可恢复，24 小时内继续会复用成功批次，只重试未完成部分。关闭标签页或清除浏览器存储会失去恢复数据。个人 Key 不写入业务草稿、服务端任务或日志。

每次请求限制 3 MB、上游 AI 响应限制 2 MB、导出最多 200 行；单次处理预算 190 秒，携带凭据的 API 请求只支持公网 HTTPS（443/8443），不跟随重定向。反爬页面、AI 空对象或缺失图片记录不会被当作成功。接口包含每实例并发与访客请求限流；大规模公开服务仍应在 Vercel Firewall 配置跨实例限流。日志仅记录请求编号、接口路径、状态与耗时。

`GET /healthz` 返回部署版本、模板状态和批大小。旧的整次 `/api/research`、`/api/analyze` 和共享 `/api/jobs/*` 已停用，旧页面需要刷新。新接口为 `/api/research/link`、`/api/analyze/batch`、`/api/analyze/summary`。不需要新增付费服务或共享 API Key 即可使用此恢复流程。

回归验证：`python -m unittest discover -s tests -v`；`node --check web/app.js`。浏览器恢复与实际导出验证使用 `node tests/browser_reliability.cjs`（需本地服务在 18766 和 Chrome；外部 AI/采集响应使用测试桩，不消费个人 API 额度）。

1. 将项目推送到一个 GitHub 仓库（建议设为 Private），不要提交 `.env`、API Key、`outputs/` 或 `node_modules/`。
2. 在 Vercel 选择 **Add New → Project**，连接该 GitHub 仓库并部署。Vercel 会提供 `*.vercel.app` HTTPS 地址，不需要购买域名。
3. 在 Vercel 项目 **Settings → Environment Variables** 中按需配置：

   - `OPENAI_API_BASE_URL`：可选，个人设置页默认的 API 地址；默认 `https://api.apimart.ai/v1`。
4. 保存环境变量后，在 Vercel 触发一次 Redeploy。检查站点首页及 `/healthz`；在线读取商品和 AI 分析还需要访客分别提供可用链接、自己的 AI Key，以及可选的 Bright Data 凭据。

`vercel.json` 将函数最大执行时间设为 300 秒。Vercel 账号方案会决定实际可用上限；如果方案上限更低，较慢的商品网站或 AI 服务可能超时。Vercel 的免费方案条款也可能限制商业用途，面向业务用户长期开放前应按其当前条款选择方案。

## 当前流程

1. 填写我方链接（可选）和参考链接（每行一条，最多 20 条），点击“读取商品信息与图片”。
2. 在商品卡中选择至少一个有图片的参考商品。
3. 配置 AI API 后点击“联合分析所选套图”。
4. 编辑类型建议后，点击“填写模板并下载 Excel”。

未填写我方链接时只提供参考商品分析。商品页未返回的字段会显示为缺失，不猜测补造。图片观察与设计建议需人工核对。
