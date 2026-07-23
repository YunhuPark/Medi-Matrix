import os
from supabase import create_client, Client
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()

def get_supabase_client() -> Client:
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="Storage service configuration missing.")
    return create_client(supabase_url, supabase_key)

def upload_file_to_supabase(bucket_name: str, file_path: str, destination_path: str, expires_in: int = 600) -> str:
    """
    변환된 GLB 파일을 Supabase Storage에 업로드하고 만료형 Signed URL을 반환합니다.
    """
    supabase = get_supabase_client()
    
    with open(file_path, "rb") as f:
        try:
            supabase.storage.from_(bucket_name).upload(
                file=f,
                path=destination_path,
                file_options={
                    "cacheControl": "0",
                    "upsert": "false",
                    "contentType": "model/gltf-binary"
                }
            )
        except Exception:
            raise HTTPException(status_code=502, detail="Storage upload failed.")
    
    try:
        response = supabase.storage.from_(bucket_name).create_signed_url(destination_path, expires_in)
        signed_url = response.get("signedURL") if isinstance(response, dict) else getattr(response, "signedURL", None)
        if not signed_url and isinstance(response, dict) and "signedUrl" in response:
            signed_url = response["signedUrl"]
        
        if not signed_url:
            raise ValueError("No signedURL in response")
        return signed_url
    except Exception:
        # Cleanup orphan object securely
        try:
            supabase.storage.from_(bucket_name).remove([destination_path])
        except Exception:
            pass
        raise HTTPException(status_code=502, detail="Storage service error.")
import uuid

def validate_user_uuid(user_id: str) -> str:
    try:
        val = uuid.UUID(user_id)
        return str(val)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID format.")

def upload_user_vitals(user_id: str, csv_bytes: bytes) -> None:
    """
    환자의 Vitals CSV 데이터를 Supabase Storage에 업로드 (덮어쓰기) 합니다.
    """
    valid_uuid = validate_user_uuid(user_id)
    supabase = get_supabase_client()
    bucket_name = os.environ.get("SUPABASE_VITALS_BUCKET", "medical-vitals")
    destination_path = f"{valid_uuid}/latest.csv"
    
    try:
        import logging
        logger = logging.getLogger(__name__)
        masked_uuid = f"{valid_uuid[:8]}***"
        logger.info(f"Step: upload_user_vitals_start | Bucket: {bucket_name} | Masked UUID: {masked_uuid}")
        
        res = supabase.storage.from_(bucket_name).upload(
            path=destination_path,
            file=csv_bytes,
            file_options={
                "cache-control": "0",
                "upsert": "true",
                "content-type": "text/csv"
            }
        )
        # Check if response has error dict in older supabase-py versions
        if isinstance(res, dict) and res.get("error"):
            status_code = res.get("statusCode", 502)
            logger.error(f"Step: upload_user_vitals_error_dict | HTTP Status: {status_code}")
            raise HTTPException(status_code=502, detail="Storage upload failed.")
            
        logger.info(f"Step: upload_user_vitals_success | Masked UUID: {masked_uuid}")
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        # Hide original exception detail for security
        logger.error(f"Step: upload_user_vitals_exception | Exception Class: {e.__class__.__name__}")
        raise HTTPException(status_code=502, detail="Storage upload failed.")

def download_user_vitals(user_id: str) -> bytes:
    """
    환자의 최신 Vitals CSV 데이터를 메모리로 다운로드하여 bytes 반환합니다.
    """
    valid_uuid = validate_user_uuid(user_id)
    supabase = get_supabase_client()
    bucket_name = os.environ.get("SUPABASE_VITALS_BUCKET", "medical-vitals")
    source_path = f"{valid_uuid}/latest.csv"
    
    try:
        response = supabase.storage.from_(bucket_name).download(source_path)
        if not response:
            raise ValueError("Empty response")
        return response
    except Exception as e:
        raise HTTPException(status_code=404, detail="Vitals data not found or storage error.")
