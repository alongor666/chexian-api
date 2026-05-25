#!/usr/bin/env python3
"""Full-snapshot source and output manifest helpers."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class SourceFileFingerprint:
    path: str
    name: str
    size: int
    mtime_ns: int
    sha256: str


def file_sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def fingerprint(path: Path) -> SourceFileFingerprint:
    stat = path.stat()
    return SourceFileFingerprint(
        path=str(path),
        name=path.name,
        size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        sha256=file_sha256(path),
    )


def write_manifest(
    output_path: Path,
    batch_date: str,
    domain_id: str,
    sources: Iterable[Path],
) -> None:
    payload = {
        "domain_id": domain_id,
        "batch_date": batch_date,
        "sources": [asdict(fingerprint(p)) for p in sources],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
