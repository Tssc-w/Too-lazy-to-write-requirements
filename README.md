# 图需工作台

多平台商品图研究与设计交接工具。提交一个我方商品链接和多条参考商品链接后，工作台会尝试读取网页实际返回的标题、品牌、价格、卖点、参数和图片；Amazon 保留专用解析，其他平台使用 Open Graph、Twitter Card 和 Schema.org Product 等常见商品元数据。每条链接都会显示读取方式、已返回字段和失败原因。

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

## AI 与采集配置

每位使用者都填写自己的 OpenAI 兼容 API Key 和 Base URL。个人 Key 只保存在当前浏览器标签页的 `sessionStorage`，通过 HTTPS 请求头发送给本服务，不写入服务端设置、任务记录或日志；关闭标签页后浏览器会清除。AI API Base URL 必须使用 HTTPS。AI 调用费用由使用者自己的 API 账户承担。

Bright Data Web Unlocker 是可选的个人回退采集服务。每位访客在「AI 与采集设置」中填写自己的 API Key 和 Zone；凭据只保存在该访客当前浏览器标签页的 `sessionStorage`，仅随其商品采集请求通过 HTTPS 发送，不写入共享配置、任务记录或应用日志。Bright Data 用量和费用由各访客自己的账户承担。没有配置个人 Bright Data 时，仍会尝试直接读取允许访问的页面。

## 发布到 Vercel

仓库已包含 `api/index.py` 和 `vercel.json`。Vercel 使用 Python Function 提供 API 和网页文件；采集与 AI 分析在单次请求内完成，分析所需的采集结果由浏览器随请求提交，不依赖函数实例之间共享内存或后台线程。

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
