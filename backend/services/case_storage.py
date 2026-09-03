"""Case-scoped storage helpers for the Medi-Matrix demo workflow.

The public Case ID is opaque and non-PHI. Storage remains isolated by the
authenticated Supabase user first, then by Case ID. A future PACS/EMR adapter
can map a hospital encounter to this internal Case ID without exposing MRNs or
patient names in object paths.
"""

from __future__ import annotations

import os

from fastapi import HTTPException

from core.case_context import case_storage_prefix
from services.supabase_client import get_supabase_client, validate_user_uuid


def case_vitals_path(user_id: str, case_id: str) -> str:
    valid_user_id = validate_user_uuid(user_id)
    return f"{case_storage_prefix(valid_user_id, case_id)}/vitals.csv"


def upload_case_vitals(user_id: str, case_id: str, csv_bytes: bytes) -> None:
    """Store one validated Vitals CSV under the authenticated user's Case ID."""
    supabase = get_supabase_client()
    bucket_name = os.environ.get("SUPABASE_VITALS_BUCKET", "medical-vitals")
    destination_path = case_vitals_path(user_id, case_id)

    try:
        response = supabase.storage.from_(bucket_name).upload(
            path=destination_path,
            file=csv_bytes,
            file_options={
                "cache-control": "0",
                "upsert": "true",
                "content-type": "text/csv",
            },
        )
        if isinstance(response, dict) and response.get("error"):
            raise HTTPException(status_code=502, detail="Storage upload failed.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Storage upload failed.")


def download_case_vitals(user_id: str, case_id: str) -> bytes:
    """Read the Vitals CSV belonging to one authenticated user/case pair."""
    supabase = get_supabase_client()
    bucket_name = os.environ.get("SUPABASE_VITALS_BUCKET", "medical-vitals")
    source_path = case_vitals_path(user_id, case_id)

    try:
        response = supabase.storage.from_(bucket_name).download(source_path)
        if not response:
            raise ValueError("Empty response")
        return response
    except Exception:
        raise HTTPException(status_code=404, detail="Case Vitals data not found.")
