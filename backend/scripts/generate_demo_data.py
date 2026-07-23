import os
import csv
import argparse
import numpy as np
import nibabel as nib
import hashlib
import json
import zipfile
import shutil

def generate_vitals_csv(file_path: str, scenario: str, num_rows: int = 100, force: bool = False):
    if os.path.exists(file_path) and not force:
        print(f"Skipping {file_path} (exists). Use --force to overwrite.")
        return False
        
    headers = ['hr', 'bpSys', 'bpDia', 'resp', 'temp', 'spo2']
    
    # Base ranges for stable
    bases = {
        'hr': 75.0,
        'bpSys': 120.0,
        'bpDia': 80.0,
        'resp': 16.0,
        'temp': 36.5,
        'spo2': 98.0
    }
    
    noise = {
        'hr': 5.0,
        'bpSys': 5.0,
        'bpDia': 5.0,
        'resp': 2.0,
        'temp': 0.2,
        'spo2': 1.0
    }
    
    # Apply scenario offsets
    if scenario == 'warning':
        bases['hr'] += 15.0
        bases['bpSys'] -= 10.0
        bases['temp'] += 1.0
        bases['spo2'] -= 3.0
    elif scenario == 'critical':
        bases['hr'] += 35.0
        bases['bpSys'] -= 30.0
        bases['resp'] += 10.0
        bases['temp'] += 2.0
        bases['spo2'] -= 8.0
        
    data = []
    for _ in range(num_rows):
        row = {}
        for h in headers:
            # Generate random float, clip spoofed values to realistic bounds just in case
            val = np.random.normal(bases[h], noise[h])
            # Ensure spo2 <= 100
            if h == 'spo2' and val > 100.0:
                val = 100.0
            row[h] = round(val, 2)
        data.append(row)
        
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(data)
    
    return True

def generate_3d_volume(nifti_path: str, mask_path: str, force: bool = False):
    skip_nifti = os.path.exists(nifti_path) and not force
    skip_mask = os.path.exists(mask_path) and not force
    
    if skip_nifti and skip_mask:
        print("Skipping 3D volume generation (exists). Use --force to overwrite.")
        return False
        
    # Generate a small 64x64x64 volume
    shape = (64, 64, 64)
    
    # Background noise (synthetic brain tissue)
    volume = np.random.normal(100, 20, shape).astype(np.float32)
    mask = np.zeros(shape, dtype=np.uint8) # boolean equivalent using uint8
    
    # Add a spherical "lesion"
    center = (32, 32, 32)
    radius = 10
    
    z, y, x = np.ogrid[:shape[0], :shape[1], :shape[2]]
    dist_from_center = np.sqrt((x - center[0])**2 + (y - center[1])**2 + (z - center[2])**2)
    
    lesion_mask = dist_from_center <= radius
    
    # Modify volume where lesion is
    volume[lesion_mask] = np.random.normal(180, 10, lesion_mask.sum()).astype(np.float32)
    mask[lesion_mask] = 1
    
    if not skip_nifti:
        os.makedirs(os.path.dirname(nifti_path), exist_ok=True)
        # Create a simple affine
        affine = np.eye(4)
        nii_img = nib.Nifti1Image(volume, affine)
        nib.save(nii_img, nifti_path)
        
    if not skip_mask:
        os.makedirs(os.path.dirname(mask_path), exist_ok=True)
        np.save(mask_path, mask, allow_pickle=False)
        
    return True

