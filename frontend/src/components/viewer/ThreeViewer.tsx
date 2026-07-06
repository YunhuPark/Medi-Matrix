import React, { useEffect, useRef, useMemo, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { useViewerStore } from '../../store/useViewerStore';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ─────────────────────────────────────────
// 내부 씬 컴포넌트: GLB 모델 렌더링
// ─────────────────────────────────────────
interface ModelSceneProps {
  loadedGroup: THREE.Group | null;
}

function ModelScene({ loadedGroup }: ModelSceneProps) {
  const { camera, gl } = useThree();
  const opacity = useViewerStore((state) => state.opacity);
  const groupRef = useRef<THREE.Group>(null!);
  const placeholderRef = useRef<THREE.Mesh>(null!);

  const controlsRef = useRef<any>(null);

  // loadedGroup가 변경될 때: 그룹 내용 교체 + 카메라 자동 조정
  useEffect(() => {
    const container = groupRef.current;
    if (!container) return;

    // 기존 자식 제거
    while (container.children.length > 0) {
      container.remove(container.children[0]);
    }

    if (!loadedGroup) return;

    // 딥 클론하여 추가
    const clone = loadedGroup.clone(true);
    container.add(clone);

    // 바운딩 박스 기반 중앙 정렬 (인위적인 스케일링 제거)
    const box = new THREE.Box3().setFromObject(container);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // 중앙으로 이동
    container.position.set(-center.x, -center.y, -center.z);

    // 실제 크기 기준으로 카메라 위치 자동 조정
    const sphere = new THREE.Box3().setFromObject(container).getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius * 2.5; // 모델 크기에 비례하는 거리
    
    // 모델의 대각선 뷰에서 바라보도록 설정
    camera.position.set(dist * 0.7, dist * 0.5, dist);
    camera.lookAt(0, 0, 0);

    // near/far 클리핑 동적 조정 (줌 시 모델 크기에 맞게)
    const perspCamera = camera as THREE.PerspectiveCamera;
    perspCamera.near = sphere.radius * 0.01;
    perspCamera.far = sphere.radius * 100;
    perspCamera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }

    console.log('[ThreeViewer] Model placed. Size:', size.x.toFixed(1), size.y.toFixed(1), size.z.toFixed(1), 'Radius:', sphere.radius.toFixed(1));
  }, [loadedGroup, camera]);

  // 투명도 실시간 적용 (매 프레임)
  useFrame(() => {
    const container = groupRef.current;
    if (!container) return;

    container.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        if (mat.opacity !== opacity) {
          mat.transparent = true;
          mat.opacity = opacity;
          mat.needsUpdate = true;
        }
      }
    });

    // 플레이스홀더 애니메이션 및 투명도
    if (placeholderRef.current && placeholderRef.current.visible) {
      placeholderRef.current.rotation.x += 0.005;
      placeholderRef.current.rotation.y += 0.01;
      
      const mat = placeholderRef.current.material as THREE.MeshStandardMaterial;
      if (mat.opacity !== opacity) {
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
    }
  });

  return (
    <>
      {/* 조명 설정 */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-5, -5, -5]} intensity={0.4} />
      <directionalLight position={[0, 10, -5]} intensity={0.3} />

      {/* 궤도 컨트롤 */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.5}
        enableZoom={true}
        zoomSpeed={2.5}
        panSpeed={0.5}
      />

      {/* 모델 컨테이너 */}
      <group ref={groupRef} />

      {/* 플레이스홀더 (모델 없을 때) */}
      <mesh ref={placeholderRef} visible={!loadedGroup}>
        <icosahedronGeometry args={[1.2, 1]} />
        <meshStandardMaterial
          color="#22d3ee"
          wireframe={true}
          transparent
          opacity={opacity}
        />
      </mesh>
    </>
  );
}

// ─────────────────────────────────────────
// 메인 ThreeViewer 컴포넌트
// ─────────────────────────────────────────
export const ThreeViewer: React.FC = () => {
  const modelUrl = useViewerStore((state) => state.modelUrl);
  const [loadedGroup, setLoadedGroup] = useState<THREE.Group | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // modelUrl이 변경될 때 GLB 로드
  useEffect(() => {
    if (!modelUrl) {
      setLoadedGroup(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;

    console.log('[ThreeViewer] Loading GLB from:', modelUrl);
    setIsLoading(true);
    setLoadError(null);

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (cancelled) return;
        console.log('[ThreeViewer] GLB loaded successfully');

        const group = new THREE.Group();
        group.add(gltf.scene);

        // 메쉬에 머터리얼 적용 + 노멀 재계산
        let meshCount = 0;
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshCount++;

            // Marching Cubes 출력의 노멀 재계산
            if (child.geometry) {
              child.geometry.computeVertexNormals();
            }

            // 의료 영상에 적합한 머터리얼로 교체 (Vertex Colors 활성화)
            child.material = new THREE.MeshPhongMaterial({
              color: '#ffffff', // 정점 색상을 그대로 보여주기 위해 흰색으로 설정
              vertexColors: true, // GLB에 내장된 XAI 히트맵 색상 사용!
              emissive: '#111111', // 자연스러운 음영을 위해 emissive 낮춤
              specular: '#ffffff',
              shininess: 60,
              transparent: true,
              opacity: 1.0,
              side: THREE.DoubleSide,
              flatShading: false,
              depthWrite: true,
            });
          }
        });

        console.log(`[ThreeViewer] ${meshCount} mesh(es) processed`);
        setLoadedGroup(group);
        setIsLoading(false);
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = ((progress.loaded / progress.total) * 100).toFixed(0);
          console.log(`[ThreeViewer] Loading: ${pct}%`);
        }
      },
      (error) => {
        if (cancelled) return;
        console.error('[ThreeViewer] GLB load error:', error);
        setLoadError(error instanceof Error ? error.message : String(error));
        setIsLoading(false);
      }
    );

    // cleanup: 이전 요청만 무효화, 모델은 유지 (새 모델이 로드되면 자동 교체)
    return () => {
      cancelled = true;
    };
  }, [modelUrl]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: 'transparent',
      borderRadius: '16px',
      overflow: 'hidden',
      position: 'relative',
      boxShadow: 'inset 0 0 40px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.05)'
    }}>
      {/* 로딩 오버레이 */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(11, 12, 16, 0.7)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 10,
          color: 'var(--accent-cyan)',
          fontSize: '1.1rem',
          fontWeight: 500,
          gap: '0.75rem',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="40 20" />
          </svg>
          3D 메쉬 렌더링 중...
        </div>
      )}

      {/* 에러 오버레이 */}
      {loadError && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(11, 12, 16, 0.8)',
          zIndex: 10,
          color: 'var(--accent-red)',
          fontSize: '0.95rem',
          padding: '2rem',
          textAlign: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          ❌ GLB 로드 실패: {loadError}
        </div>
      )}

      <Canvas camera={{ position: [0, 0, 5], fov: 50, near: 0.01, far: 500 }} style={{ background: 'transparent' }}>
        <ModelScene loadedGroup={loadedGroup} />
      </Canvas>
    </div>
  );
};
