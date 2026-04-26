import { useEffect, useRef } from "react";
import * as THREE from "three";

export function GlobeBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.z = 26;

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 700;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let index = 0; index < starCount; index += 1) {
      const radius = 30 + Math.random() * 60;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const pointIndex = index * 3;

      positions[pointIndex] = radius * Math.sin(phi) * Math.cos(theta);
      positions[pointIndex + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[pointIndex + 2] = radius * Math.cos(phi);

      colors[pointIndex] = 0.35 + Math.random() * 0.15;
      colors[pointIndex + 1] = 0.8 + Math.random() * 0.2;
      colors[pointIndex + 2] = 0.75 + Math.random() * 0.2;
    }

    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.18,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        vertexColors: true
      })
    );

    const haloGeometry = new THREE.RingGeometry(10, 10.06, 160);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0x5ff3d3,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.rotation.x = Math.PI * 0.46;
    halo.rotation.y = Math.PI * 0.2;

    scene.add(stars);
    scene.add(halo);

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frameId = 0;

    const animate = () => {
      stars.rotation.y += 0.00045;
      stars.rotation.x += 0.00012;
      halo.rotation.z += 0.0018;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      starGeometry.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="globe-backdrop" aria-hidden="true" />;
}
