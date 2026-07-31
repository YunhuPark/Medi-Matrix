import numpy as np
import nibabel as nib
from scipy.ndimage import gaussian_filter
import os

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
    
    # 1. 뇌종양(Brain Tumor) 느낌의 큰 매스(Mass) 생성
    np.random.seed(42) # 재현성을 위해 시드 고정
    brain_mask = generate_blobby_mask(shape=(128, 128, 128), num_blobs=8, max_radius=12)
    
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
