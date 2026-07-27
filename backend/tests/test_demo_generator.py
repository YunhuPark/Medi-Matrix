import os
import sys
import numpy as np
import nibabel as nib
import pytest
import csv
import hashlib

# Add parent directory to sys.path to import scripts
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.generate_demo_data import generate_vitals_csv, generate_3d_volume, compute_sha256

def test_generate_vitals_csv_reproducibility_and_schema(tmp_path):
    # Test reproducibility
    np.random.seed(42)
    file1 = tmp_path / "vitals1.csv"
    generate_vitals_csv(str(file1), "stable", num_rows=100)
    
    np.random.seed(42)
    file2 = tmp_path / "vitals2.csv"
    generate_vitals_csv(str(file2), "stable", num_rows=100)
    
    assert compute_sha256(str(file1)) == compute_sha256(str(file2))
    
    # Test schema and data validity
    with open(file1, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames
        expected_headers = ['hr', 'bpSys', 'bpDia', 'resp', 'temp', 'spo2']
        assert set(headers) == set(expected_headers)
        
        rows = list(reader)
        assert len(rows) == 100
        
        for row in rows:
            for h in expected_headers:
                val = float(row[h])
                assert np.isfinite(val)
                if h == 'spo2':
                    assert val <= 100.0

def test_generate_vitals_scenarios(tmp_path):
    np.random.seed(42)
    stable_file = tmp_path / "stable.csv"
    generate_vitals_csv(str(stable_file), "stable", num_rows=100)
    
    np.random.seed(42)
    critical_file = tmp_path / "critical.csv"
    generate_vitals_csv(str(critical_file), "critical", num_rows=100)
    
    # Check that hr in critical is on average higher than stable
    def get_avg_hr(fpath):
        with open(fpath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return np.mean([float(row['hr']) for row in reader])
            
    assert get_avg_hr(str(critical_file)) > get_avg_hr(str(stable_file))

def test_generate_3d_volume_reproducibility(tmp_path):
    np.random.seed(42)
    nifti1 = tmp_path / "vol1.nii.gz"
    mask1 = tmp_path / "mask1.npy"
    generate_3d_volume(str(nifti1), str(mask1))
    
    np.random.seed(42)
    nifti2 = tmp_path / "vol2.nii.gz"
    mask2 = tmp_path / "mask2.npy"
    generate_3d_volume(str(nifti2), str(mask2))
    
    assert compute_sha256(str(nifti1)) == compute_sha256(str(nifti2))
    assert compute_sha256(str(mask1)) == compute_sha256(str(mask2))
    
    # Check shape and dtype
    vol = nib.load(str(nifti1))
    assert vol.shape == (64, 64, 64)
    # nifti format maps np.float32 appropriately
    
    mask = np.load(str(mask1))
    assert mask.shape == (64, 64, 64)
    assert mask.dtype == np.uint8
    assert not np.isnan(mask).any()

def test_no_overwrite_without_force(tmp_path, capsys):
    np.random.seed(42)
    file1 = tmp_path / "vitals.csv"
    generate_vitals_csv(str(file1), "stable", num_rows=10)
    
    # Try to generate again without force
    result = generate_vitals_csv(str(file1), "stable", num_rows=10)
    assert not result
    
    captured = capsys.readouterr()
    assert "Use --force to overwrite" in captured.out
    
    # Try to generate again with force
    result2 = generate_vitals_csv(str(file1), "stable", num_rows=10, force=True)
    assert result2

def test_package_creation_strict(tmp_path):
    import subprocess
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../scripts/generate_demo_data.py"))
    
    # We run the script in a subprocess with custom out-dir and artifact-dir
    out_dir = tmp_path / "generated"
    artifact_dir = tmp_path / "artifacts"
    
    # Copy real templates to a tmp template dir
    import shutil
    from pathlib import Path
    template_dir = tmp_path / "templates"
    template_dir.mkdir()
    real_template_dir = Path(script_path).parent.parent / "demo_datasets/templates"
    for t in ['README_FIRST.md', 'DATASET_CARD.md', 'expected_results.json']:
        shutil.copy2(real_template_dir / t, template_dir / t)
        
    env = os.environ.copy()
    result = subprocess.run([
        sys.executable, script_path, 
        "--force", "--package", 
        "--out-dir", str(out_dir),
        "--artifact-dir", str(artifact_dir),
        "--template-dir", str(template_dir)
    ], capture_output=True, text=True, env=env)
    
    assert result.returncode == 0
    
    zip_path = artifact_dir / "Medi-Matrix_Contest_Demo.zip"
    assert zip_path.exists()
    
    allow_list = {
        'README_FIRST.md',
        'DATASET_CARD.md',
        'expected_results.json',
        'manifest.json',
        'synthetic_brain_like_volume.nii.gz',
        'synthetic_lesion_mask.npy',
        'synthetic_vitals_stable.csv',
        'synthetic_vitals_warning.csv',
        'synthetic_vitals_critical.csv'
    }
    
    import zipfile
    import json
    
    with zipfile.ZipFile(zip_path, 'r') as zipf:
        namelist = set(zipf.namelist())
        assert namelist == allow_list, f"ZIP contents mismatch. Found: {namelist}"
        
        # Check manifest fields
        with zipf.open('manifest.json') as mf:
            manifest = json.load(mf)
            
        assert manifest["seed"] == 42
        files = manifest["files"]
        assert set(files.keys()) == {
            'synthetic_brain_like_volume.nii.gz',
            'synthetic_lesion_mask.npy',
            'synthetic_vitals_stable.csv',
            'synthetic_vitals_warning.csv',
            'synthetic_vitals_critical.csv'
        }
        
        for k, v in files.items():
            assert v["synthetic"] is True
            assert v["contains_phi"] is False
            assert v["clinical_validation"] is False
            assert v["diagnostic_use"] is False
            
            # verify hash against the one in zip
            with zipf.open(k) as zitem:
                file_data = zitem.read()
                import hashlib
                sha256 = hashlib.sha256(file_data).hexdigest()
                assert v["sha256"] == sha256
                
def test_package_failure_missing_files(tmp_path):
    import subprocess
    script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../scripts/generate_demo_data.py"))
    
    out_dir = tmp_path / "generated_fail"
    artifact_dir = tmp_path / "artifacts"
    
    import shutil
    from pathlib import Path
    
    # We want to test if packaging fails when a file is missing.
    # Create tmp template dir and intentionally omit README_FIRST.md
    template_dir = tmp_path / "templates"
    template_dir.mkdir()
    real_template_dir = Path(script_path).parent.parent / "demo_datasets/templates"
    for t in ['DATASET_CARD.md', 'expected_results.json']:
        shutil.copy2(real_template_dir / t, template_dir / t)
    
    env = os.environ.copy()
    result = subprocess.run([
        sys.executable, script_path, 
        "--package", 
        "--out-dir", str(out_dir),
        "--artifact-dir", str(artifact_dir),
        "--template-dir", str(template_dir)
    ], capture_output=True, text=True, env=env)
    
    assert result.returncode == 1
    assert "Missing required files" in result.stderr
    assert "Traceback" not in result.stderr
    assert "NameError" not in result.stderr
    
    # Ensure no absolute paths in stderr/stdout
    assert str(Path(script_path).parent.parent.absolute()) not in result.stderr
    assert str(Path(script_path).parent.parent.absolute()) not in result.stdout
    
    zip_path = artifact_dir / "Medi-Matrix_Contest_Demo.zip"
    assert not zip_path.exists(), "Partial ZIP should be deleted on failure"
    
    # Ensure no .bak file in real template dir
    bak_file = real_template_dir / "README_FIRST.bak"
    assert not bak_file.exists(), "Should not create .bak files in real template dir"
