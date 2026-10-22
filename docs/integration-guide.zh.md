# GPU 受保护租赁：对接说明（测试环境）

本文面向上游对接方：由对接方下单、向终端客户交付 GPU 服务器。机器丢失或被 AWS 回收时，
平台自动换机并恢复整机数据，客户使用的连接地址保持不变。

## 1. 环境与凭据

| 项目 | 测试环境 |
|---|---|
| 订单 API | `https://spotbot.test.vishwalab.com`（接口文档：`/docs`） |
| 连接查询 API（网关） | `https://gpu-gateway.test.vishwalab.com` |
| 客户 SSH 入口 | `gpu-ssh.test.vishwalab.com:<分配端口>` |
| 客户 HTTP 入口 | `https://r-<rental-id>.test.vishwalab.com` |
| 可用区域 | `us-west-2`、`us-east-1`、`us-east-2` |

平台会单独交付以下凭据，请保存在服务端密钥管理里，不要写进代码或前端：

- **租户 ID** 和 **租户令牌**：调用订单 API 时使用，只能看到和操作本租户的订单。
- **网关 API 密钥**：调用连接查询 API 时使用。

所有请求都要带上：

```
Authorization: Bearer <令牌>
X-SpotBot-Tenant: <租户 ID>
```

测试环境使用真实的 AWS 资源，测试订单也会产生真实费用，费用受订单里的价格上限和预算约束。

## 2. 典型流程

1. **下单**：`POST /v1/rentals`，请求头带 `Idempotency-Key`（用你们的订单号即可）。网络超时可以用同一个
   key 原样重试，不会重复购买；同一个 key 换了内容会返回冲突。
2. **轮询状态**：每 10–30 秒调用一次 `GET /v1/rentals/{id}`，直到 `state` 变成 `ACTIVE`。
   通常几分钟就能交付，但 AWS 容量紧张时，等待时间可能更长。
3. **获取连接信息**：调用 `GET /v1/gateway/rentals/{id}/connection`（网关 API），把返回的 SSH 主机、端口、
   用户名，以及 HTTP 地址和访问令牌展示给客户。**不要**把订单 API 里 `connection` 字段中的机器 IP
   给客户：换机后那个 IP 会变。
4. **使用中**：继续轮询。状态变成 `RECOVERING` 时提示客户"服务器正在切换，请稍后重连"；
   恢复到 `ACTIVE` 后，客户用**原来的地址**重新连接即可。
5. **续期**：`POST /v1/rentals/{id}/renew`，传入新版本的 RFQ（`rfq_version` 加 1，`expires_at` 延后），
   并带上 `expected_version`（当前的 `rfq_version`）。
6. **结束**：`POST /v1/rentals/{id}/release`；到达 `expires_at` 或预算用完时也会自动结束。
   结束时会先做最终备份，再按 `backup.final_retention_seconds` 保留一段时间后删除。

## 3. 下单字段（RFQ）

请求体为 `{"rfq": {...}}`。常用字段：

| 字段 | 说明 |
|---|---|
| `rfq_id`、`rfq_version`、`upstream_order_id` | 你们的订单标识，`rfq_version` 从 1 开始 |
| `regions` | 允许的区域，例如 `["us-east-1","us-west-2"]`；机器只会在这些区域开 |
| `gpu_model`、`gpu_count` | GPU 型号和数量，例如 `"L4"`、`1` |
| `min_gpu_memory_gib` | 每卡**标称**显存（GB），L4/A10G 填 24，T4 填 16，H100 填 80 |
| `instance_types` | 可选，限定机型，例如 `["g6.xlarge","g6.2xlarge"]`；不填则自动选 |
| `price_unit`、`max_price_hourly` | 固定填 `"instance_hour"`，单台每小时价格上限（美元） |
| `budget_usd` | 本订单总预算（美元），用完会自动结束 |
| `acquisition_deadline` | 首次开机的截止时间，到期还没拿到机器就结束订单 |
| `expires_at` | 订单到期时间（带时区的 ISO 8601），到期自动结束 |
| `root_volume_gib`、`data_disks` | 系统盘大小；数据盘，例如 `[{"device":"/dev/sdf","size_gib":100}]` |
| `ssh_key_name` | 登录密钥名称，见第 6 节 |
| `ssh_user` | 登录用户名，默认镜像为 `ubuntu` |
| `http_port`、`http_health_path` | 可选，客户的 HTTP 服务端口和健康检查路径；**填了就必须返回 200 才会交付** |
| `max_recovery_seconds` | 单次换机最多等待多久（默认 3600 秒），超时转人工处理 |
| `backup` | 备份策略：`interval_seconds`（默认 900）、`keep`、`final_retention_seconds` |

