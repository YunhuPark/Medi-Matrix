import numpy as np
import nibabel as nib
from scipy.ndimage import gaussian_filter
import os

def generate_brain_mask(shape=(128, 128, 128)):
    """
    좌뇌와 우뇌를 나타내는 두 개의 타원체를 그리고,
    표면에 가우시안 노이즈와 블러를 줘서 실제 뇌처럼 주름지고 유기적인 형태를 생성합니다.
    """
    print(f"Generating realistic Brain 3D mask with shape {shape}...")
    mask = np.zeros(shape, dtype=np.float32)
    cx, cy, cz = shape[0] // 2, shape[1] // 2, shape[2] // 2
    
    # Grid coordinates
    x, y, z = np.ogrid[:shape[0], :shape[1], :shape[2]]
    
    # Left hemisphere (좌뇌)
    dx1, dy1, dz1 = (x - (cx - 16)) / 22.0, (y - cy) / 34.0, (z - cz) / 26.0
    mask[dx1**2 + dy1**2 + dz1**2 <= 1.0] = 1.0
    
    # Right hemisphere (우뇌)
    dx2, dy2, dz2 = (x - (cx + 16)) / 22.0, (y - cy) / 34.0, (z - cz) / 26.0
    mask[dx2**2 + dy2**2 + dz2**2 <= 1.0] = 1.0
    
    # Add noise to make it look organic (sulci/gyri effect)
    noise = np.random.normal(0, 0.4, shape)
    mask_noisy = mask + noise * mask # Only add noise where mask is present
    
    # Gaussian blur
    mask_blurred = gaussian_filter(mask_noisy, sigma=2.0)
    
    # Thresholding
    binary_mask = (mask_blurred > 0.35).astype(np.uint8)
    
    # Add some random blobs (tumors/lesions) internally
    num_lesions = 3
    for _ in range(num_lesions):
        lx = np.random.randint(cx - 20, cx + 20)
        ly = np.random.randint(cy - 20, cy + 20)
        lz = np.random.randint(cz - 10, cz + 10)
        temp = np.zeros(shape, dtype=np.float32)
        temp[lx, ly, lz] = 1.0
        blob = gaussian_filter(temp, sigma=np.random.uniform(3, 8))
        binary_mask[blob > 0.05] = 1

    return binary_mask

def generate_blobby_mask(shape=(128, 128, 128), num_blobs=5, max_radius=15):
    """
    여러 개의 가우시안 블롭(Blob)을 생성하여 하나로 합친 뒤, 
    임계값을 적용해 실제 종양/결절처럼 불규칙하고 울퉁불퉁한 3D 마스크를 만듭니다.
    """
    print(f"Generating realistic 3D mask with shape {shape}...")
    mask = np.zeros(shape, dtype=np.float32)
    
    # 맵 중심부 근처에 블롭들 배치
    center = np.array(shape) // 2
    
    for _ in range(num_blobs):
        # 중심 주변으로 무작위 오프셋
        offset = np.random.randint(-20, 20, size=3)
        blob_center = center + offset
        
        # 빈 배열에 점 하나 찍기
        temp = np.zeros(shape, dtype=np.float32)
        
        # 배열 범위를 벗어나지 않도록 클리핑
        x = np.clip(blob_center[0], 0, shape[0]-1)
        y = np.clip(blob_center[1], 0, shape[1]-1)
        z = np.clip(blob_center[2], 0, shape[2]-1)
        
        temp[x, y, z] = 1.0
        
        # 가우시안 블러를 강하게 주어서 구(Sphere)처럼 퍼지게 만듦
        # 각 축마다 sigma 값을 다르게 주어 찌그러진 타원형(불규칙한) 형태 생성
        sigma = np.random.uniform(max_radius * 0.5, max_radius * 1.5, size=3)
        blob = gaussian_filter(temp, sigma=sigma)
        
        mask += blob

    # 노이즈 추가 (표면을 울퉁불퉁하게 만듦)
    noise = np.random.normal(0, np.max(mask)*0.1, shape)
    mask += noise

    # 정규화 및 Threshold 적용
    mask = mask / np.max(mask)
    binary_mask = (mask > 0.4).astype(np.uint8) # 0.4 이상을 1로
    
    return binary_mask

if __name__ == "__main__":
    out_dir = "demo_datasets"
    os.makedirs(out_dir, exist_ok=True)
    
    # 1. 실제 뇌(Brain) 모양의 메쉬 생성
    np.random.seed(42) # 재현성을 위해 시드 고정
    brain_mask = generate_brain_mask(shape=(128, 128, 128))
    
    # NIfTI로 저장
    brain_nii = nib.Nifti1Image(brain_mask, affine=np.eye(4))
    nib.save(brain_nii, os.path.join(out_dir, "brain_tumor_demo.nii.gz"))
    # numpy로도 저장
    np.save(os.path.join(out_dir, "brain_tumor_demo.npy"), brain_mask)
    
    print(f"[Done] Brain Tumor Demo created. Volume: {np.sum(brain_mask)} voxels")
    
    # 2. 폐 결절(Lung Nodule) 느낌의 작은 멀티플 매스 생성
    np.random.seed(99)
    lung_mask = generate_blobby_mask(shape=(128, 128, 128), num_blobs=3, max_radius=6)
    
    # NIfTI로 저장
    lung_nii = nib.Nifti1Image(lung_mask, affine=np.eye(4))
    nib.save(lung_nii, os.path.join(out_dir, "lung_nodule_demo.nii.gz"))
    # numpy로도 저장
    np.save(os.path.join(out_dir, "lung_nodule_demo.npy"), lung_mask)
    
    print(f"[Done] Lung Nodule Demo created. Volume: {np.sum(lung_mask)} voxels")
    
    print(f"\n✅ All demo datasets saved in '{out_dir}/' folder.")
