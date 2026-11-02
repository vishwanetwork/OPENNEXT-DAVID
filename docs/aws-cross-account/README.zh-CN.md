# AWS 跨账号 Bot 专用角色创建与交接说明

适用对象：持有 B300 配额的 AWS 账号管理员，以及负责现有 SpotOrderBot 的运维人员。

目标：Bot 继续在现有服务器运行，通过 AWS STS 临时身份进入新账号，在新账号创建和管理 GPU Spot 实例。实例、磁盘和快照的费用由新账号承担。不需要交付 AWS 登录密码、Access Key、Secret Key 或 SSH 私钥。

## 1. 双方分别需要做什么

| 负责人 | 工作 |
| --- | --- |
| 新账号管理员 | 创建目标角色、配置可信调用方和运行权限，准备新账号网络及恢复基础设施，交付参数 |
| 现有 Bot 管理员 | 核实源角色 ARN，为源角色授权 `sts:AssumeRole`，配置 Bot 使用目标角色，验证账号、网络、采价、下单和恢复 |

**目标角色建好不代表已经切换。** 跨账号访问需要双方授权；仅把 Role ARN 发来，也不能绕过缺失的网络、配额或镜像配置。角色创建本身不会启动 GPU，也不会迁移原账号资源。

本文附件中的 `__PLACEHOLDER__` 必须替换，不能原样提交给 AWS。权限模板按 AWS 商业区 `arn:aws` 编写，不适用于中国区或 GovCloud。

## 2. 创建前确认

请双方先交换下面的信息：

| 参数 | 说明 |
| --- | --- |
| `__SOURCE_ROLE_ARN__` | 现有 Bot 服务器实际绑定的 IAM 角色完整 ARN，必须由 Bot 管理员确认；角色名称预计为 `SpotOrderBotEC2Role`，不要使用整个源账号的 root ARN 代替 |
| `__TARGET_ACCOUNT_ID__` | 持有 B300 配额的 12 位 AWS 账号 ID |
| `__REGION__` | 配额实际所在区域，例如 `us-west-2`，不能只说“美国区” |
| `__EXTERNAL_ID__` | 双方为此次接入约定的唯一随机字符串，例如由 Bot 管理员生成 UUID；不是 AWS 密码，也不能代替可信角色限制 |
| `__SUBNET_ID__` / `__SECURITY_GROUP_ID__` | 新账号中准备给 GPU 使用的子网与安全组 |
| `__KEY_PAIR_NAME__` | 新账号、目标区域中导入的 SSH 公钥名称；私钥留在 Bot/网关侧 |

请提供 B300 **配额名称、区域、已批准数值及当前用量**，明确是 Spot 还是 On-Demand。当前 Bot 购买 Spot，不会因为 Spot 不可用而自动购买 On-Demand。`p6-b300.48xlarge` 为 8 张 B300、192 vCPU，配额要覆盖整台实例所需资源；有配额仍可能遇到库存不足。不要把单 GPU 展示单价当成整台机器的小时费用。

## 3. 新账号管理员：创建目标角色

### 3.1 创建信任关系

1. 登录持有 B300 配额的新账号，进入 **IAM → Roles → Create role**。
2. 选择 **Custom trust policy**，使用附件 `target-trust-policy.json`。
3. 将 `__SOURCE_ROLE_ARN__` 和 `__EXTERNAL_ID__` 替换为双方确认的值。
4. 角色命名为 `SpotOrderBotCrossAccountRole`，最大会话时长设为 1 小时即可。
5. 不要给后台自动运行的这个角色设置交互式 MFA 条件，否则 Bot 无法自动续期。管理员本人登录账号仍应遵循组织的 MFA 要求。

该信任关系仅允许指定源角色通过 `sts:AssumeRole` 使用目标角色。不要选择普通 EC2 服务信任关系：本方案不是把目标角色绑定到新 GPU 机器，也不要把 Bot 管理角色挂到客户 GPU 实例上。

### 3.2 添加运行权限

