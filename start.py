from __future__ import annotations

import argparse

import uvicorn

from app.gsv_process import start_gsv_api
from app.settings import load_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Any Voice Chat web app.")
    parser.add_argument("--host", default="127.0.0.1", help="Web bind host.")
    parser.add_argument("--port", type=int, default=7860, help="Web bind port.")
    parser.add_argument("--with-gsv", action="store_true", help="Start GPT-SoVITS API before the web app.")
    args = parser.parse_args()

    if args.with_gsv:
        result = start_gsv_api(load_settings())
        print("GSV API:", result)

    print(f"Any Voice Chat: http://{args.host}:{args.port}")
    uvicorn.run("app.main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
