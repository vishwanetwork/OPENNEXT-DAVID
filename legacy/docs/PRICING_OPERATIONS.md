# 定价采集与后台操作

## 当前可以使用的部分

- 在 `/admin/#pricing` 查看 24 家供应商注册卡片。卡片分别显示接入状态、开关、周期、最后采集状态与真实记录数。
- AWS 已接公开 On-demand：默认八个区域，Linux / shared / 无附加软件，按整机价格除以经过确认的物理 GPU 数量。未知 GPU 规格被排除，并列入采集日志。使用 AWS 公开定价页 CDN 数据；该 JSON 格式不是有版本保证的正式 API，需监控结构变化，官方 Bulk API 作为后续替代源。
- Vultr 已接公开 GPU bare-metal 目录，保留源中提供的 On-demand / preemptible 价格，不能据此认定库存。
- Lambda、Shadeform 的采集适配器已实现。配置新密钥后先点击 Test & collect，再查看价格与日志。注册供应商不等于已完成接入；其它适配器显示 Setup required。
- 图表仅使用 AWS 的真实观测。On-demand 通常不频繁变价，因此曲线可能平直；历史不足时只有一个点。不得用当前价生成过去走势。

## 操作流程

1. 点击供应商 Configure，查看支持的价格类型、覆盖范围与官方 API 文档。
2. 对需要授权的 Lambda / Shadeform，填写重新签发的只读密钥，点击 Save to server memory。本次进程结束后即失效；浏览器不保存密钥。
3. 点击 Test & collect，进入运行日志。采集为异步任务；点击 Refresh log 更新状态。
4. 完成后进入 View prices，检查 GPU、区域、租用方式、卡数、整机小时价与每卡小时价。
5. 设置采集开关与周期（10–1440 分钟），保存。失败会保留上次成功缓存，并标注 stale / failed / completed with gaps。
6. Terminal 从 `/api/pricing/prices` 查询同一份缓存，从 `/api/pricing/history` 获取 AWS 曲线。任何价格都不自动代表可成交、可交付或供应商评级。

## 服务端环境

复制 `.env.example` 到私有 `.env` 并在部署环境中填值。不要提交 `.env`。普通 `npm start` 不会自动读取 `.env`；Node 20.6+ 可用 `node --env-file=.env OpenNEXT-preview-server.cjs`，或由运行环境注入。Docker Compose 自动读取项目 `.env` 的变量，并将价格缓存保存到命名卷。

| 变量 | 作用 |
| --- | --- |
| `OPENNEXT_PRICING_DATA_DIR` | 私有缓存、原始响应与历史目录，默认 `.opennext-data` |
| `OPENNEXT_AWS_REGIONS` | 逗号分隔区域，默认八个已验证区域 |
| `LAMBDA_API_KEY` | Lambda Bearer 凭据 |
| `SHADEFORM_API_KEY` | Shadeform X-API-KEY 凭据 |
| `OPENNEXT_ADMIN_TOKEN` | 至少 24 字符的独立后台管理口令，与供应商 Key 分开 |
| `OPENNEXT_TRUST_PROXY` | 只有在服务被隔离于可信 HTTPS 反向代理后时设为 `1`；代理必须覆盖转发头 |
| `OPENNEXT_AWS_SPOT_ENABLED` | 当前 `0`；AWS IAM 完成后才设 `1` |

直接访问本机 localhost 的定价后台可操作。远程访问需 HTTPS、服务端管理口令和短期 HttpOnly / SameSite Strict 会话。`terminal.opennextlab.ai` 拒绝后台 API。该机制只保护价格采集接口，不等同于整个企业后台的用户体系。

上传图片中出现过的供应商密钥应先在对应平台撤销并重发。代码、测试、仓库与日志均不应包含它们。供应商密钥只传向固定供应商 API 的认证头，不用于创建/支付/启动实例。

## AWS Spot 后续接入

1. 在服务端安装可选依赖 `@aws-sdk/client-ec2`。
2. 配置 IAM Role 或 AWS 标准服务端凭据链，授权 `ec2:DescribeSpotPriceHistory`。不在前端填写 Access Key。
3. 设置 `OPENNEXT_AWS_SPOT_ENABLED=1`，重启后手动采集 AWS。
4. 核对返回的区域/AZ、实例规格、币种、时间以及每实例/每 GPU 单位。AWS Spot 官方历史最多 90 天；目录价格不保证可以成功启动实例。

Reserved / Savings Plans 需要另外处理承诺期限、预付款和付款方式，当前不把它们压成一个可比较的折扣小时价。其它提供商的历史接口与价格类型见 [完整 API 清单](PROVIDER_APIS.md)。

## OpenNEXT API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/pricing/prices` | 当前实际价格；支持 provider、gpuModel、gpuMemoryGb、formFactor、region、term、gpuCount、limit |
| `GET /api/pricing/history` | AWS 观测序列；支持上述规格过滤和 period=1D/1W/1M/3M/1Y |
| `GET /api/pricing/status` | 公开的来源状态与实际记录数 |
| `GET /api/admin/pricing/providers` | 供应商配置与授权是否配置，不返回凭据 |
| `PATCH /api/admin/pricing/providers/:id` | 保存 enabled / intervalMinutes |
| `POST /api/admin/pricing/providers/:id/credential` | 保存当前服务进程内存凭据 |
| `POST /api/admin/pricing/providers/:id/run` | 启动异步只读采集，相同供应商并发去重 |
| `POST /api/admin/pricing/providers/:id/test` | 通过实际采集验证权限与数据格式 |
| `GET /api/admin/pricing/runs` | 最近运行列表 |
| `GET /api/admin/pricing/runs/:id` | 脱敏运行详情 |

公共价格最多返回 5,000 条，当前范围足够；超过时 `meta.truncated` 会明确提示。当前 JSON 存储适合单进程原型，历史保留 365 天且设总量上限；扩到全区域/高频生产采集前应迁移数据库与任务队列。不要运行多个进程共享同一个 JSON 目录。
