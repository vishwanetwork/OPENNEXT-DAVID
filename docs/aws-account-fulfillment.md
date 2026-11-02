# Account-bound AWS fulfillment

GPU Market offers require actual launch eligibility. Cross-account price references
remain non-orderable; they are never promoted into purchasable inventory.

Additional fulfillment accounts are operator-enrolled in `SPOTBOT_AWS_ACCOUNTS`.
Each named enrollment fixes an expected AWS account ID, SDK profile, one Region,
an instance-type allowlist, launch network, key pair, base AMI and interruption queue.
The SDK identity must match the expected account before any EC2 client is used.
The default SDK identity and existing deployment settings remain unchanged.

Each account has an independent AWS provider and rental engine, sharing the existing
transactional store and tenant authorization. Catalog identities include the account
alias. The allowlist limits which account publishes each Region/SKU combination.
Legacy unprotected `/v1/orders` cannot create from an additional-account offer.

The accepted RFQ's `account` field selects and permanently records the enrollment.
For existing web clients that submit `account=default`, an explicit Region/SKU
combination enrolled in another account is resolved before accepting the RFQ.
Idempotent replays resolve against the stored rental's account. Existing rentals
without an account field retain `default`; revisions cannot change accounts.
Candidates, quota checks, images, instances, snapshots, cleanup and interruption
queues all use the selected engine. The gateway continues to receive the same
tenant-scoped delivery and acknowledgement payloads; guests receive no AWS keys.

Account removal fails closed for cloud operations while historical records remain
readable. An unknown account is never silently treated as the default account.
Each account's lifecycle worker handles only its own rentals and interruption
events. Failure in one account does not stop the other account's worker.

Enrollment does not prove stock. Before exposing a new account, validate its
identity, scoped IAM, network, compatible clean AMI, encrypted EBS/KMS access,
account-bound interruption rule/queue and gateway connectivity. A controlled paid
acceptance must separately verify boot, SSH delivery, interruption/replacement,
disk restoration and release within the approved budget. Price references alone
never satisfy these requirements.

## Enrollment and rollout

Keep the existing role/profile as the default. Mount a protected AWS config file
containing a named AssumeRole profile (`credential_source=Ec2InstanceMetadata`,
the approved role ARN and External ID). Set `AWS_CONFIG_FILE` to that file; do not
set a process-wide `AWS_PROFILE` to the additional account.

`SPOTBOT_AWS_ACCOUNTS` is one JSON object, for example:

```json
{
  "b300-west": {
    "account_id": "222222222222",
    "profile": "spotbot-b300",
    "region": "us-west-2",
    "instance_types": ["p6-b300.48xlarge"],
    "vpc_id": "vpc-0123456789abcdef0",
    "security_group_ids": ["sg-0123456789abcdef0"],
    "key_name": "approved-gpu-key",
    "image_id": "ami-0123456789abcdef0",
    "ssh_user": "ubuntu",
    "root_volume_gb": 80,
    "interruption_queue_url": "https://sqs.us-west-2.amazonaws.com/222222222222/approved-interruptions"
  }
}
```

Render a proposed regional stack with `scripts/render_aws_account_stack.py`.
It creates no resources: review the generated JSON and a CloudFormation change set
before execution. The stack grants B300 Spot launch and tagged recovery operations,
adds encrypted interruption queues/rules, and opens GPU SSH/HTTP only to one approved
gateway IPv4 address. It does not create GPU instances or alter existing groups.

Validate with `spotbot rental-check --rfq request.json --aws` using an explicit Region and
instance type. Check the effective SDK account, quota, base AMI, encrypted EBS/KMS,
queue rule, gateway access and `RunInstances(DryRun=True)` before publishing offers.
An encrypted, account-owned clean base AMI is recommended: public AMIs work, but the
first protected backup can require a full copy and substantially delay delivery.
Copying the public AMI into the target account can prepare this baseline without
running a GPU; snapshots incur storage charges and require operator approval.

After restart, verify both account workers and the existing backup inventory. Confirm
the public marketplace contains actual eligible B300 offers, rather than only the
price-history reference. A paid acceptance requires an explicit spending limit,
independent timeout/release supervision and cleanup verification. Roll back by
removing only the new enrollment/overlay; retain the named account while it owns any
rentals or backups that still require lifecycle management.

## Environment-only OpenNext purchase filtering

Set `SPOTBOT_OPENNEXT_AWS_ACCOUNTS` on the OpenNext API process and restart it:
`*` aggregates enrolled accounts, `default` selects the original account, and a
comma-separated list such as `b300-west` or `default,b300-west` selects those aliases.
These are Bot enrollment aliases, not local AWS CLI profile names. An empty or
malformed value fails validation; an unknown alias produces no purchasable offers,
never an implicit fallback to all accounts.

The adapter asks the Bot for `account_routes=true`, filters raw account offerings
before cheapest-zone aggregation, and binds each accepted RFQ's
`procurement_account` to the quote source. Older account-blind clients retain the
existing Region/SKU routing behavior. Deploy Bot support before upgrading the
adapter. The purchase filter does not remove credentials, stop collection, or
change the account of an accepted order, rental, backup, or cleanup operation.
