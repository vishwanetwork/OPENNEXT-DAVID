# AWS B300 接入准备清单

请在有 B300 配额的 AWS 账号中完成以下配置，再把最后的参数清单发给我们。我们收到后会配置到测试环境 SpotBot，完成连接、下单和恢复验证。你不需要操作我们的服务器。

机器、磁盘、快照等费用会记在你的 AWS 账号。创建角色和授权本身不会启动 GPU。

## 1. 确认 B300 配额

请确认配额所在区域，以及配额是 **Spot 还是 On-Demand**，提供配额名称、已批准数值及当前用量。

我们目前购买 Spot。`p6-b300.48xlarge` 是整台 8 张 B300、192 vCPU，剩余 Spot 配额需要能覆盖整台机器。On-Demand 配额不能代替 Spot 配额；有配额也仍可能遇到库存不足。

以下先按一个 AWS 商业区域配置，例如 `us-west-2`。如果配额在其他区域，以实际区域为准。

## 2. 创建 Bot 专用角色

1. 打开 **IAM → Roles → Create role**。
2. 选择 **Custom trust policy**，粘贴附件 `target-trust-policy.json` 的完整内容。
3. 角色名称填写 `SpotOrderBotCrossAccountRole`，最大会话时长 1 小时即可。
4. 此角色供后台自动运行，不要添加需要人工输入验证码的 MFA 条件，也不要把它绑定到客户 GPU 机器。

信任配置已经填好，可以直接使用：

| 配置项 | 已提供的值 |
| --- | --- |
| 允许连接的角色 ARN | `arn:aws:iam::860165147463:role/SpotOrderBotEC2Role` |
| External ID | `spotbot-b300-92cdbb87-0ce5-453f-9152-e3a891550a13` |

不需要创建 IAM 用户，也不需要生成 Access Key 或 Secret Key。

## 3. 准备 GPU 网络、公钥和基础镜像

在配额所在区域准备：

- 一个 VPC、可用子网和专用安全组。使用公网 IP 时，子网需要 Internet Gateway 路由。
- 安全组入站 SSH 22 仅允许我们的测试网关 `44.248.155.24/32`；请勿向全网开放。实例需要能通过 HTTPS 出站访问 Bot 和下载依赖。
- 一个 SSH Key Pair。导入我们提供的 SSH **公钥**即可，不需要交换私钥；公钥我们另行提供。
- 一个兼容 B300 驱动/CUDA 的 Linux GPU AMI，记录 AMI ID、SSH 用户和所需根盘大小。

为了支持整机快照恢复及后续增量备份，请优先使用本账号自有的加密、干净基础 AMI，并在基础 AMI 和它的快照上添加：

```text
spotbot-managed=true
spotbot-initial-image=true
```

基础 AMI 应清除原有 SSH 授权、主机身份和客户数据，不能用客户备份作为共用基础镜像。如果暂时没有这种 AMI，回传时注明，我们再确认准备方式；此时不能视为已经具备完整恢复条件。

如果没有现成网络，可以新建一个专用 VPC。Bot 会在配置的 VPC 内按可用区自动选取子网，请让 VPC 内可被选中的子网具备所需路由，并把这些子网都列入下面的权限策略，避免随机选中未授权子网。

## 4. 给角色添加运行权限

打开附件 `target-launch-policy.json`，替换以下值：

| 占位符 | 替换内容 |
| --- | --- |
| `__TARGET_ACCOUNT_ID__` | 你的 12 位 AWS 账号 ID |
| `__REGION__` | B300 配额所在区域 |
| `__SUBNET_ID__` | 上一步准备的子网 ID |
| `__SECURITY_GROUP_ID__` | GPU 安全组 ID |
| `__KEY_PAIR_NAME__` | 导入的 SSH 公钥名称 |

有多个子网时，在策略的 subnet 资源列表中逐项增加对应 ARN。

