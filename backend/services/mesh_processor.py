import numpy as np
import trimesh
from skimage import measure
from scipy.ndimage import gaussian_filter
import tempfile
import os
import uuid

def _normalize_mask(mask_data: np.ndarray) -> np.ndarray:
    """
    다양한 형태의 numpy 배열을 3D 볼륨으로 정규화합니다.
    - 4D (C,D,H,W) 또는 (D,H,W,C) → 첫 번째/마지막 채널 선택
    - 2D → 오류 raise
    - 3D → 그대로 사용
    """
    if mask_data.ndim == 4:
        # (C, D, H, W) 또는 (D, H, W, C) 형태 처리
        if mask_data.shape[0] <= 4:  # 채널이 앞에 있는 경우
            mask_data = mask_data[0]
        else:  # 채널이 뒤에 있는 경우
            mask_data = mask_data[..., 0]
    elif mask_data.ndim == 2:
        raise ValueError(f"2D 배열은 지원하지 않습니다. 3D 볼륨 데이터가 필요합니다. (받은 shape: {mask_data.shape})")
    elif mask_data.ndim != 3:
        raise ValueError(f"지원하지 않는 배열 차원: {mask_data.ndim}D (받은 shape: {mask_data.shape})")
    
    return mask_data.astype(np.float32)


def create_mesh_from_mask(mask_data: np.ndarray, threshold: float = 0.5, heatmap_data: np.ndarray = None) -> str:
    """
    3D numpy array (의료 영상 마스크)를 입력받아 Marching Cubes 알고리즘을 통해 
    메쉬를 생성하고 GLB 파일로 저장한 뒤, 파일 경로를 반환합니다.
    XAI(heatmap_data)가 제공되면 메쉬 표면에 히트맵 색상을 입힙니다.
    """
    # 1. 입력 배열 정규화 (4D → 3D 등)
    mask_data = _normalize_mask(mask_data)
    
    print("[MeshProcessor] Starting mesh generation...")
    
    # 마스크에 볼륨 데이터가 존재하는지 확인
    if np.sum(mask_data >= threshold) == 0:
        raise ValueError("마스크에 유효한 voxel이 없습니다. threshold 이상인 값이 0개입니다.")
    
    # 2. 가우시안 스무딩 (Marching Cubes 아티팩트 감소)
    smoothed = gaussian_filter(mask_data, sigma=0.8)
    
    # 3. Marching Cubes 알고리즘으로 메쉬 추출
    verts, faces, normals, values = measure.marching_cubes(smoothed, level=threshold)
    
    print("[MeshProcessor] Marching Cubes extraction completed.")
    
    # 4. Trimesh 객체 생성
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_normals=normals)
    
    # 5. Laplacian 스무딩 (시각적 품질 향상)
    try:
        trimesh.smoothing.filter_laplacian(mesh, iterations=3)
    except Exception:
        pass  # 스무딩 실패 시 원본 유지
    
    # 6. 정점 노멀 재계산 (스무딩 후 노멀이 변경되었을 수 있음)
    mesh.fix_normals()
    
    # 7. PBR 재질(Material) 설정 - GLB 내에 컬러 정보 포함
    if heatmap_data is not None:
        # 히트맵 데이터가 있으면 정점(Vertices) 좌표에서 히트맵 확률값을 샘플링
        import scipy.ndimage
        heatmap_data = _normalize_mask(heatmap_data)
        
        # [XAI 시각화 트릭] Marching Cubes는 표면(확률=0.5)을 추출하므로 표면은 항상 파란색이 됩니다.
        # 내부의 높은 확신도(1.0)가 표면까지 번져 나오도록 Maximum Filter(팽창)를 강하게 적용합니다.
        heatmap_data = scipy.ndimage.maximum_filter(heatmap_data, size=5)
        
        # verts는 (z, y, x) 좌표를 가짐
        probs = scipy.ndimage.map_coordinates(heatmap_data, verts.T, order=1, mode='nearest')
        
        # [핵심] 표면 상의 실제 최대/최소 확률값을 기준으로
        # 동적 정규화(Dynamic Normalization)를 수행하여 무조건 파랑~빨강의 전체 스펙트럼이 나타나도록 합니다.
        surf_min = probs.min()
        surf_max = probs.max()
        
        if surf_max > surf_min + 0.001:
            norm_probs = np.clip((probs - surf_min) / (surf_max - surf_min), 0.0, 1.0)
        else:
            # 변화가 거의 없는 경우 중간값(Yellow)으로 설정
            norm_probs = np.full_like(probs, 0.5)
            
        # Color Map 적용: Blue(낮은 신뢰도) -> Red(높은 신뢰도)
        r = (norm_probs * 255).astype(np.uint8)
        # norm_probs=0: 160(Cyan), norm_probs=0.5: 215(Yellow), norm_probs=1: 50(Red)
        g = (160 + norm_probs * 110).astype(np.uint8) 
        # 수정: Yellow를 거쳐가도록 G값 조정
        # norm_probs=0.0 -> r=0, g=160, b=255 (Cyan)
        # norm_probs=0.5 -> r=127, g=255, b=127 (Green/Yellow)
        # norm_probs=1.0 -> r=255, g=50, b=0 (Red)
        g = np.where(norm_probs < 0.5, 
                     160 + (norm_probs * 2) * 95,      # 0~0.5: 160 -> 255
                     255 - ((norm_probs - 0.5) * 2) * 205).astype(np.uint8) # 0.5~1: 255 -> 50
        b = ((1.0 - norm_probs) * 255).astype(np.uint8)

        a = np.full_like(r, 255)
        
        vertex_colors = np.column_stack((r, g, b, a))
        print("[MeshProcessor] Applied XAI Heatmap to vertex colors.")
    else:
        # 히트맵이 없으면 기존 파란색 단일 톤 적용
        vertex_colors = np.full((len(mesh.vertices), 4), [100, 160, 250, 255], dtype=np.uint8)
        
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, vertex_colors=vertex_colors)
    
    # 8. 임시 디렉토리에 고유 파일명으로 GLB 저장 (동시 요청 충돌 방지)
    temp_dir = tempfile.gettempdir()
    output_path = os.path.join(temp_dir, f"mesh_{uuid.uuid4().hex}.glb")
    
    # GLB(glTF 바이너리) 포맷으로 파일 내보내기 (웹 3D 뷰어 최적화)
    mesh.export(output_path, file_type='glb')
    
    file_size = os.path.getsize(output_path)
    print("[MeshProcessor] [OK] GLB exported successfully.")
    
    return output_path