def compute_sha256(file_path: str):
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def main():
    parser = argparse.ArgumentParser(description="Generate synthetic demo data for Medi-Matrix.")
    parser.add_argument('--force', action='store_true', help='Overwrite existing files.')
    parser.add_argument('--seed', type=int, default=42, help='Random seed.')
    parser.add_argument('--out-dir', type=str, default='../demo_datasets/generated', help='Output directory relative to script.')
    parser.add_argument('--artifact-dir', type=str, default='../../contest_artifacts', help='ZIP output directory relative to script.')
    parser.add_argument('--package', action='store_true', help='Create ZIP package for Google Drive distribution.')
    
    args = parser.parse_args()
    
    # Set fixed seed
    np.random.seed(args.seed)
    
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), args.out_dir))
    os.makedirs(base_dir, exist_ok=True)
    
    # Copy templates
    templates_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../demo_datasets/templates'))
    templates = ['README_FIRST.md', 'DATASET_CARD.md', 'expected_results.json']
    for t in templates:
        src = os.path.join(templates_dir, t)
        dst = os.path.join(base_dir, t)
        if os.path.exists(src):
            shutil.copy2(src, dst)
    
    # Vitals
    files_to_hash = []
    scenarios = ['stable', 'warning', 'critical']
    for scenario in scenarios:
        csv_path = os.path.join(base_dir, f'synthetic_vitals_{scenario}.csv')
        generated = generate_vitals_csv(csv_path, scenario, force=args.force)
        if generated or os.path.exists(csv_path):
            files_to_hash.append(csv_path)
            
    # 3D Volume
    nifti_path = os.path.join(base_dir, 'synthetic_brain_like_volume.nii.gz')
    mask_path = os.path.join(base_dir, 'synthetic_lesion_mask.npy')
    generated_3d = generate_3d_volume(nifti_path, mask_path, force=args.force)
    
    if generated_3d or (os.path.exists(nifti_path) and os.path.exists(mask_path)):
        files_to_hash.append(nifti_path)
        files_to_hash.append(mask_path)
        
    # Write manifest
    manifest_path = os.path.join(base_dir, 'manifest.json')
    if os.path.exists(manifest_path) and not args.force:
        pass
    else:
        manifest = {
            "seed": args.seed,
            "description": "100% Synthetic Demo Dataset for Competition",
            "files": {}
        }
        
        total_size = 0
        for f in files_to_hash:
            size = os.path.getsize(f)
            total_size += size
            file_name = os.path.basename(f)
            file_info = {
                "filename": file_name,
                "size_bytes": size,
                "sha256": compute_sha256(f),
                "synthetic": True,
                "contains_phi": False,
                "clinical_validation": False,
                "diagnostic_use": False
            }
            if file_name.endswith('.csv'):
                file_info["format"] = "csv"
                file_info["purpose"] = "시계열 생체신호 스트리밍 시뮬레이션"
                file_info["rows"] = 100
                file_info["columns"] = 6
                file_info["finite_values"] = True
                
                if 'stable' in file_name:
                    file_info["scenario"] = "stable"
                elif 'warning' in file_name:
                    file_info["scenario"] = "warning"
                else:
                    file_info["scenario"] = "critical"
                    
            elif file_name.endswith('.npy'):
                file_info["format"] = "npy"
                file_info["purpose"] = "3D 메쉬 생성용 마스크 배열"
                mask_arr = np.load(f)
                file_info["shape"] = list(mask_arr.shape)
                file_info["dtype"] = str(mask_arr.dtype)
                file_info["finite_values"] = True
            elif file_name.endswith('.nii.gz'):
                file_info["format"] = "nifti"
                file_info["purpose"] = "3D 영상 파이프라인 테스트용 팬텀 볼륨"
                vol = nib.load(f)
                file_info["shape"] = list(vol.shape)
                file_info["dtype"] = str(vol.get_data_dtype())
                file_info["finite_values"] = True
                
            manifest["files"][file_name] = file_info
            
        manifest["total_size_bytes"] = total_size
        
        with open(manifest_path, 'w', encoding='utf-8') as mf:
            json.dump(manifest, mf, indent=2, ensure_ascii=False)
            
        print("Demo data generation complete. Manifest created.")
        print(f"Total size: {total_size / 1024 / 1024:.2f} MB")
        
    if args.package:
        # Create a ZIP file containing ONLY the generated output
        contest_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), args.artifact_dir))
        os.makedirs(contest_dir, exist_ok=True)
        zip_path = os.path.join(contest_dir, "Medi-Matrix_Contest_Demo.zip")
        
        # We define an explicit allow-list of files to include from base_dir
        allow_list = [
            'README_FIRST.md',
            'DATASET_CARD.md',
            'expected_results.json',
            'manifest.json',
            'synthetic_brain_like_volume.nii.gz',
            'synthetic_lesion_mask.npy',
            'synthetic_vitals_stable.csv',
            'synthetic_vitals_warning.csv',
            'synthetic_vitals_critical.csv'
        ]
        
        # Check if all files exist
        missing_files = []
        for item in allow_list:
            if not os.path.exists(os.path.join(base_dir, item)):
                missing_files.append(item)
                
        if missing_files:
            print(f"ERROR: Cannot create ZIP. Missing required files: {missing_files}")
            if os.path.exists(zip_path):
                os.remove(zip_path)
            sys.exit(1)
            
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for item in allow_list:
                item_path = os.path.join(base_dir, item)
                zipf.write(item_path, arcname=item)
                    
        print(f"Package created at: {zip_path}")

if __name__ == "__main__":
    main()