附件 `target-launch-policy.json` 是 B300 Spot 的基础运行权限模板。替换账号、区域、子网、安全组及 SSH 公钥名称后：

1. 进入 **IAM → Policies → Create policy → JSON**。
2. 粘贴替换后的模板，检查 IAM 给出的错误或警告，创建客户托管策略，例如 `SpotOrderBotB300Launch`。
3. 将该策略附加到 `SpotOrderBotCrossAccountRole`。

模板限定：

- 只能在指定区域创建 `p6-b300.48xlarge` Spot；实例必须要求 IMDSv2，并在创建时带 `spotbot-managed=true`。
- 仅使用指定子网、安全组和 SSH 公钥。初始镜像和恢复镜像通过 AMI 资源授权；模板允许目标区域内的 AMI，并依赖 Bot 的镜像/备份归属校验。管理员可按实际基础镜像和恢复需求进一步收窄。
- 只允许终止带 `spotbot-managed=true` 的实例。标签是平台管理边界，不是不同租户之间的 IAM 身份隔离。
- 允许读取实例、配额、价格及默认 GPU 镜像参数；只读查询部分按照 AWS API 要求使用 `Resource: "*"`。
- 不包含 IAM 管理、`iam:PassRole`、创建/修改网络、On-Demand 下单或任意现有资源补打管理标签的权限。

**本模板仅包含基础启动/释放权限，不能替代下面的快照恢复权限。** 组织 SCP、权限边界、KMS 策略、AMI 许可和实际 AWS 容量仍可能阻止运行。

### 3.3 确认 Spot 服务关联角色

在 IAM 中检查 `AWSServiceRoleForEC2Spot` 是否已存在；没有时，由新账号管理员执行：

```sh
aws iam create-service-linked-role --aws-service-name spot.amazonaws.com
```

已有时无需重复创建。不要把 `iam:CreateServiceLinkedRole` 授给 Bot 来代替管理员完成初始化。

## 4. 新账号管理员：准备网络、镜像与恢复基础设施

### 4.1 网络与 SSH

- 准备目标区域中的 VPC、子网及专用 GPU 安全组，例如 `spotbot-gpu`。
- 当前默认使用公网 IP，子网需要 Internet Gateway 路由；如采用私网，则另行验证网关访问及实例出站能力。
- GPU 的 SSH 22 端口仅允许现有网关服务器的实际出口 IP；客户通过网关访问 GPU，不需要把 GPU SSH 向全网开放。
- GPU 需要能够通过 HTTPS 访问现有 Bot 的实例代理接口并下载工作负载依赖；额外业务端口按需授权。
- 导入 Bot 管理员提供的 SSH **公钥**，回传 Key Pair 名称。不要要求传输私钥。
- 不同账号中可用区名称可能对应不同物理区域，网络与库存以新账号实际返回为准。

当前采集器在配置 VPC 内，为每个可用区自动选取一个子网。如果 IAM 只批准特定子网，请使用专用 VPC，或由双方验证采集器选中的子网与获批子网一致；不要假设给一个子网 ID 就会自动强制采集器选择它。多子网授权时，可在策略的 subnet 资源列表中逐项增加获批 ARN。

### 4.2 快照和中断恢复

完整业务需要在**新账号、每个启用租赁的区域**部署附件 `aws-rental-recovery.json`。这是已有项目的恢复基础设施模板，包含加密 SQS 队列、死信队列、EventBridge 中断/状态事件规则、告警，以及附加到现有角色的恢复权限。

该模板不会创建目标角色，不会创建 GPU 或修改网络；请先完成角色与基础启动权限。

可以在 **CloudFormation → Create stack → Upload a template file** 上传附件，也可以由管理员在目标账号对应的 CLI 身份下执行：

```sh
aws cloudformation deploy \
  --template-file aws-rental-recovery.json \
  --stack-name spotbot-rental-recovery-b300 \
  --region __REGION__ \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    ExistingBotRoleName=SpotOrderBotCrossAccountRole \
    AllowCrossRegionCopies=false \
  --no-execute-changeset
```

