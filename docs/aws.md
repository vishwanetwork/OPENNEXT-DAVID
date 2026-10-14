# AWS EC2 Spot

Install `.[aws]` and add `aws` to `SPOTBOT_ENABLED_PROVIDERS`. The Docker image already includes Boto3. AWS uses the SDK credential chain: an EC2 instance role in the deployment, or standard process environment credentials for development. No AWS access keys are stored by the application. Credentials inside a dotenv file must be exported to the SDK process, such as through Compose `env_file`.

`SPOTBOT_AWS_REGIONS` defaults to `us-west-2` and accepts a comma-separated list. Configure a key-pair name and the dedicated GPU security group once. An empty VPC selects each Region's default VPC; the collector selects an existing subnet for each quoted Availability Zone. The deployed network is public and has an internet-gateway route. Custom networks must provide the configured public/private connectivity.

The default NVIDIA image is resolved through the public SSM parameter `/aws/service/deeplearning/ami/<architecture>/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id`. It includes the NVIDIA OSS driver. AMD, legacy K80/V100/M60, and fractional GPU instances requiring GRID/vGPU drivers need a custom compatible image through `SPOTBOT_AWS_IMAGE_ID`. Architecture must match the selected image. The adapter enlarges the configured minimum root disk to meet the image's required disk size. Encrypted gp3 root volumes are deleted with the instance.

Catalog records preserve `region` and `availability_zone`; the zone participates in the offer ID. Existing non-AWS offer IDs and order fingerprints remain compatible. Linux Spot prices come from `DescribeSpotPriceHistory`; observations are saved in the configured store. History and latest-price filters can use an `offer_id` to select one zone.

Quota checks exclude types larger than the account's relevant G/VT or P Spot vCPU limit from orderable offers. Quota availability does not account for other pending/running instances. `available=true` means configured launch prerequisites and the per-instance quota check passed; `details.availability_kind=launch_attempt_required` makes explicit that it is not proof of live capacity. AWS confirms capacity only during `RunInstances`.

For partitioned GPUs, `gpu_count` is the number of logical GPU devices. `details.gpu_count_kind`, `physical_gpu_count`, and `gpu_specifications` expose the partition fraction and memory. `price_per_gpu_hourly` is per logical device in these records; do not compare a fractional GPU to a full GPU without checking its specifications.

Every order launches exactly one VM. Orders use `MarketType=spot`, a one-time request, interruption behavior `terminate`, the scheduler's `max_price_hourly` as AWS `MaxPrice`, and a deterministic `ClientToken`. Quote checks run again before submission. Root disks and network interfaces have `DeleteOnTermination=true`; instances and volumes carry `spotbot-managed=true` and the deterministic order name.

The limit covers the EC2 Spot compute rate, not EBS, public IPv4, network transfer, taxes, or a total spend budget. GPU image contents do not automatically start a model endpoint. Use `cloud_init` to start the workload, and have the gateway verify its health before routing traffic. Releasing an order terminates its instance and verifies termination.

AWS SDK retries are disabled for the adapter. Definite capacity errors return the order to the queue; uncertain mutation outcomes require reconciliation. Inspection searches the configured Regions. Deletion verifies the management tag before calling `TerminateInstances`.

The deployed role can read EC2 catalogs, public GPU-image parameters, and quota values; create tagged GPU Spot instances using approved network resources and the `test` key pair; tag resources during launch; and terminate only tagged managed instances. It cannot change IAM, network configuration, or launch on-demand instances. The host administrator provisions the AWS Spot service-linked role separately. When adding Regions, extend the role's allowed resources and network defaults as well.

The deployed service enables live orders and sets `SPOTBOT_DRY_RUN_ENABLED=false`. Orders default to `dry_run=false`; explicit simulations are rejected. Authentication and a business `Idempotency-Key` remain required. Changing environment settings requires recreating the container with `docker compose -p spotbot -f compose.production.yaml up -d --force-recreate`; restarting the same container does not reload its environment.
