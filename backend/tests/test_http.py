import asyncio

import pytest
from aiohttp.test_utils import TestClient, TestServer

from ledad.transport.http import create_app


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "example.com"},
        {"Origin": "https://example.com"},
        {"Sec-Fetch-Site": "cross-site"},
    ],
)
async def test_browser_adapter_blocks_external_requests(service, headers):
    async with TestClient(TestServer(create_app(service))) as client:
        for path in ("/api/sessions", "/api/config"):
            response = await client.get(path, headers=headers)
            assert response.status == 403


async def test_browser_crud_and_origin_without_real_provider(service, monkeypatch):
    monkeypatch.setenv("LEDAD_UI_PORT", "3001")
    async with TestClient(TestServer(create_app(service))) as client:
        origin = {"Origin": "http://127.0.0.1:3001"}
        response = await client.options("/api/sessions", headers=origin)
        assert response.status == 204
        assert response.headers["Access-Control-Allow-Origin"] == origin["Origin"]
        response = await client.post("/api/sessions", json={"mode": "audience"}, headers=origin)
        assert response.status == 201
        session = await response.json()
        response = await client.get("/api/sessions/" + session["id"], headers=origin)
        assert await response.json() == session
        assert response.headers["Cache-Control"] == "no-store"
        assert (
            await client.get("/api/sessions", headers={"Origin": "http://127.0.0.1:3000"})
        ).status == 403


async def test_disconnected_browser_cancels_work_and_finalizes_usage(service):
    entered, cancelled = asyncio.Event(), asyncio.Event()
    original = service.dispatch

    async def slow(request):
        if request["path"] == "/slow":
            try:
                async with service.usage.measured("openai", "test", "test", None):
                    entered.set()
                    await asyncio.sleep(60)
            finally:
                cancelled.set()
        return await original(request)

    service.dispatch = slow
    async with TestClient(TestServer(create_app(service), handler_cancellation=True)) as client:
        task = asyncio.create_task(client.get("/slow"))
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.wait_for(cancelled.wait(), 2)
    assert service.usage.list()[0]["status"] == "cancelled"
