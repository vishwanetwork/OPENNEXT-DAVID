"""Render reviewable regional launch/recovery infrastructure. Never deploy resources."""

import argparse
import copy
import ipaddress
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def render(*, account_id, region, vpc_id, subnet_ids, key_name, role_name, gateway_cidr):
    patterns = {
        account_id: r"\d{12}",
        region: r"[a-z]{2}(?:-[a-z]+)+-\d",
        vpc_id: r"vpc-[a-f0-9]+",
        role_name: r"[A-Za-z0-9+=,.@_-]{1,64}",
    }
    if any(not re.fullmatch(pattern, value) for value, pattern in patterns.items()):
        raise ValueError("Invalid deployment identity or VPC")
    if not subnet_ids or any(not re.fullmatch(r"subnet-[a-f0-9]+", s) for s in subnet_ids):
        raise ValueError("Explicit approved subnets are required")
    gateway = ipaddress.ip_network(gateway_cidr, strict=True)
    if gateway.version != 4 or gateway.prefixlen != 32:
        raise ValueError("Gateway ingress must be restricted to one IPv4 /32")
    if not re.fullmatch(r"[A-Za-z0-9_.@+-]{1,255}", key_name):
        raise ValueError("Invalid approved SSH key name")
    template = json.loads((ROOT / "infra/aws-rental-recovery.json").read_text())
    policy = (ROOT / "docs/aws-cross-account/target-launch-policy.json").read_text()
    for key, value in {
        "__TARGET_ACCOUNT_ID__": account_id,
        "__REGION__": region,
        "__SUBNET_ID__": subnet_ids[0],
        "__KEY_PAIR_NAME__": key_name,
    }.items():
        policy = policy.replace(key, value)
    policy = json.loads(policy)
    dependencies = next(
        s for s in policy["Statement"] if s["Sid"] == "UseApprovedLaunchDependencies"
    )
    dependencies["Resource"] = (
        [
            resource
            for resource in dependencies["Resource"]
            if ":subnet/" not in resource and ":security-group/" not in resource
        ]
        + [f"arn:aws:ec2:{region}:{account_id}:subnet/{s}" for s in dict.fromkeys(subnet_ids)]
        + [
            {
                "Fn::Sub": f"arn:aws:ec2:{region}:{account_id}:security-group/${{GpuSecurityGroup.GroupId}}"
            }
        ]
    )
    template["Description"] = (
        "Account-bound B300 Spot launch, restricted gateway ingress, and regional recovery. No GPU instances."
    )
    parameter = template["Parameters"]["ExistingBotRoleName"]
    parameter.update(Default=role_name, AllowedValues=[role_name])
    template["Parameters"]["AllowCrossRegionCopies"].update(
        Default="false", AllowedValues=["false"]
    )
    template["Conditions"]["ApprovedDeployment"] = {
        "Fn::And": [
            {"Fn::Equals": [{"Ref": "AWS::AccountId"}, account_id]},
            {"Fn::Equals": [{"Ref": "AWS::Region"}, region]},
        ]
    }
    for resource in template["Resources"].values():
        previous = resource.get("Condition")
        if previous:
            combined = "Approved" + previous
            template["Conditions"][combined] = {
                "Fn::And": [
                    {"Condition": "ApprovedDeployment"},
                    {"Condition": previous},
                ]
            }
            resource["Condition"] = combined
        else:
            resource["Condition"] = "ApprovedDeployment"
    for value in template["Outputs"].values():
        value["Condition"] = "ApprovedDeployment"
    template["Resources"]["GpuSecurityGroup"] = {
        "Type": "AWS::EC2::SecurityGroup",
        "Condition": "ApprovedDeployment",
        "Properties": {
            "GroupDescription": "SpotOrderBot B300: SSH and HTTP only from the approved test gateway",
            "GroupName": "spotbot-b300-gpu",
            "VpcId": vpc_id,
            "SecurityGroupIngress": [
                {
                    "IpProtocol": "tcp",
                    "FromPort": port,
                    "ToPort": port,
                    "CidrIp": str(gateway),
                    "Description": "Approved test gateway only",
                }
                for port in [22, 8000]
            ],
            "SecurityGroupEgress": [{"IpProtocol": "-1", "CidrIp": "0.0.0.0/0"}],
            "Tags": [{"Key": "spotbot-managed", "Value": "true"}],
        },
    }
    template["Resources"]["GpuLaunchPolicy"] = {
        "Type": "AWS::IAM::ManagedPolicy",
        "Condition": "ApprovedDeployment",
        "Properties": {
            "ManagedPolicyName": {"Fn::Sub": "${AWS::StackName}-launch"},
            "Roles": [{"Ref": "ExistingBotRoleName"}],
            "PolicyDocument": policy,
        },
    }
    template["Outputs"]["GpuSecurityGroupId"] = {
        "Condition": "ApprovedDeployment",
        "Value": {"Fn::GetAtt": ["GpuSecurityGroup", "GroupId"]},
    }
    template["Metadata"] = {
        "ApprovedAccountId": account_id,
        "ApprovedRegion": region,
        "InstanceTypes": ["p6-b300.48xlarge"],
        "NoComputeCreated": True,
    }
    return copy.deepcopy(template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in [
        "account-id",
        "region",
        "vpc-id",
        "key-name",
        "role-name",
        "gateway-cidr",
        "output",
    ]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--subnet-id", action="append", required=True)
    args = vars(parser.parse_args())
    output = Path(args.pop("output"))
    args["subnet_ids"] = args.pop("subnet_id")
    output.write_text(json.dumps(render(**args), indent=2) + "\n")


if __name__ == "__main__":
    main()
