# OpenNEXT on Kubernetes

This directory deploys the whole OpenNEXT stack to a Kubernetes cluster (EKS) and moves the
running production data into it. It replaces two hosts:

- the 1Panel web container (`opennext-homepage`), which runs the front-end and the bundled adapter;
- the Bot host, which runs the core Bot and the gateway.

To hand the services over to a new platform, start with [`../HANDOVER.md`](../HANDOVER.md).

Everything builds from this repository: the web app in `apps/web`, and the SpotOrderBot in
`services/spotbot` (imported with its history from `vishwanetwork/spot-order-bot`).

## What runs

| Deployment        | Image              | Does                                                           | State                                                 |
| ----------------- | ------------------ | -------------------------------------------------------------- | ----------------------------------------------------- |
| `web`             | `opennext-web`     | Front-end, legacy API, SpotOrderBot adapter, ClamAV            | PVC `web-data`: accounts, Credit, adapter SQLite, KYB |
| `spotbot`         | `opennext-spotbot` | Prices, rentals, funding; the API the adapter calls            | MySQL `spot_order_bot`                                |
| `spotbot-gateway` | `opennext-spotbot` | Customer SSH ports and model endpoints (`r-<rental>.<domain>`) | MySQL `spot_order_gateway`                            |

- **One replica each, `Recreate` rollouts.** Every Deployment is a single writer: rental, price
  and funding workers, the SQLite database and the account files must never run twice. Do not
  scale them.
- **In-cluster calls.** The services call each other on the cluster network, not through public
  DNS:
  - the adapter calls `http://spotbot.opennext.svc:8000` and `http://spotbot-gateway.opennext.svc:18084`;
  - the gateway calls the Bot at `http://spotbot.opennext.svc:8000`;
  - the Bot sends events to the gateway at `http://spotbot-gateway.opennext.svc:18084/v1/gateway/events`.

  The URLs name the `opennext` namespace, so keep it.

- **Public names stay the same.** The public hostnames do not change: `terminal.opennextlab.ai`,
  `opennextlab.ai` and `admin.opennextlab.ai` (web), `spotbot.test.vishwalab.com` (Bot), and
  `r-*.test.vishwalab.com` (model endpoints) go through one ALB. Running GPU servers already call
  `spotbot.test.vishwalab.com`, and customers already hold their SSH host, ports and model URLs.
- The legacy API still reads prices from the Bot's public HTTPS name (`OPENNEXT_SPOTBOT_URL`).
  `legacy/` only accepts HTTPS there and is not changed.

### Gateway and Bot node

The gateway gives every rental its own TCP port (`22100-22199` today) on `gpu-ssh.test.vishwalab.com`.
A load balancer would need one listener per port, so the gateway uses host networking on one
dedicated node:

- The gateway's SSH ports are on the node's Elastic IP.
- `gpu-ssh.test.vishwalab.com` points at that Elastic IP.
- The Bot is scheduled on the same node, so both reach GPU servers from that one address. The
  servers' security groups allow only that address.

## Prerequisites (cluster operator)

1. **Cluster add-ons**: an EKS cluster with the AWS Load Balancer Controller (IngressClass `alb`),
   the EBS CSI driver with a default StorageClass, and EKS Pod Identity (or IRSA).
2. **Gateway node**:
   - One node (for example `t3.large`) in a **public** subnet with an **Elastic IP**.
   - Label it `opennext.io/gateway=true` and taint it `opennext.io/gateway=true:NoSchedule`.
   - Its security group allows TCP `22100-22199` from anywhere. It allows `18084` only from
     inside the VPC: that is the ALB and the pods; never open `18084` to the internet.
   - It allows outbound traffic to GPU servers on ports 22 and 8000.
3. **MySQL 8.4** (Amazon RDS), reachable from the pods, with an administrator account for
   the import. The Bot's MySQL client does not use TLS; keep the database private to the VPC and
   set `require_secure_transport=0` in its parameter group.
4. **AWS identity for the Bot**: a role in the new account, associated with the `spotbot`
   ServiceAccount in `opennext` (EKS Pod Identity), allowed to assume the Bot role in the GPU
   account:

   ```json
   {
     "Effect": "Allow",
     "Action": "sts:AssumeRole",
     "Resource": "arn:aws:iam::860165147463:role/SpotOrderBotEC2Role"
   }
   ```

   With IRSA instead, annotate the ServiceAccount with the role and import with
   `AWS_IDENTITY=irsa IRSA_ROLE_ARN=<that role>`.

5. **Images**: `.github/workflows/images.yml` publishes `ghcr.io/vishwanetwork/opennext-web` and
   `opennext-spotbot` under every `main` commit SHA. The packages are private. Create the pull
   secret with a token that can read them:

   ```sh
   kubectl -n opennext create secret docker-registry ghcr-pull \
     --docker-server=ghcr.io --docker-username=<user> --docker-password=<read:packages token>
   ```

