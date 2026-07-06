import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# 환경 변수에서 Supabase 설정 가져오기
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

def get_supabase_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def upload_file_to_supabase(bucket_name: str, file_path: str, destination_path: str) -> str:
    """
    변환된 GLB 파일을 Supabase Storage에 업로드하고 웹에서 접근 가능한 Public URL을 반환합니다.
    """
    supabase = get_supabase_client()
    
    with open(file_path, "rb") as f:
        # 파일 업로드 실행 (upsert 옵션으로 덮어쓰기 허용)
        supabase.storage.from_(bucket_name).upload(
            file=f,
            path=destination_path,
            file_options={
                "cacheControl": "3600",
                "upsert": "true",
                "contentType": "model/gltf-binary"
            }
        )
    
    # 파일의 Public URL 반환 (프론트엔드 R3F 뷰어에 전달됨)
    public_url = supabase.storage.from_(bucket_name).get_public_url(destination_path)
    return public_url
