#!/usr/bin/env python3
"""Utility helpers for preparing the NewsHub development environment.

This script focuses on bootstrap tasks that pair with the Poetry tooling
workflow documented in the README.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
ENV_EXAMPLE = ROOT / ".env.local.example"

REQUIRED_ENV_KEYS: List[str] = [
    "DATABASE_URL",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "NEWS_API_KEY",
]


def copy_example_env(force: bool = False) -> bool:
    """Copy `.env.local.example` to `.env.local` if needed."""
    if not ENV_EXAMPLE.exists():
        print("⚠️  .env.local.example 파일을 찾을 수 없습니다.", file=sys.stderr)
        return False

    if ENV_FILE.exists() and not force:
        return False

    shutil.copyfile(ENV_EXAMPLE, ENV_FILE)
    print(f"✅ {ENV_FILE.name} 파일을 생성했습니다.")
    return True


def parse_env_file(path: Path) -> Dict[str, str]:
    """Very small .env parser (avoids external dependencies)."""
    values: Dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def missing_env_keys(keys: Iterable[str], values: Dict[str, str]) -> List[str]:
    return [key for key in keys if not values.get(key)]


def check_env_file() -> bool:
    """Validate that `.env.local` contains required variables."""
    if not ENV_FILE.exists():
        print("❌ .env.local 파일이 없습니다. --bootstrap-env 옵션을 사용해 생성하세요.")
        return False

    values = parse_env_file(ENV_FILE)
    missing = missing_env_keys(REQUIRED_ENV_KEYS, values)
    if missing:
        print("❌ 다음 환경 변수가 비어있습니다:")
        for key in missing:
            print(f"   - {key}")
        return False

    print("✅ 필요한 환경 변수가 모두 채워졌습니다.")
    return True


def summarize() -> None:
    """Print a quick summary of the repo bootstrap status."""
    print("📦 NewsHub 환경 점검")
    print(f" - Poetry 프로젝트 루트: {ROOT}")
    print(f" - .env.local 상태: {'있음' if ENV_FILE.exists() else '없음'}")
    print(f" - 가상환경 경로: {ROOT / '.venv'} (Poetry in-project 설정 권장)")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="NewsHub 개발 환경 부트스트랩 유틸리티",
    )
    parser.add_argument(
        "--bootstrap-env",
        action="store_true",
        help="필요 시 .env.local 파일을 생성합니다.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=".env.local 이 이미 존재해도 예제를 덮어씁니다 (주의).",
    )
    parser.add_argument(
        "--check-env",
        action="store_true",
        help="필수 환경 변수를 검증합니다.",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="환경 요약 정보를 출력합니다 (기본값).",
    )
    return parser


def main(argv: List[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    ran_command = False
    success = True

    if args.bootstrap_env:
        ran_command = True
        success &= copy_example_env(force=args.force)

    if args.check_env:
        ran_command = True
        success &= check_env_file()

    if args.summary or not ran_command:
        summarize()

    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())

