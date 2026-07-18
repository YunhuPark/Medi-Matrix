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
        raise HTTPException(status_code=502, detail="Failed to create signed URL.")
