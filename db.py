# 応募履歴・返信スレッドの永続化（SQLite）

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "applications.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_text TEXT NOT NULL,
                diagnosis_json TEXT,
                application_text TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                application_id INTEGER NOT NULL
                    REFERENCES applications(id) ON DELETE CASCADE,
                client_message TEXT NOT NULL,
                suggested_response TEXT,
                created_at TEXT NOT NULL
            )
            """
        )


def _title_from_job_text(job_text: str, max_len: int = 40) -> str:
    first_line = job_text.strip().splitlines()[0] if job_text.strip() else ""
    first_line = first_line.strip()
    if len(first_line) > max_len:
        return first_line[:max_len] + "…"
    return first_line or "（無題の案件）"


def save_application(job_text: str, diagnosis: dict | None, application_text: str) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO applications (job_text, diagnosis_json, application_text, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                job_text,
                json.dumps(diagnosis, ensure_ascii=False) if diagnosis else None,
                application_text,
                _now(),
            ),
        )
        return cursor.lastrowid


def list_applications() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                a.id,
                a.job_text,
                a.diagnosis_json,
                a.created_at,
                COUNT(r.id) AS reply_count,
                MAX(r.created_at) AS last_reply_at
            FROM applications a
            LEFT JOIN replies r ON r.application_id = a.id
            GROUP BY a.id
            ORDER BY a.created_at DESC
            """
        ).fetchall()

    results = []
    for row in rows:
        diagnosis = json.loads(row["diagnosis_json"]) if row["diagnosis_json"] else None
        results.append(
            {
                "id": row["id"],
                "title": _title_from_job_text(row["job_text"]),
                "judgment": diagnosis.get("judgment") if diagnosis else None,
                "score": diagnosis.get("score") if diagnosis else None,
                "created_at": row["created_at"],
                "reply_count": row["reply_count"],
                "last_reply_at": row["last_reply_at"],
            }
        )
    return results


def get_application(application_id: int) -> dict | None:
    with get_connection() as conn:
        app_row = conn.execute(
            "SELECT * FROM applications WHERE id = ?", (application_id,)
        ).fetchone()
        if app_row is None:
            return None

        reply_rows = conn.execute(
            """
            SELECT id, client_message, suggested_response, created_at
            FROM replies
            WHERE application_id = ?
            ORDER BY created_at ASC
            """,
            (application_id,),
        ).fetchall()

    diagnosis = (
        json.loads(app_row["diagnosis_json"]) if app_row["diagnosis_json"] else None
    )

    return {
        "id": app_row["id"],
        "title": _title_from_job_text(app_row["job_text"]),
        "job_text": app_row["job_text"],
        "diagnosis": diagnosis,
        "application_text": app_row["application_text"],
        "created_at": app_row["created_at"],
        "replies": [
            {
                "id": r["id"],
                "client_message": r["client_message"],
                "suggested_response": r["suggested_response"],
                "created_at": r["created_at"],
            }
            for r in reply_rows
        ],
    }


def add_reply(application_id: int, client_message: str, suggested_response: str) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO replies (application_id, client_message, suggested_response, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (application_id, client_message, suggested_response, _now()),
        )
        return cursor.lastrowid


def delete_application(application_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM applications WHERE id = ?", (application_id,)
        )
        return cursor.rowcount > 0
