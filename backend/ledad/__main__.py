import asyncio
import sys

from .config import Config
from .service import Service


def main():
    if "--http" in sys.argv:
        from dotenv import load_dotenv

        from .transport.http import main as http_main

        load_dotenv(".env.local")
        load_dotenv("env.local")
        http_main(Service(Config.from_environment()))
    else:
        from .transport.stdio import main as stdio_main

        asyncio.run(stdio_main(Service(Config.from_environment())))


if __name__ == "__main__":
    main()
