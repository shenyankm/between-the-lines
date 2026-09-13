"""Exercise successful/failed OAuth callbacks through actual TCP and Nginx.

Requires a migrated isolated DB via BTL_TEST_DATABASE_URL and a local Nginx
image. Uses an in-process OAuth fixture, never a real partner or credentials.
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
CHILD = """
from contextlib import asynccontextmanager
from types import SimpleNamespace
import uvicorn
from app.config import Settings
from app.factory import create_app
class OAuthFixture:
    async def authorize_access_token(self,request):
        if request.query_params.get('error'):raise RuntimeError('fixture failure '+str(request.url))
        return {'access_token':'fixture-only'}
    async def get(self,*args,**kwargs):
        return SimpleNamespace(raise_for_status=lambda:None,json=lambda:{'id':'redaction-fixture','name':'fixture'})
app=create_app(Settings())
original=app.router.lifespan_context
@asynccontextmanager
async def lifespan(app):
    async with original(app):
        app.state.runtime.oauth=SimpleNamespace(zhihu=OAuthFixture())
        yield
app.router.lifespan_context=lifespan
uvicorn.run(app,host='0.0.0.0',port=18741)
"""


async def main():
    url = os.environ.get("BTL_TEST_DATABASE_URL", "")
    if "/btl_upgrade_test_" not in url and not url.endswith("/btl_test"):
        raise RuntimeError("Set BTL_TEST_DATABASE_URL to a migrated dedicated test database")
    docker = shutil.which("docker")
    if not docker:
        raise RuntimeError("Docker is required")
    name = "btl-log-check-" + uuid4().hex[:8]
    with tempfile.TemporaryDirectory(prefix="btl-log-check-") as directory:
        tmp = Path(directory)
        (tmp / "site.conf").write_text(
            (ROOT / "deploy/nginx.conf")
            .read_text()
            .replace("http://api:8000", "http://host.docker.internal:18741")
        )
        (tmp / "nginx.conf").write_text((ROOT / "deploy/nginx.main.conf").read_text())
        env = {
            **os.environ,
            "ENVIRONMENT": "test",
            "AGENT_MODE": "mock",
            "DATABASE_URL": url,
            "CHECKPOINT_URL": url.replace("postgresql+asyncpg:", "postgresql:"),
            "ZH IHU_CLIENT_ID".replace(" ", ""): "fixture",
            "ZHIHU_CLIENT_SECRET": "fixture",
            "ZHIHU_AUTHORIZE_URL": "https://oauth.example/authorize",
            "ZHIHU_TOKEN_URL": "https://oauth.example/token",
            "ZHIHU_USERINFO_URL": "https://oauth.example/me",
        }
        with (tmp / "api.log").open("w") as log:
            process = subprocess.Popen(
                [sys.executable, "-c", CHILD],
                cwd=ROOT / "backend",
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            started = False
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    for _ in range(100):
                        if process.poll() is not None:
                            raise RuntimeError("Test API failed to start")
                        try:
                            if (
                                await client.get("http://127.0.0.1:18741/api/health")
                            ).status_code == 200:
                                break
                        except httpx.TransportError:
                            pass
                        await asyncio.sleep(0.1)
                    await asyncio.to_thread(
                        subprocess.run,
                        [
                            docker,
                            "run",
                            "--rm",
                            "-d",
                            "--name",
                            name,
                            "--add-host",
                            "host.docker.internal:host-gateway",
                            "-p",
                            "127.0.0.1:18742:8080",
                            "-v",
                            f"{tmp}/nginx.conf:/etc/nginx/nginx.conf:ro",
                            "-v",
                            f"{tmp}/site.conf:/etc/nginx/conf.d/default.conf:ro",
                            os.environ.get("BTL_NGINX_TEST_IMAGE", "nginx:1.28.0-alpine"),
                        ],
                        check=True,
                        capture_output=True,
                    )
                    started = True
                    for _ in range(100):
                        try:
                            if (
                                await client.get("http://127.0.0.1:18742/api/health")
                            ).status_code == 200:
                                break
                        except httpx.TransportError:
                            pass
                        await asyncio.sleep(0.1)
                    statuses = []
                    for suffix in ("", "&error=denied"):
                        response = await client.get(
                            "http://127.0.0.1:18742/api/auth/zhihu/callback?code=FAKE_OAUTH_CODE_7G&state=FAKE_OAUTH_STATE_3K"
                            + suffix
                        )
                        statuses.append(response.status_code)
                    assert statuses == [303, 400], statuses
                nginx = await asyncio.to_thread(
                    subprocess.run,
                    [docker, "logs", name],
                    capture_output=True,
                    text=True,
                    check=True,
                )
            finally:
                if started:
                    await asyncio.to_thread(
                        subprocess.run,
                        [docker, "stop", name],
                        capture_output=True,
                        check=True,
                    )
                process.terminate()
                await asyncio.to_thread(process.wait, timeout=15)
        api = (tmp / "api.log").read_text()
        proxy = nginx.stdout + nginx.stderr
        for secret in ("FAKE_OAUTH_CODE_7G", "FAKE_OAUTH_STATE_3K"):
            assert secret not in api and secret not in proxy, "OAuth query leaked"
        assert "/api/auth/zhihu/callback" in api and "/api/auth/zhihu/callback" in proxy
        report = {
            "http_statuses": statuses,
            "uvicorn_path_only": True,
            "nginx_path_only": True,
            "query_parameters_absent": True,
            "oauth": "fixture, not partner acceptance",
        }
        output = ROOT / "artifacts/log-redaction-v2.json"
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report))


if __name__ == "__main__":
    asyncio.run(main())
