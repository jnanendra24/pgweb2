"""python -m app.cli create-user EMAIL [--admin] [--name NAME]   (prompts for the password)"""

import argparse
import asyncio
import getpass
import sys

from app.core.bootstrap import create_user
from app.db.session import get_engine, sessionmaker


async def _create(args: argparse.Namespace) -> int:
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Repeat password: "):
        print("Passwords do not match", file=sys.stderr)
        return 1
    try:
        async with sessionmaker()() as db:
            user = await create_user(db, args.email, password, role="admin" if args.admin else "member", name=args.name)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    except Exception as e:  # e.g. duplicate email
        print(f"Could not create user: {e}", file=sys.stderr)
        return 1
    finally:
        await get_engine().dispose()
    print(f"Created {user.role} {user.email}")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-user")
    c.add_argument("email")
    c.add_argument("--name", default="")
    c.add_argument("--admin", action="store_true", help="the first user is always an admin")
    args = p.parse_args()
    sys.exit(asyncio.run(_create(args)))


if __name__ == "__main__":
    main()
