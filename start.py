from __future__ import annotations

import argparse
import socket

import uvicorn

from app.gsv_process import start_gsv_api
from app.settings import load_settings


def port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((host, port)) != 0


def choose_port(host: str, requested_port: int) -> int:
    if port_available(host, requested_port):
        return requested_port
    for port in range(requested_port + 1, requested_port + 50):
        if port_available(host, port):
            print(f"[WARN] Port {requested_port} is already in use, using {port} instead.", flush=True)
            return port
    raise RuntimeError(f"No available port found near {requested_port}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Start Any Voice Chat web app.")
    parser.add_argument("--host", default="127.0.0.1", help="Web bind host.")
    parser.add_argument("--port", type=int, default=7860, help="Web bind port.")
    parser.add_argument("--with-gsv", action="store_true", help="Start GPT-SoVITS API before the web app.")
    args = parser.parse_args()

    if args.with_gsv:
        result = start_gsv_api(load_settings())
        print("GSV API:", result, flush=True)

    port = choose_port(args.host, args.port)
    print(f"Any Voice Chat: http://{args.host}:{port}", flush=True)
    uvicorn.run("app.main:app", host=args.host, port=port)


if __name__ == "__main__":
    main()