## 4. 订单状态

| 状态 | 含义 | 对客户的展示建议 |
|---|---|---|
| `QUEUED`、`WAITING_CAPACITY`、`PROVISIONING` | 正在申请机器 | 准备中 |
| `VERIFYING` | 机器已开机，正在自检和做首次备份 | 准备中 |
| `DELIVERING` | 等网关确认接入 | 准备中 |
| `ACTIVE` | 可以使用 | 运行中 |
| `RECOVERING` | 正在换机：机器被回收、丢失或手动请求恢复 | 切换中，稍后重连 |
| `ACTION_REQUIRED` | 需要平台人工处理（`error` 字段写明原因） | 异常，请联系平台 |
| `NEEDS_RECONCILIATION` | 购买结果不确定，平台正在核对 | 异常，请联系平台 |
| `ENDING`、`CLOSED` | 正在结束 / 已结束 | 已结束 |

`GET /v1/rentals/{id}/events` 可以查看订单的事件历史（例如 `rental.recovering`、`rental.active`、
`rental.degraded`），方便排查问题和做客户通知。

## 5. 换机与数据保障

- **不丢的**：系统盘和数据盘上已经写入的数据。换机后，文件内容、权限、属主都完全一致，SSH 主机密钥也不变。
- **会丢的**：内存、GPU 显存、正在运行的进程和网络连接。客户需要重新连接，并重启自己的程序。
- **耗时**：AWS 回收预警发出后，大约 2 分钟内完成最终备份；从开新机到交付大约 4–5 分钟。整体通常在
  5–15 分钟，**另外还要加上等 AWS 放出机器的时间**，容量紧张时可能更久。
- 客户可以在机器上放一个可执行脚本 `/etc/spotbot/pre-backup`，每次备份前会自动运行（限时 8 秒），
  用来让数据库之类的程序先把数据落盘。

## 6. 当前限制

- 只支持 AWS Spot 实例，每单一台 Linux 服务器。
- **SSH 公钥**：`ssh_key_name` 必须是平台事先在**每个可用区域**都导入好的 AWS 密钥对名称。
  目前还不支持在订单里直接传客户自己的公钥；需要给客户用自己的密钥时，请先联系平台导入。
- 只能在同一区域内换机；跨区域恢复目前未开启。
- 机器被回收期间，客户无法连接，也无法保证服务不中断。

## 7. 常见错误

| HTTP / `error` | 含义 |
|---|---|
| 401 / 403 | 令牌错误，或租户不匹配 |
| 404 `rental_not_found` | 订单不存在，或不属于本租户 |
| 409 `idempotency_key_conflict` | 同一个 `Idempotency-Key` 用了不同的内容 |
| 409 `region_not_enabled_for_rentals` | 下单的区域还未开通 |
| `aws_InsufficientInstanceCapacity` | AWS 暂时没有空闲机器，平台会自动重试 |
| `acquisition_limit_reached` | 在截止时间前没能拿到机器，订单已结束 |
| `gateway_ack_timeout` | 交付超时，转人工处理 |
| `recovery_wait_limit_reached` | 换机等待超过 `max_recovery_seconds`，转人工处理；数据仍然保留 |

## 8. 请求示例

```sh
curl -X POST https://spotbot.test.vishwalab.com/v1/rentals \
  -H "Authorization: Bearer $TENANT_TOKEN" -H "X-SpotBot-Tenant: $TENANT_ID" \
  -H "Idempotency-Key: order-10001" -H "Content-Type: application/json" \
  -d '{"rfq": {"rfq_id": "order-10001", "rfq_version": 1, "upstream_order_id": "order-10001",
       "regions": ["us-east-1", "us-west-2"], "gpu_model": "L4", "gpu_count": 1,
       "min_gpu_memory_gib": 24, "price_unit": "instance_hour", "max_price_hourly": "0.95",
       "budget_usd": "20", "acquisition_deadline": "2026-10-23T12:00:00Z",
       "expires_at": "2026-10-23T20:00:00Z", "ssh_key_name": "test", "ssh_user": "ubuntu",
       "root_volume_gib": 75, "data_disks": [{"device": "/dev/sdf", "size_gib": 100}]}}'

curl https://gpu-gateway.test.vishwalab.com/v1/gateway/rentals/$RENTAL_ID/connection \
  -H "Authorization: Bearer $GATEWAY_API_KEY" -H "X-SpotBot-Tenant: $TENANT_ID"
```
