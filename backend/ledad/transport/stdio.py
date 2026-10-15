import asyncio
import json
import sys
from pathlib import Path

from ..service import Response
from ..storage.files import compact


async def serve(service, reader, send):
    tasks = {}

    def finished(request_id, task):
        tasks.pop(request_id, None)
        try:
            result = task.result()
        except asyncio.CancelledError:
            result = Response({"error": "処理を取り消しました。"}, 499)
        except Exception:
            result = Response(
                {"error": "ローカル処理に失敗しました。アプリを再起動して再試行してください。"}, 500
            )
        send(result.envelope(request_id))

    async def dispatch(message):
        async def on_text(text):
            send({"id": message["id"], "text": text})
        if message.get("stream") is True:
            return await service.dispatch(message, on_text)
        return await service.dispatch(message)

    try:
        while line := await reader.readline():
            try:
                message = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(message, dict):
                continue
            if isinstance(message.get("init"), dict):
                init = message["init"]
                if all(isinstance(init.get(k), str) for k in ("openaiKey", "geminiKey", "dataDir")):
                    service.config.openai_key = init["openaiKey"]
                    service.config.gemini_key = init["geminiKey"]
                    service.config.data_dir = Path(init["dataDir"]).resolve()
                continue
            if isinstance(message.get("cancel"), str):
                if task := tasks.get(message["cancel"]):
                    task.cancel()
                continue
            request_id = message.get("id")
            if not isinstance(request_id, str) or not request_id or request_id in tasks:
                continue
            task = asyncio.create_task(dispatch(message))
            tasks[request_id] = task
            task.add_done_callback(lambda task, request_id=request_id: finished(request_id, task))
    finally:
        pending = list(tasks.values())
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        await service.close()


async def main(service):
    reader = asyncio.StreamReader(limit=32 * 1024 * 1024)
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_running_loop().connect_read_pipe(lambda: protocol, sys.stdin.buffer)
    output = sys.stdout
    sys.stdout = sys.stderr  # Third-party print() must not corrupt the IPC stream.

    def send(value):
        output.write(compact(value) + "\n")
        output.flush()

    await serve(service, reader, send)
