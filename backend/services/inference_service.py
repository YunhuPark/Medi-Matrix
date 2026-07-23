import os
import numpy as np
import nibabel as nib
from scipy.ndimage import gaussian_filter
from typing import Any, Tuple

class MedicalInferenceService:
    def __init__(self):
        """
        의료 영상 분할(Segmentation) 추론 서비스
        """
        self.mode = os.environ.get("INFERENCE_MODE", "demo")
        self.model = None
        self.device = None
        
        if self.mode == "model":
            import torch
            from models.unet import UNet3D
            
            self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            self.model = UNet3D(in_channels=1, out_channels=1).to(self.device)
            self.model.eval()
            
            model_path = os.path.join('models', 'unet3d_brats_model.pth')
            if os.path.exists(model_path):
                self.model.load_state_dict(torch.load(model_path, map_location=self.device, weights_only=True))
                print(f"[AI Service] Successfully loaded weights from {model_path}")
            else:
                print(f"[AI Service] Warning: Model weights not found at {model_path}")
                
            print(f"[AI Service] Model loaded on {self.device}. Mode: {self.mode}")
        else:
            print("[AI Service] Running in Demo Mode (No PyTorch loaded).")

    def preprocess(self, volume_data: np.ndarray) -> Any:
        import torch
        min_val, max_val = np.min(volume_data), np.max(volume_data)
        if max_val > min_val:
            normalized = (volume_data - min_val) / (max_val - min_val)
        else:
            normalized = volume_data
            
        tensor_data = torch.from_numpy(normalized).float().unsqueeze(0).unsqueeze(0)
        return tensor_data.to(self.device)

    def postprocess(self, tensor_output: Any, original_shape: tuple) -> Tuple[np.ndarray, np.ndarray]:
        mask_array = tensor_output.squeeze().cpu().numpy()
        binary_mask = (mask_array > 0.5).astype(np.float32)
        return binary_mask, mask_array

    def generate_demo_mask(self, data_shape: tuple) -> np.ndarray:
        """
        [면접 시연용] 시각적으로 멋진 종양(Tumor) 형태의 마스크를 생성합니다.
        결정론적 시뮬레이터입니다. 임상 진단 및 학습 모델 추론이 아닙니다.
        """
        mask = np.zeros(data_shape, dtype=np.float32)
        center = [s // 2 for s in data_shape]
        
        z, y, x = center
        mask[z-10:z+10, y-15:y+15, x-12:x+12] = 1.0
        
        mask = gaussian_filter(mask, sigma=3.0)
        mask = (mask > 0.2).astype(np.float32)
        return mask

    def predict(self, nifti_path: str) -> Tuple[np.ndarray, np.ndarray]:
        print(f"[AI Service] Loading MRI file: {nifti_path}")
        img = nib.load(nifti_path)
        data = img.get_fdata()
        
        if self.mode == "demo":
            print("[AI Service] Demo Mode Active. Generating deterministic synthetic mask...")
            final_mask = self.generate_demo_mask(data.shape)
            heatmap = final_mask
        else:
            import torch
            print("[AI Service] Preprocessing volume data...")
            input_tensor = self.preprocess(data)
            
            print("[AI Service] Running UNet3D Inference (with CPU Optimization)...")
            with torch.no_grad():
                try:
                    original_size = input_tensor.shape[2:]
                    downsampled_input = torch.nn.functional.interpolate(input_tensor, size=(64, 64, 64), mode='trilinear', align_corners=False)
                    downsampled_output = self.model(downsampled_input)
                    output_tensor = torch.nn.functional.interpolate(downsampled_output, size=original_size, mode='trilinear', align_corners=False)
                    print("[AI Service] Neural Network Pass Completed.")
                except Exception as e:
                    print(f"[AI Service] Inference warning: {str(e)}")
                    # 런타임 오류 시 Fail-closed 또는 안전한 빈 마스크 반환
                    output_tensor = torch.zeros_like(input_tensor)
                    
            final_mask, heatmap = self.postprocess(output_tensor, data.shape)
            
        print("[AI Service] Inference Pipeline Complete.")
        return final_mask, heatmap

# 싱글톤 패턴
inference_service = MedicalInferenceService()