然后进入 **IAM → Policies → Create policy → JSON**，粘贴替换后的内容，创建策略 `SpotOrderBotB300Launch`，并附加到 `SpotOrderBotCrossAccountRole`。

该策略允许查询价格、规格和配额，以及在指定区域、网络中创建 B300 Spot 和释放带 Bot 管理标签的实例；不授予 IAM 管理、修改网络或 On-Demand 下单权限。完整恢复权限由下一步的模板附加。其他已有策略、权限边界、组织限制及密钥策略也会影响实际权限。

请在 IAM 中确认 `AWSServiceRoleForEC2Spot` 已存在。没有时，可执行：

```sh
aws iam create-service-linked-role --aws-service-name spot.amazonaws.com
```

已有则跳过。

## 5. 配置中断通知和快照恢复权限

在目标区域打开 **CloudFormation → Create stack → Upload a template file**，上传附件 `aws-rental-recovery.json`。

填写：

| 参数 | 值 |
| --- | --- |
| Stack name | `spotbot-rental-recovery-b300` |
| ExistingBotRoleName | `SpotOrderBotCrossAccountRole` |
| AllowCrossRegionCopies | `false` |
| SourceRecoveryRegion | 保持默认；关闭跨区域复制时不使用 |
| KmsKeyArn | 有客户管理 EBS 密钥时填写，否则留空 |
| AlarmTopicArn | 有运维 SNS 告警主题时填写，否则留空 |

检查变更内容，勾选允许创建带名称 IAM 资源的确认项后创建。

模板会创建 SQS 中断队列、死信队列、EventBridge 规则和告警，并为角色添加带管理标签资源的磁盘保留、快照、恢复镜像及清理权限。模板不会创建 GPU、角色、网络或基础 AMI。队列和快照可能产生少量存储/请求费用；未填写 SNS 时，告警不会自动发送邮件。

如果使用客户管理 KMS 密钥，还需要允许该角色及 `AWSServiceRoleForEC2Spot` 使用密钥；仅附加 IAM 策略不一定足够，需同时检查密钥策略或授权。

完成后，保存 Outputs 中的 `InterruptionQueueUrl`、`InterruptionRuleName` 和 `DeadLetterQueueUrl`。

## 6. 把这些参数发给我们

填写附件 `handoff.txt` 后发回即可：

- AWS 账号 ID、区域。
- 新角色完整 ARN，通常为 `arn:aws:iam::你的账号ID:role/SpotOrderBotCrossAccountRole`。
- B300 Spot 配额名称、额度及当前用量。
- VPC ID、获批子网 ID 和可用区、安全组 ID。
- SSH Key Pair 名称。
- 基础 AMI ID、SSH 用户、根盘大小及 EBS 加密方式/KMS Key ARN；未准备的请注明。
- 恢复栈名称，以及上述三个输出值。
- 如有组织权限边界、网络限制或额外 KMS 限制，一并说明。

External ID 已在附件中固定，无需再生成。不要发送 AWS 登录密码、Access Key、Secret Key、临时会话密钥或 SSH 私钥。

到这里你这边的工作就完成了。后续测试环境 SpotBot 的配置和验证由我们处理；请先不要手动创建真实 B300 实例。

## 附件

| 文件 | 用途 |
| --- | --- |
| `target-trust-policy.json` | 创建角色时直接粘贴的信任策略，已填好我们的连接身份 |
| `target-launch-policy.json` | 按你的账号及网络替换占位符后，附加到角色的基础权限 |
| `aws-rental-recovery.json` | 上传到 CloudFormation 的恢复基础设施模板 |
| `handoff.txt` | 完成后填写并发回的参数清单 |

权限模板已做本地结构检查，尚未在你的账号验证，若 AWS 控制台报错，请把错误信息发给我们。

官方参考：[跨账号角色授权](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html)、[Spot 服务关联角色和 KMS](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/service-linked-roles-spot-instance-requests.html)、[B300 规格](https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html)。
