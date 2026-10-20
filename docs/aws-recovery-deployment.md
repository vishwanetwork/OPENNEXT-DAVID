# AWS protected rental infrastructure

`infra/aws-rental-recovery.json` defines one regional interruption queue, one
dead-letter queue, an EventBridge rule, a DLQ alarm, and optional additive IAM
policies for an **existing** bot role. It creates no EC2 instances, IAM roles,
SSH keys, VPCs, security groups, DNS records, databases, or KMS keys. It does not
enable protected rentals or submit orders. Review a change set before execution.

## Review and deploy

1. Retain the existing approved launch/terminate policy and role attachment.
   Confirm it permits launching private restore AMIs and their owned snapshots,
   preserves the GPU/network/Region restrictions, and never passes the bot role
   to customer VMs. These launch permissions are not replaced by this template.
2. Deploy one stack per approved rental Region, using the intended AWS profile.
   Inspect parameters and resulting policies before executing the change set.
   With `ExistingBotRoleName` empty, no IAM policies are attached. Providing the
   role name adds the regional recovery, queue-consumer, and read permissions.
3. Keep `AllowCrossRegionCopies=false` for same-region recovery. For explicitly
   approved cross-region recovery, set it true and set `SourceRecoveryRegion`
   to the one allowed source Region. Deploy the corresponding policy in the
   destination Region, and the reverse policy only if reverse copying is needed.
   RFQ `allow_cross_region` and allowed order Regions still govern execution.
4. `KmsKeyArn` optionally grants use of an existing key through regional EC2 and
   AWS-resource grants. It does not change EBS encryption defaults or key policy.
   Configure and validate the actual account's encryption policy separately;
   source and destination key access may require additional explicit grants.
5. `AlarmTopicArn` optionally connects the DLQ alarm to an existing SNS topic.
   No subscriptions are created. Without it, the alarm is visible in CloudWatch
   but does not send notifications. Set an operational notification destination
   before relying on the alarm.
6. Read each stack's `InterruptionQueueUrl` output and configure the bot:

```dotenv
SPOTBOT_RENTAL_INTERRUPTION_QUEUES={"us-west-2":"https://sqs.us-west-2.amazonaws.com/ACCOUNT/QUEUE","us-east-1":"https://sqs.us-east-1.amazonaws.com/ACCOUNT/QUEUE"}
```

7. Run `spotbot rental-check --rfq /tmp/rental.json --aws --gateway` with the
   deployed role and configuration. Fix reported deficiencies, then validate
   IAM/KMS, actual guest boot, network, gateway delivery and disk restoration in
   a controlled live run. A syntax or policy validation pass proves neither
   real launch capacity nor successful recovery.

Read-only syntax validation:

```sh
aws cloudformation validate-template \
  --template-body file://infra/aws-rental-recovery.json --region us-west-2
```

Create a reviewable change set without executing it (this is a deployment
operation and should use the approved operator/profile):

```sh
aws cloudformation deploy \
  --template-file infra/aws-rental-recovery.json \
  --stack-name spotbot-rental-recovery \
  --region us-west-2 --capabilities CAPABILITY_IAM \
  --parameter-overrides ExistingBotRoleName=SpotOrderBotEC2Role \
  --no-execute-changeset
```

Use the returned change-set identity to inspect the changes in CloudFormation.
Execute only after the actual parameters and permission scope are approved.
Repeat for other approved Regions rather than giving wildcard regional access.

## Permission boundaries

Read actions use explicit action lists and the current Region. Volume capture
and preservation require the bot management tag and rental ownership tag.
New images/snapshots require management, rental and backup request tags. Cleanup
uses existing resource tags; standalone tagging of arbitrary existing resources
is not granted. Cross-region image copy is an optional separate policy limited
to one source Region and tagged destination resources in the stack Region.
KMS permissions are optional and key-specific. The role receives queue consume
permissions only for this stack's source queue and inspect permissions for its
rule. No `iam:PassRole`, IAM administration, launch permission expansion, or
network modification is introduced.

These boundaries apply to the **additional** policies only. Existing identity
policies, permission boundaries, organization SCPs, key policies, and resource
policies still affect the final authorization result. Application ownership
checks remain required; tags do not create isolated IAM principals per tenant.

## Delivery, alarms, and retirement

The enabled rule matches EC2 interruption warnings and state changes only from
the stack's account and Region. Queue policy grants EventBridge delivery from
that exact rule/account and denies non-TLS requests. Both queues use SQS-managed
encryption. EventBridge delivery failures and messages failing processing five
times are sent to the DLQ. Operators must investigate and deliberately replay
relevant events; the bot does not automatically consume the DLQ.

Source messages are retained for four days; DLQ messages for fourteen days. Both
queues are retained on stack deletion/replacement. Rule and IAM policy removal
can stop event delivery, recovery and cleanup, so drain rentals and retained
backups before retiring the stack. Inspect retained queues and remove them
explicitly when their data is no longer needed. CloudFormation deletion does
not delete GPU backup disks, AMIs, snapshots, or database records.

References: [EC2 action/resource authorization](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html),
[EventBridge queue policies](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-use-resource-based.html),
[CopyImage tagging](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CopyImage.html).
