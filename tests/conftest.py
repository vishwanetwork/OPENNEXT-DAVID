import copy

import httpx
import pytest

from spotbot.config import Settings
from spotbot.service import Service

LAMBDA_CATALOG = {
    "data": {
        "gpu_1x_h100": {
            "instance_type": {
                "name": "gpu_1x_h100",
                "gpu_description": "NVIDIA H100 SXM 80GB",
                "price_cents_per_hour": 250,
                "specs": {"gpus": 1, "vcpus": 26, "memory_gib": 225, "storage_gib": 1024},
            },
            "regions_with_capacity_available": [{"name": "us-west-1"}],
        }
    }
}

SHADE_CATALOG = {
    "instance_types": [
        {
            "cloud": "excesssupply",
            "shade_instance_type": "H100_sxm5",
            "cloud_instance_type": "gpu-h100",
            "configuration": {
                "gpu_type": "H100",
                "num_gpus": 1,
                "vcpus": 16,
                "memory_in_gb": 128,
                "storage_in_gb": 100,
                "os_options": ["ubuntu22.04_cuda12.2_shade_os"],
            },
            "hourly_price": 250,
            "availability": [
                {"region": "us-central-1", "rental_type": "on_demand", "available": False},
                {
                    "region": "us-central-1",
                    "rental_type": "spot",
                    "available": True,
                    "hourly_price": "1.50",
                },
            ],
        }
    ]
}

TENSOR_CATALOG = {
    "data": {
        "locations": [
            {
                "id": "loc-test",
                "city": "Austin",
                "country": "US",
                "tier": 3,
                "gpus": [
                    {
                        "v0Name": "h100-sxm5-80gb",
                        "displayName": "H100 SXM5 80GB",
                        "max_count": 8,
                        "price_per_hr": 2.2,
                        "resources": {"max_vcpus": 128, "max_ram_gb": 300, "max_storage_gb": 1000},
                        "pricing": {
                            "per_vcpu_hr": 0.003,
                            "per_gb_ram_hr": 0.002,
                            "per_gb_storage_hr": 0.00005,
                        },
                        "network_features": {"dedicated_ip_available": True},
                    }
                ],
            }
        ]
    }
}

VULTR_CATALOG = {
    "plans": [
        {
            "id": "opaque-gpu-plan",
            "gpu_type": "NVIDIA_L40S",
            "gpu_count": 2,
            "vcpu_count": 32,
            "ram": 384000,
            "disk": 2200,
            "hourly_cost": 3.342,
            "hourly_cost_preemptible": 2.0,
            "deploy_ondemand": True,
            "deploy_preemptible": True,
            "locations": ["sea"],
            "location_cost": {"sea": {"hourly_cost": 3.5, "hourly_cost_preemptible": 2.1}},
        }
    ],
    "meta": {"links": {"next": ""}},
}


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        spotbot_database_path=tmp_path / "test.sqlite3",
        spotbot_background_enabled=False,
        spotbot_api_key="test-token",
        lambda_api_key="test-lambda",
        shadeform_api_key="test-shade",
        tensordock_api_key="test-tensor",
        vultr_api_key="test-vultr",
        spotbot_enabled_providers="lambda,tensordock,vultr,shadeform",
    )


@pytest.fixture
def service_factory(settings):
    def factory(handler, **overrides):
        config = settings.model_copy(update=overrides)
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        svc = Service(config, client)
        for provider in svc.providers.values():
            provider.read_interval = provider.create_interval = 0
        return svc

    return factory


def catalog_handler(request):
    data = {
        "cloud.lambda.ai": LAMBDA_CATALOG,
        "api.shadeform.ai": SHADE_CATALOG,
        "dashboard.tensordock.com": TENSOR_CATALOG,
        "api.vultr.com": VULTR_CATALOG,
    }
    assert request.method == "GET"
    return httpx.Response(200, json=copy.deepcopy(data[request.url.host]))
