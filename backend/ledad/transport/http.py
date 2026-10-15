"""Loopback-only browser development adapter. Production uses stdio."""

import base64
import os
from uuid import uuid4

from aiohttp import web

from ..storage.files import compact


def create_app(service):
    ui_port = int(os.environ.get("LEDAD_UI_PORT", "3000"))
    origins = {f"http://127.0.0.1:{ui_port}", f"http://localhost:{ui_port}"}

    async def handle(request):
        origin = request.headers.get("Origin")
        if (
            request.host.split(":")[0] not in ("localhost", "127.0.0.1")
            or (origin and origin not in origins)
            or request.headers.get("Sec-Fetch-Site") == "cross-site"
        ):
            return web.Response(status=403)
        headers = {
            "Access-Control-Allow-Origin": origin or f"http://127.0.0.1:{ui_port}",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
            "Cache-Control": "no-store",
            "Vary": "Origin",
        }
        if request.method == "OPTIONS":
            return web.Response(status=204, headers=headers)
        message = {"id": str(uuid4()), "path": request.path, "method": request.method}
        if request.content_type == "multipart/form-data":
            form = await request.post()
            file = form.get("file")
            if not isinstance(file, web.FileField):
                return web.json_response(
                    {"error": "ファイルと資料の種類を指定してください。"},
                    status=400,
                    headers=headers,
                )
            data = file.file.read(20 * 1024 * 1024 + 1)
            if len(data) > 20 * 1024 * 1024:
                return web.json_response(
                    {"error": "ファイルは20MB以内にしてください。"}, status=413, headers=headers
                )
            message["file"] = {
                "name": file.filename,
                "data": base64.b64encode(data).decode(),
                "kind": str(form.get("kind")),
            }
        elif request.can_read_body:
            message["body"] = await request.text()
        if request.query.get("stream") == "true" and request.path.endswith("/consult"):
            stream = web.StreamResponse(headers={**headers, "Content-Type": "application/x-ndjson"})
            await stream.prepare(request)

            async def on_text(text):
                await stream.write((compact({"text": text}) + "\n").encode())

            response = await service.dispatch(message, on_text)
            await stream.write((compact(response.envelope(message["id"])) + "\n").encode())
            await stream.write_eof()
            return stream
        response = await service.dispatch(message)
        return web.Response(
            body=response.bytes(),
            status=response.status,
            headers={**headers, "Content-Type": response.content_type},
        )

    app = web.Application(client_max_size=22 * 1024 * 1024)
    app.router.add_route("*", "/{path:.*}", handle)
    async def close(_app):
        await service.close()

    app.on_cleanup.append(close)
    return app


def main(service):
    web.run_app(
        create_app(service),
        host="127.0.0.1",
        port=int(os.environ.get("LEDAD_SERVICE_PORT", "4319")),
        handler_cancellation=True,
    )
