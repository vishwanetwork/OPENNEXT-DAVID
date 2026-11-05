"""Rendered account permissions stay bounded to reviewed hardware and networks."""

import json

import pytest

from scripts.render_aws_account_stack import render


def arguments():
    return dict(
        account_id="222222222222",
        region="us-west-2",
        vpc_id="vpc-a",
        subnet_ids=["subnet-a", "subnet-b"],
        key_name="gpu-key",
        role_name="SpotOrderBotCrossAccountRole",
        gateway_cidr="44.248.155.24/32",
    )


def test_account_stack_only_grants_b300_spot_and_restricted_gateway_ingress():
    stack = render(**arguments())
    resources = stack["Resources"]
    assert not any(r["Type"] == "AWS::EC2::Instance" for r in resources.values())
    group = resources["GpuSecurityGroup"]["Properties"]
    assert {(r["FromPort"], r["ToPort"], r["CidrIp"]) for r in group["SecurityGroupIngress"]} == {
        (22, 22, "44.248.155.24/32"),
        (8000, 8000, "44.248.155.24/32"),
    }
    policy = resources["GpuLaunchPolicy"]["Properties"]["PolicyDocument"]
    launch = next(
        s for s in policy["Statement"] if s["Sid"] == "LaunchOnlyManagedB300SpotInstances"
    )
    assert launch["Condition"]["StringEquals"]["ec2:InstanceMarketType"] == "spot"
    assert launch["Condition"]["StringEquals"]["ec2:InstanceType"] == "p6-b300.48xlarge"
    dependencies = next(
        s for s in policy["Statement"] if s["Sid"] == "UseApprovedLaunchDependencies"
    )
    assert {r for r in dependencies["Resource"] if isinstance(r, str) and ":subnet/" in r} == {
        "arn:aws:ec2:us-west-2:222222222222:subnet/subnet-a",
        "arn:aws:ec2:us-west-2:222222222222:subnet/subnet-b",
    }
    assert "__" not in json.dumps(stack)
    assert all("Condition" in r for r in resources.values())
    assert stack["Parameters"]["AllowCrossRegionCopies"]["AllowedValues"] == ["false"]


@pytest.mark.parametrize("cidr", ["0.0.0.0/0", "44.248.155.0/24", "::/0"])
def test_account_stack_refuses_broad_ingress(cidr):
    args = arguments()
    args["gateway_cidr"] = cidr
    with pytest.raises(ValueError, match="/32"):
        render(**args)
