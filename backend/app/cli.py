from __future__ import annotations

import argparse
import getpass
import sqlite3

from .config import Settings
from .database import Database
from .security import CredentialValidationError, validate_password, validate_username


def create_admin(args: argparse.Namespace) -> int:
    settings = Settings()
    database = Database(settings.database_path)
    database.initialize()
    password = args.password or getpass.getpass("管理员密码：")
    try:
        username = validate_username(args.username)
        validate_password(password)
        database.create_user(
            username=username,
            display_name=args.display_name.strip() or username,
            password=password,
            role="admin",
        )
    except CredentialValidationError as exc:
        print(f"创建失败：{exc}")
        return 2
    except sqlite3.IntegrityError:
        print("创建失败：用户名已经存在")
        return 2
    print(f"管理员 {username} 已创建。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="TextCast 后端管理命令")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-admin", help="创建系统管理员")
    create.add_argument("--username", required=True)
    create.add_argument("--display-name", default="系统管理员")
    create.add_argument("--password", help="不建议在共享终端中直接传入")
    create.set_defaults(handler=create_admin)
    args = parser.parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
