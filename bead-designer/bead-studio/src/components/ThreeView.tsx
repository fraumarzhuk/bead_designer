import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Bead, Edge } from '../types';

interface Props {
  beads: Bead[];
  edges: Edge[];
  getPos: (id: number) => { x: number; y: number; z: number } | undefined;
  tickPhysics: () => void;
}

export const ThreeView: React.FC<Props> = ({ beads, edges, getPos, tickPhysics }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshMapRef = useRef<Map<number, THREE.Mesh>>(new Map());
  const lineSegsRef = useRef<THREE.LineSegments | null>(null);
  const animRef = useRef<number>();

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dLight.position.set(30, 40, 50);
    scene.add(dLight);
    const dLight2 = new THREE.DirectionalLight(0x88aaff, 0.25);
    dLight2.position.set(-30, -20, -40);
    scene.add(dLight2);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(40, 30, 40);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const rect = container.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // empty label toggle
    const empty = document.getElementById('empty-3d');
    if (empty) empty.style.display = beads.length ? 'none' : 'flex';

    // camera controls: drag to rotate, scroll to zoom
    let dragging = false,
      lastX = 0,
      lastY = 0;
    let camAngleX = 0.25,
      camAngleY = 0.7,
      camDist = 55;

    const updateCamera = () => {
      camera.position.x = camDist * Math.sin(camAngleY) * Math.cos(camAngleX);
      camera.position.y = camDist * Math.sin(camAngleX);
      camera.position.z = camDist * Math.cos(camAngleY) * Math.cos(camAngleX);
      camera.lookAt(0, 0, 0);
    };

    const onMouseDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onMouseUp = () => { dragging = false; };
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX,
        dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      camAngleY -= dx * 0.006;
      camAngleX = Math.max(-1.4, Math.min(1.4, camAngleX + dy * 0.006));
      updateCamera();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camDist = Math.max(8, Math.min(220, camDist * (1 + e.deltaY * 0.001)));
      updateCamera();
    };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // build initial meshes
    buildMeshes(beads, edges, scene);

    // start animation loop
    const animate = () => {
      tickPhysics();
      syncMeshes(beads, edges, getPos);
      updateCamera();
      renderer.render(scene, camera);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    // resize observer
    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('wheel', onWheel);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      renderer.dispose();
    };
  }, []);

  // update meshes when beads/edges change
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    // clear old meshes
    for (const mesh of meshMapRef.current.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    meshMapRef.current.clear();
    if (lineSegsRef.current) {
      scene.remove(lineSegsRef.current);
      lineSegsRef.current.geometry.dispose();
      lineSegsRef.current.material.dispose();
      lineSegsRef.current = null;
    }
    buildMeshes(beads, edges, scene);
    const empty = document.getElementById('empty-3d');
    if (empty) empty.style.display = beads.length ? 'none' : 'flex';
  }, [beads, edges]);

  const buildMeshes = (beads: Bead[], edges: Edge[], scene: THREE.Scene) => {
    for (const bead of beads) {
      const geo = new THREE.SphereGeometry(bead.size / 2, 14, 14);
      const mat = new THREE.MeshPhysicalMaterial({
        color: bead.color,
        roughness: 0.25,
        metalness: 0.05,
        transparent: true,
        opacity: 0.94,
        clearcoat: 0.4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.beadId = bead.id;
      scene.add(mesh);
      meshMapRef.current.set(bead.id, mesh);
    }
    // edges as line segments
    if (edges.length > 0) {
      const positions = new Float32Array(edges.length * 6);
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.35 });
      const segs = new THREE.LineSegments(geom, mat);
      scene.add(segs);
      lineSegsRef.current = segs;
    }
  };

  const syncMeshes = (beads: Bead[], edges: Edge[], getPos: (id: number) => { x: number; y: number; z: number } | undefined) => {
    for (const bead of beads) {
      const mesh = meshMapRef.current.get(bead.id);
      const pos = getPos(bead.id);
      if (mesh && pos) mesh.position.set(pos.x, pos.y, pos.z);
    }
    const segs = lineSegsRef.current;
    if (segs) {
      const arr = segs.geometry.attributes.position.array as Float32Array;
      let idx = 0;
      for (const e of edges) {
        const pa = getPos(e.a);
        const pb = getPos(e.b);
        if (pa && pb) {
          arr[idx++] = pa.x;
          arr[idx++] = pa.y;
          arr[idx++] = pa.z;
          arr[idx++] = pb.x;
          arr[idx++] = pb.y;
          arr[idx++] = pb.z;
        }
      }
      segs.geometry.attributes.position.needsUpdate = true;
    }
  };

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};