检查变更集后，由新账号管理员执行。记录 Outputs 中的 `InterruptionQueueUrl`、`InterruptionRuleName` 和 `DeadLetterQueueUrl`。跨区域恢复默认关闭。

若使用客户管理 KMS 密钥：设置模板参数 `KmsKeyArn`，同时检查密钥策略，以及 `AWSServiceRoleForEC2Spot` 使用该密钥的权限。单独附加 IAM 策略不保证可以使用密钥。若有 SNS 运维通知主题，可以填写 `AlarmTopicArn`；不填则告警不会自动发邮件。

推荐准备新账号自有、加密且支持 B300 的干净 GPU 基础 AMI，并在镜像及其快照上标记：

```text
spotbot-managed=true
spotbot-initial-image=true
```

镜像需要支持 B300 的驱动、CUDA 和启动方式，并清除原 SSH 授权、主机身份及客户数据。不要把客户备份标成共用基础镜像。使用已有公有 GPU AMI可先验证启动，但不代表已经满足增量备份的基础镜像要求。基础镜像制作说明见包内 `aws-recovery-deployment.md` 的最后一节；制作过程属于管理员另行执行的初始化操作，Bot 角色本身不具备创建普通构建机器的权限。

## 5. 新账号管理员交付给我们什么

请填写 `handoff.txt` 后发送给 Bot 管理员：

```text
Target AWS account ID:
Target role ARN:
External ID:
Approved region:
Allowed instance types: p6-b300.48xlarge
Spot quota name / quota code:
Approved Spot vCPUs / currently used vCPUs:
VPC ID:
Approved subnet IDs / Availability Zones:
GPU security group ID:
SSH key pair name:
Base AMI ID / SSH user / required root disk size:
EBS KMS key ARN or default encryption details:
Recovery CloudFormation stack name:
InterruptionQueueUrl:
InterruptionRuleName:
DeadLetterQueueUrl:
Alarm notification destination:
Any SCP / permission boundary / network restrictions:
```

不需要交付长期 AWS 密钥、AWS 控制台密码、临时 STS 密钥或 SSH 私钥。Role ARN 和账号 ID 本身不是登录密码；External ID 也不应当成独立凭证使用。

## 6. 我们这边仍然需要完成的配置

### 6.1 允许现有 Bot 使用目标角色

将附件 `source-assume-role-policy.json` 中的目标 Role ARN 和 External ID 替换后，附加到**现有 Bot 服务器的源角色**。这一步需要源账号管理员权限，新账号管理员不能只在自己账号中完成双方授权。

### 6.2 配置 Bot 的 AWS SDK

在 Bot 服务器准备只读 AWS config 文件，例如 `/opt/spotbot-aws/config`：

```ini
[profile spotbot-b300]
role_arn = arn:aws:iam::__TARGET_ACCOUNT_ID__:role/SpotOrderBotCrossAccountRole
credential_source = Ec2InstanceMetadata
external_id = __EXTERNAL_ID__
region = __REGION__
duration_seconds = 3600
role_session_name = spotbot-b300
```

把该文件只读挂载到 Bot 容器 `/app/aws/config`，并设置容器环境变量：

```dotenv
AWS_PROFILE=spotbot-b300
AWS_CONFIG_FILE=/app/aws/config
SPOTBOT_AWS_REGIONS=__REGION__
SPOTBOT_AWS_VPC_ID=__VPC_ID__
SPOTBOT_AWS_SECURITY_GROUP_IDS=__SECURITY_GROUP_ID__
SPOTBOT_AWS_KEY_NAME=__KEY_PAIR_NAME__
SPOTBOT_AWS_IMAGE_ID=__BASE_AMI_ID__
SPOTBOT_AWS_SSH_USER=ubuntu
SPOTBOT_RENTAL_REGIONS=__REGION__
SPOTBOT_RENTAL_INITIAL_IMAGES={"__REGION__":"__BASE_AMI_ID__"}
SPOTBOT_RENTAL_INTERRUPTION_QUEUES={"__REGION__":"__INTERRUPTION_QUEUE_URL__"}
```

