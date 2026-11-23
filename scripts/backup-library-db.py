#!/usr/bin/env python3
"""Create and verify a standalone SQLite backup of a Lap library database."""

import argparse
import os
import stat
from pathlib import Path
import sqlite3
import sys
from urllib.parse import quote

COMMON_TABLES = ("afiles", "albums", "afolders")
SNAPSHOT_NOTE = (
    "Note: this snapshots only the DB; it does not copy app-config, sidecars, "
    "thumbnail cache, or external db_storage_dir targets."
)


def read_user_version(connection):
    return connection.execute("PRAGMA user_version").fetchone()[0]


def row_counts(connection):
    counts = {}
    for table in COMMON_TABLES:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        if exists is None:
            counts[table] = "unavailable"
            continue
        try:
            counts[table] = connection.execute(
                f'SELECT COUNT(*) FROM "{table}"'
            ).fetchone()[0]
        except sqlite3.Error:
            counts[table] = "unavailable"
    return counts


def format_counts(counts):
    return ", ".join(f"{name}={counts[name]}" for name in COMMON_TABLES)


def path_identity(target):
    try:
        current = target.stat(follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(current.st_mode):
        return None
    return current.st_dev, current.st_ino


def remove_owned_target(target, identity):
    try:
        if path_identity(target) == identity:
            target.unlink()
    except OSError:
        pass


def verify_destination(connection):
    integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
    if integrity_rows != [("ok",)]:
        raise sqlite3.DatabaseError(
            f"destination integrity_check failed: {integrity_rows!r}"
        )


def backup(source_arg, target_arg, verifier=verify_destination):
    source_path = Path(source_arg).expanduser().absolute()
    if not source_path.exists():
        raise ValueError(f"source does not exist: {source_arg}")
    source_path = source_path.resolve(strict=True)
    if not source_path.is_file():
        raise ValueError(f"source is not a regular file: {source_arg}")

    target_path = Path(target_arg).expanduser().absolute()
    if target_path == source_path:
        raise ValueError("source and target must be different files")
    parent = target_path.parent
    if not parent.is_dir():
        raise ValueError(f"target parent directory does not exist: {parent}")
    if os.path.lexists(target_path):
        raise FileExistsError(f"target already exists: {target_path}")

    # Quote reserved URI characters (including %, ?, and #) while preserving
    # path separators and a Windows drive colon. mode=ro prevents source writes.
    source_uri = f"file:{quote(source_path.as_posix(), safe='/:')}?mode=ro"
    source_connection = None
    destination_connection = None
    target_descriptor = None
    target_identity = None
    try:
        source_connection = sqlite3.connect(source_uri, uri=True)
        source_version = read_user_version(source_connection)
        source_counts = row_counts(source_connection)

        # Exclusively create the destination before SQLite opens it, preventing
        # an existing target (including one created concurrently) from being
        # overwritten. Restrictive initial permissions avoid exposing a backup.
        target_descriptor = os.open(
            target_path,
            os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0),
            0o600,
        )
        created_stat = os.fstat(target_descriptor)
        target_identity = (created_stat.st_dev, created_stat.st_ino)
        if os.name != "nt":
            os.fchmod(target_descriptor, 0o600)

        # POSIX can hand SQLite the still-open file descriptor path. Windows' CRT
        # does not expose that path to sqlite3, so keep the handle open and verify
        # the path still names the same regular file immediately around SQLite open.
        if os.name == "nt":
            sqlite_target = target_path
        else:
            fd_directory = next(
                (
                    candidate
                    for candidate in ("/proc/self/fd", "/dev/fd")
                    if os.path.isdir(candidate)
                ),
                None,
            )
            if fd_directory is None:
                raise OSError("no POSIX file-descriptor path is available for safe SQLite open")
            sqlite_target = Path(fd_directory) / str(target_descriptor)
        if path_identity(target_path) != target_identity:
            raise OSError(
                "destination is no longer the created regular file before SQLite open"
            )
        destination_connection = sqlite3.connect(sqlite_target)
        if path_identity(target_path) != target_identity:
            raise OSError(
                "destination is no longer the created regular file after SQLite open"
            )
        if os.name != "nt":
            # A journal beside a descriptor path would not be a safe persistent path.
            destination_connection.execute("PRAGMA journal_mode=MEMORY")

        source_connection.backup(destination_connection)
        verifier(destination_connection)

        destination_version = read_user_version(destination_connection)
        destination_counts = row_counts(destination_connection)

        print(f"source user_version: {source_version}")
        print(f"destination user_version: {destination_version}")
        print(f"source row counts: {format_counts(source_counts)}")
        print(f"destination row counts: {format_counts(destination_counts)}")
        print("integrity_check: ok")
        print(SNAPSHOT_NOTE)
    except BaseException:
        try:
            if destination_connection is not None:
                destination_connection.close()
                destination_connection = None
            if source_connection is not None:
                source_connection.close()
                source_connection = None
            if target_descriptor is not None:
                os.close(target_descriptor)
                target_descriptor = None
        finally:
            if target_identity is not None:
                remove_owned_target(target_path, target_identity)
        raise
    finally:
        if destination_connection is not None:
            destination_connection.close()
        if source_connection is not None:
            source_connection.close()
        if target_descriptor is not None:
            os.close(target_descriptor)


def main():
    parser = argparse.ArgumentParser(
        description="Create a verified SQLite backup of a library database."
    )
    parser.add_argument("SOURCE_DB", help="source SQLite database")
    parser.add_argument("TARGET_DB", help="new destination SQLite database")
    args = parser.parse_args()

    try:
        backup(args.SOURCE_DB, args.TARGET_DB)
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"backup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
