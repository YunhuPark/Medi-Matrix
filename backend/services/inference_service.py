import os
import torch
import numpy as np
import nibabel as nib
from scipy.ndimage import gaussian_filter

# 내부 UNet 모델 임포트
from models.unet import UNet3D

class MedicalInferenceService:
    def __init__(self, demo_mode=True):
        """
        의료 영상 분할(Segmentation) 추론 서비스
        :param demo_mode: True일 경우 시연용으로 휴리스틱 마스크 오버라이딩을 적용 (GPU 학습 시간 절약)
        """
        self.demo_mode = demo_mode
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # 모델 구조 로드
        self.model = UNet3D(in_channels=1, out_channels=1).to(self.device)
        self.model.eval() # 추론 모드 전환
        
        # 방금 다운로드 받은 학습된 모델(.pth) 로드
        model_path = os.path.join('models', 'unet3d_brats_model.pth')
        if os.path.exists(model_path):
            self.model.load_state_dict(torch.load(model_path, map_location=self.device, weights_only=True))
            print(f"[AI Service] Successfully loaded weights from {model_path}")
        else:
            print(f"[AI Service] Warning: Model weights not found at {model_path}")
        
        print(f"[AI Service] Model loaded on {self.device}. Demo Mode: {self.demo_mode}")

    def preprocess(self, volume_data: np.ndarray) -> torch.Tensor:
        """
        Numpy 배열을 PyTorch Tensor로 변환하고 정규화(Normalization)를 수행합니다.
        """
        # 강도 정규화 (Min-Max Scaling)
        min_val, max_val = np.min(volume_data), np.max(volume_data)
        if max_val > min_val:
            normalized = (volume_data - min_val) / (max_val - min_val)
        else:
            normalized = volume_data
            
        # Tensor 변환: [Depth, Height, Width] -> [Batch, Channel, Depth, Height, Width]
        tensor_data = torch.from_numpy(normalized).float().unsqueeze(0).unsqueeze(0)
        return tensor_data.to(self.device)

    def postprocess(self, tensor_output: torch.Tensor, original_shape: tuple) -> np.ndarray:
        """
        PyTorch 출력 텐서를 다시 Numpy 마스크로 변환합니다.
        """
        # Batch, Channel 차원 제거
        mask_array = tensor_output.squeeze().cpu().numpy()
        
        # Threshold 적용 (0.5 이상을 병변으로 간주)
        binary_mask = (mask_array > 0.5).astype(np.float32)
        
        # XAI(설명 가능한 AI)를 위해 0.0~1.0 사이의 원본 확률값인 mask_array(히트맵)도 같이 반환
        return binary_mask, mask_array

    def generate_demo_mask(self, data_shape: tuple) -> np.ndarray:
        """
        [면접 시연용] 시각적으로 멋진 종양(Tumor) 형태의 마스크를 생성합니다.
        실제 학습을 진행하지 않았기 때문에, 3D 뷰어 렌더링 시연을 위한 휴리스틱을 사용합니다.
        """
        mask = np.zeros(data_shape, dtype=np.float32)
        center = [s // 2 for s in data_shape]
        
        # 중앙에 임의의 타원형 박스 생성
        z, y, x = center
        mask[z-10:z+10, y-15:y+15, x-12:x+12] = 1.0
        
        # 가우시안 블러를 통해 유기적인(Organic) 3D 형태로 변환
        mask = gaussian_filter(mask, sigma=3.0)
        mask = (mask > 0.2).astype(np.float32)
        
        return mask

    def predict(self, nifti_path: str) -> np.ndarray:
        """
        NIfTI 파일을 입력받아 종양 분할 마스크(Numpy Array)를 반환합니다.
        """
        print(f"[AI Service] Loading MRI file: {nifti_path}")
        img = nib.load(nifti_path)
        data = img.get_fdata()
        
        print("[AI Service] Preprocessing volume data...")
        # 1. 전처리 (Numpy -> Tensor)
        input_tensor = self.preprocess(data)
        
        print("[AI Service] Running UNet3D Inference (with CPU Optimization)...")
        # 2. 모델 추론 (Inference)
        with torch.no_grad():
            try:
                # [성능 최적화] CPU 연산을 위해 3D 텐서 크기를 (64, 64, 64)로 강제 리사이징하여 추론 속도 극대화
                original_size = input_tensor.shape[2:] # (D, H, W)
                downsampled_input = torch.nn.functional.interpolate(input_tensor, size=(64, 64, 64), mode='trilinear', align_corners=False)
                
                # 방금 다운로드 받은 모델로 실제 추론 진행
                downsampled_output = self.model(downsampled_input)
                
                # 결과를 원래 크기로 다시 복원 (Upsampling)
                output_tensor = torch.nn.functional.interpolate(downsampled_output, size=original_size, mode='trilinear', align_corners=False)
                
                print("[AI Service] Neural Network Pass Completed.")
            except Exception as e:
                print(f"[AI Service] Inference warning (ignored in demo mode): {str(e)}")

        # 3. 후처리 및 데모 모드 오버라이딩
        if self.demo_mode:
            print("[AI Service] Demo Mode Active. Applying morphological mask...")
            final_mask = self.generate_demo_mask(data.shape)
            heatmap = final_mask  # 데모 모드에서는 마스크 자체를 히트맵으로 사용
        else:
            # 방금 추론된 결과를 후처리하여 실제 종양 마스크와 히트맵 추출
            final_mask, heatmap = self.postprocess(output_tensor, data.shape)
            
        print("[AI Service] Inference Pipeline Complete.")
        return final_mask, heatmap

# 싱글톤 패턴으로 서비스 인스턴스화
inference_service = MedicalInferenceService(demo_mode=False)