SSH 用户和磁盘大小以实际 AMI 为准；上面的配置是接入增量，不是完整服务配置。保留已有数据库、租户、代理及网关设置。不要误删其他已启用厂商。

当前 Boto3 默认会话支持这个配置，并能自动刷新临时凭证；仅填写 `AWS_ROLE_ARN` 并不能完成本方案。确保没有旧的 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN` 环境变量覆盖角色配置。EC2 metadata 必须能从 Bot 容器访问，不能把服务换到本机后仍假设 `Ec2InstanceMetadata` 有效。本机验证需要另一个有 `sts:AssumeRole` 权限的源 profile。

修改容器配置后要重新创建容器，普通 restart 不会读取新的环境变量和挂载。此文档不自动修改任何线上配置。

### 6.3 验证与切换

1. 在**与 Bot 相同的容器、用户及环境变量**下调用 STS `GetCallerIdentity`，核对返回的新账号 ID，以及 `assumed-role/SpotOrderBotCrossAccountRole/…` 身份。不要只检查电脑上的 CLI。
2. 验证可读 B300 规格、当前 Spot 价格、P Spot 配额及用量；等待采价刷新，确认新目录使用新账号网络资源，不能沿用旧账号缓存报价直接下单。
3. 验证镜像、子网、公钥、安全组、KMS、SQS/EventBridge、实例回调和网关配置。使用现有 `spotbot rental-check --rfq /path/to/rental.json --aws --gateway` 预检；RFQ 及测试费用上限由我们准备。
4. 在明确整台每小时费用、总预算及释放条件后，再做受控真实创建、网关连接、快照恢复和释放验证。文档编写与角色创建不代表已完成这些真实验收。
5. 审计是否有旧账号运行中订单、待抢单、待恢复租赁及保留备份。当前 Bot 没有按订单路由 AWS 账号的能力，直接换默认身份会影响旧资源管理。应先清空旧任务，或由我们单独部署新账号 Bot 并隔离任务/数据；不要让两个 worker 共用旧任务库争抢同一任务。
6. 如果 Bot 使用 DynamoDB 或其他依赖默认 AWS 身份的服务，切换 profile 也可能影响这些服务。现有 MySQL 可继续保持独立；DynamoDB 等服务要另行设计跨账号权限，不能假设这套 EC2 权限覆盖它们。

## 7. 随包文件

| 文件 | 用途 |
| --- | --- |
| `README.zh-CN.md` | 本中文说明 |
| `target-trust-policy.json` | 新账号目标角色的信任关系 |
| `target-launch-policy.json` | 新账号目标角色的 B300 Spot 基础运行权限 |
| `source-assume-role-policy.json` | 源账号角色使用目标角色的权限 |
| `aws-rental-recovery.json` | 随交接包附带的现有区域恢复 CloudFormation 模板 |
| `aws-recovery-deployment.md` | 随交接包附带的已有恢复部署及干净基础镜像说明（英文） |
| `handoff.txt` | 管理员回填的参数清单 |

JSON 中的占位符可以通过文本编辑器替换。基础模板按单区域、单子网、单安全组和 B300 型号编写；增加资源时需同步调整策略与实际 Bot 配置。模板已做本地结构检查，但尚未在新账号通过 IAM 校验或完成真实启动验证。

## AWS 官方参考

- [跨账号角色需要双方授权](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic-cross-account.html)
- [Boto3 AssumeRole 凭证配置与续期](https://docs.aws.amazon.com/boto3/latest/guide/credentials.html)
- [EC2 RunInstances 权限示例](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ExamplePolicies_EC2.html)
- [Spot 服务关联角色与加密密钥授权](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/service-linked-roles-spot-instance-requests.html)
- [EC2 加速实例规格及 Spot 支持](https://docs.aws.amazon.com/ec2/latest/instancetypes/ac.html)