6. **TLS**: one or more ACM certificates covering `opennextlab.ai`, `terminal.opennextlab.ai`,
   `admin.opennextlab.ai` and `*.test.vishwalab.com`. Put their ARNs in
   `REPLACE_WITH_ACM_CERTIFICATE_ARNS` in `overlays/production/ingress.yaml`. `render` refuses
   to continue while a `REPLACE_WITH_` value is left.

## One-time AWS changes in the GPU accounts

```sh
bash depoly/k8s/scripts/aws-access.sh --pod-role <pod role ARN> --gateway-ip <Elastic IP>
```

It prints the plan and changes nothing. Re-run it with `--apply` after review. It makes two
changes:

- `SpotOrderBotEC2Role` (account 860165147463) may be assumed by the pod role. The B300
  account's `SpotOrderBotCrossAccountRole` keeps trusting `SpotOrderBotEC2Role`, so it is not
  touched. The pod reaches it through the converted AWS config (`aws-config`, below).
- `spotbot-gpu` in us-west-2, us-east-1 and us-east-2, and `spotbot-b300-gpu`, allow ports 22
  and 8000 from the Elastic IP. The old host's address stays until the cutover is done.

## Cutover

Lower the TTL of every name above to 60 s a day before. Customers' SSH sessions drop during
the window. Running GPU servers keep running: their agents retry until the Bot answers again.

1. **Prepare**, before the window:
   - complete the prerequisites;
   - run `aws-access.sh --apply`;
   - merge the release and note its commit SHA. The images workflow must have finished.
2. **Stop the old services.**
   - On the web host: `docker stop opennext-homepage`.
   - On the Bot host: `docker stop spot-order-bot spot-order-gateway`.
3. **Export** as root on each host. Copy both bundles to the operator machine over SSH and keep
   them private: they contain every secret.

   ```sh
   bash depoly/k8s/scripts/export-bot-host.sh --out /root/opennext-migration/bot   # Bot host
   bash depoly/k8s/scripts/export-web-host.sh --out /root/opennext-migration/web   # web host
   ```

4. **Import**, with kubectl pointed at the new cluster:

   ```sh
   MYSQL_HOST=<rds endpoint> MYSQL_ADMIN_USER=admin MYSQL_ADMIN_PASSWORD=<...> \
     bash depoly/k8s/scripts/import.sh --bot-bundle bot --web-bundle web
   ```

   This creates:
   - the namespace and the web volume;
   - the Secrets `spotbot-env`, `spotbot-gateway-env` and `web-env`, from the old containers'
     environment, with new MySQL users and URLs;
   - the ConfigMap `spotbot-aws-config`;
   - both databases, loaded from the dumps;
   - the web data, restored into the volume.

   It refuses to overwrite existing workloads or data.

5. **Deploy and check inside the cluster**:

   ```sh
   bash depoly/k8s/scripts/deploy.sh <commit SHA>
   bash depoly/k8s/scripts/verify.sh
   ```

6. **Switch DNS**:
   - `terminal.opennextlab.ai`, `opennextlab.ai`, `admin.opennextlab.ai`,
     `spotbot.test.vishwalab.com` and `r-*.test.vishwalab.com` go to the ALB. For the model
     endpoints, keep a wildcard on the ALB or route `r-*` there.
   - `gpu-ssh.test.vishwalab.com` goes to the gateway node's Elastic IP.
7. **Check publicly**: run `bash depoly/k8s/scripts/verify.sh --public`. Then sign in, check
   Instances, SSH into an existing rental through its gateway port, and call one model endpoint.
8. **Afterwards**: after a week without rollback, remove the old host's address from the GPU
   security groups and retire the old containers and databases.

**Rollback.**

- Before DNS changes, start the old containers again; nothing was written to the new stack yet.
- After DNS changes, point DNS back and start the old containers. Changes made on the new stack
  in between (orders, Credit, sign-ups) would be lost, so decide quickly.

## Day-2

- **Release**: `bash depoly/k8s/scripts/deploy.sh <commit SHA>`. Both images always come from
  the same commit.
- **Change a setting**: edit the private env file and re-run `opennext_k8s.py env-secret ... |
kubectl apply -f -`. Then restart the Deployment:
  `kubectl -n opennext rollout restart deployment/<name>`.
- **Backups**: use RDS automated snapshots for both databases, and EBS snapshots of the `web-data`
  volume, for example through AWS Backup.
- **Logs**: `kubectl -n opennext logs deployment/<name>`.

## Files

| File                         | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `base/`                      | The three Deployments, their Services and the web volume            |
| `overlays/production/`       | Images, the ALB Ingress, pull secret and health checks              |
| `opennext_k8s.py`            | Render a release; build Secrets, AWS config, trust policy, DB users |
| `scripts/export-bot-host.sh` | Bot and gateway environment, MySQL dumps and AWS config             |
| `scripts/export-web-host.sh` | Web environment and its data directory                              |
| `scripts/import.sh`          | Load both bundles into the cluster                                  |
| `scripts/deploy.sh`          | Apply a release and wait for it                                     |
| `scripts/verify.sh`          | In-cluster and public checks                                        |
| `scripts/aws-access.sh`      | Trust and security group changes in the GPU accounts (plan/apply)   |
| `tests/`                     | Unit tests, run by CI                                               |
