import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Plus, Trash2, ChevronUp, ChevronDown, RotateCcw, Circle } from 'lucide-react';

const PALETTE = ['#c8524a', '#3f7cac', '#e0a458', '#5a8f5c', '#8e5aa8', '#d4874f', '#4a9ba8', '#b85c8a'];

let idCounter = 100;
const nextId = () => idCounter++;

const DEFAULT_ROWS = [
	{ id: nextId(), count: 5, color: PALETTE[0] },
	{ id: nextId(), count: 4, color: PALETTE[1] },
	{ id: nextId(), count: 4, color: PALETTE[1] },
	{ id: nextId(), count: 4, color: PALETTE[2] },
	{ id: nextId(), count: 4, color: PALETTE[2] },
];

export default function BeadPatternDesigner() {
	const [rows, setRows] = useState(DEFAULT_ROWS);
	const [beadRadius, setBeadRadius] = useState(0.45);
	const [rowHeight, setRowHeight] = useState(1.5);

	const mountRef = useRef(null);
	const threeRef = useRef({});
	const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

	// ---------- Row editing ----------
	const addRow = () => {
		setRows(r => {
			const prevColor = r.length ? r[r.length - 1].color : PALETTE[0];
			const colorIdx = (PALETTE.indexOf(prevColor) + 1 + PALETTE.length) % PALETTE.length;
			const prevCount = r.length ? r[r.length - 1].count : 4;
			return [...r, { id: nextId(), count: prevCount, color: PALETTE[colorIdx] }];
		});
	};

	const removeRow = (id) => setRows(r => r.filter(row => row.id !== id));

	const updateRow = (id, patch) =>
		setRows(r => r.map(row => (row.id === id ? { ...row, ...patch } : row)));

	const moveRow = (id, dir) => {
		setRows(r => {
			const idx = r.findIndex(row => row.id === id);
			const newIdx = idx + dir;
			if (newIdx < 0 || newIdx >= r.length) return r;
			const copy = [...r];
			[copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
			return copy;
		});
	};

	const totalBeads = rows.reduce((sum, row) => sum + row.count, 0);

	// ---------- Three.js init (once) ----------
	useEffect(() => {
		const mount = mountRef.current;
		const width = mount.clientWidth;
		const height = mount.clientHeight;

		const scene = new THREE.Scene();

		const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
		camera.position.set(0, 0, 14);

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		mount.appendChild(renderer.domElement);

		const ambient = new THREE.AmbientLight(0xffffff, 0.55);
		scene.add(ambient);
		const key = new THREE.DirectionalLight(0xffffff, 0.9);
		key.position.set(5, 8, 10);
		scene.add(key);
		const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
		fill.position.set(-6, -3, -8);
		scene.add(fill);

		const beadGroup = new THREE.Group();
		scene.add(beadGroup);

		threeRef.current = { scene, camera, renderer, beadGroup, zoom: 14, rotX: -0.3, rotY: 0.5 };
		beadGroup.rotation.x = -0.3;
		beadGroup.rotation.y = 0.5;

		let frameId;
		const animate = () => {
			frameId = requestAnimationFrame(animate);
			renderer.render(scene, camera);
		};
		animate();

		const ro = new ResizeObserver(() => {
			const w = mount.clientWidth;
			const h = mount.clientHeight;
			if (w === 0 || h === 0) return;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		});
		ro.observe(mount);

		// ---- pointer controls (drag = rotate, wheel = zoom) ----
		const onPointerDown = (e) => {
			dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
		};
		const onPointerMove = (e) => {
			if (!dragRef.current.dragging) return;
			const dx = e.clientX - dragRef.current.lastX;
			const dy = e.clientY - dragRef.current.lastY;
			dragRef.current.lastX = e.clientX;
			dragRef.current.lastY = e.clientY;
			const t = threeRef.current;
			t.rotY += dx * 0.008;
			t.rotX = Math.max(-1.4, Math.min(1.4, t.rotX + dy * 0.008));
			beadGroup.rotation.y = t.rotY;
			beadGroup.rotation.x = t.rotX;
		};
		const onPointerUp = () => { dragRef.current.dragging = false; };
		const onWheel = (e) => {
			e.preventDefault();
			const t = threeRef.current;
			t.zoom = Math.max(4, Math.min(40, t.zoom + e.deltaY * 0.02));
			camera.position.z = t.zoom;
		};

		const el = renderer.domElement;
		el.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		el.addEventListener('wheel', onWheel, { passive: false });

		return () => {
			cancelAnimationFrame(frameId);
			ro.disconnect();
			el.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			el.removeEventListener('wheel', onWheel);
			mount.removeChild(renderer.domElement);
			renderer.dispose();
		};
	}, []);

	const resetView = () => {
		const t = threeRef.current;
		if (!t.beadGroup) return;
		t.rotX = -0.3;
		t.rotY = 0.5;
		t.zoom = 14;
		t.beadGroup.rotation.x = t.rotX;
		t.beadGroup.rotation.y = t.rotY;
		t.camera.position.z = t.zoom;
	};

	// ---------- Rebuild beads/threads whenever pattern changes ----------
	useEffect(() => {
		const t = threeRef.current;
		if (!t.beadGroup) return;
		const group = t.beadGroup;

		// clear previous
		while (group.children.length) {
			const obj = group.children.pop();
			obj.geometry?.dispose();
			obj.material?.dispose();
		}

		if (rows.length === 0) return;

		const beadDiameter = beadRadius * 2;
		const totalHeight = (rows.length - 1) * rowHeight;

		// compute positions per row
		const rowPositions = rows.map((row, i) => {
			const n = Math.max(row.count, 2);
			const radius = Math.max((n * beadDiameter) / (2 * Math.PI), beadDiameter * 0.6);
			const y = i * rowHeight - totalHeight / 2;
			const angleOffset = (i % 2) * (Math.PI / n);
			const pts = [];
			for (let j = 0; j < n; j++) {
				const angle = (j / n) * Math.PI * 2 + angleOffset;
				pts.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
			}
			return { pts, angles: Array.from({ length: n }, (_, j) => (j / n) * Math.PI * 2 + angleOffset), color: row.color };
		});

		const beadGeo = new THREE.SphereGeometry(beadRadius, 20, 16);
		const threadMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, metalness: 0.1 });

		// beads
		rowPositions.forEach(({ pts, color }) => {
			const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.15 });
			pts.forEach(p => {
				const mesh = new THREE.Mesh(beadGeo, mat);
				mesh.position.copy(p);
				group.add(mesh);
			});
		});

		const threadRadius = beadRadius * 0.12;
		const makeThread = (p1, p2) => {
			const dir = new THREE.Vector3().subVectors(p2, p1);
			const len = dir.length();
			if (len < 1e-4) return;
			const geo = new THREE.CylinderGeometry(threadRadius, threadRadius, len, 6);
			const mesh = new THREE.Mesh(geo, threadMat);
			const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
			mesh.position.copy(mid);
			const up = new THREE.Vector3(0, 1, 0);
			const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
			mesh.quaternion.copy(quat);
			group.add(mesh);
		};

		// within-row ring threads
		rowPositions.forEach(({ pts }) => {
			for (let j = 0; j < pts.length; j++) {
				makeThread(pts[j], pts[(j + 1) % pts.length]);
			}
		});

		// between-row threads: connect each bead to its 2 nearest angular neighbors in next row
		for (let i = 0; i < rowPositions.length - 1; i++) {
			const a = rowPositions[i];
			const b = rowPositions[i + 1];
			const seen = new Set();
			const angDist = (x, y) => {
				let d = Math.abs(x - y) % (Math.PI * 2);
				return d > Math.PI ? Math.PI * 2 - d : d;
			};
			a.angles.forEach((angA, ai) => {
				const dists = b.angles.map((angB, bi) => ({ bi, d: angDist(angA, angB) }));
				dists.sort((x, y) => x.d - y.d);
				dists.slice(0, 2).forEach(({ bi }) => {
					const key = `${ai}-${bi}`;
					if (!seen.has(key)) {
						seen.add(key);
						makeThread(a.pts[ai], b.pts[bi]);
					}
				});
			});
		}
	}, [rows, beadRadius, rowHeight]);

	return (
		<div className="flex h-screen w-full bg-[#1b1d22] text-[#e8e6e1] font-sans overflow-hidden">
			{/* LEFT: Pattern editor */}
			<div className="w-[360px] flex-shrink-0 flex flex-col border-r border-[#33363d] bg-[#202226]">
				<div className="px-5 pt-5 pb-4 border-b border-[#33363d]">
					<h1 className="text-lg font-semibold tracking-tight">Bead Pattern Designer</h1>
					<p className="text-xs text-[#8b8d94] mt-1">Tubular right-angle weave · row by row</p>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
					{rows.map((row, i) => (
						<div key={row.id} className="rounded-lg bg-[#2a2d33] border border-[#3a3d45] p-3 flex items-center gap-3">
							<div className="w-6 text-xs text-[#7c7f88] font-mono">{i + 1}</div>

							<label className="relative w-7 h-7 rounded-full overflow-hidden border border-[#4a4d55] flex-shrink-0 cursor-pointer">
								<input
									type="color"
									value={row.color}
									onChange={e => updateRow(row.id, { color: e.target.value })}
									className="absolute -top-1 -left-1 w-10 h-10 cursor-pointer"
								/>
							</label>

							<div className="flex items-center gap-1.5">
								<button
									onClick={() => updateRow(row.id, { count: Math.max(3, row.count - 1) })}
									className="w-6 h-6 rounded bg-[#33363d] hover:bg-[#3d4149] text-sm leading-none"
								>−</button>
								<input
									type="number"
									value={row.count}
									min={3}
									max={16}
									onChange={e => updateRow(row.id, { count: Math.max(3, Math.min(16, Number(e.target.value) || 3)) })}
									className="w-11 text-center bg-transparent text-sm outline-none"
								/>
								<button
									onClick={() => updateRow(row.id, { count: Math.min(16, row.count + 1) })}
									className="w-6 h-6 rounded bg-[#33363d] hover:bg-[#3d4149] text-sm leading-none"
								>+</button>
								<span className="text-[10px] text-[#7c7f88] ml-0.5">beads</span>
							</div>

							<div className="flex-1" />

							<button onClick={() => moveRow(row.id, -1)} disabled={i === 0}
								className="w-6 h-6 rounded hover:bg-[#33363d] disabled:opacity-25 flex items-center justify-center">
								<ChevronUp size={14} />
							</button>
							<button onClick={() => moveRow(row.id, 1)} disabled={i === rows.length - 1}
								className="w-6 h-6 rounded hover:bg-[#33363d] disabled:opacity-25 flex items-center justify-center">
								<ChevronDown size={14} />
							</button>
							<button onClick={() => removeRow(row.id)}
								className="w-6 h-6 rounded hover:bg-[#4a2c2c] text-[#c8524a] flex items-center justify-center">
								<Trash2 size={13} />
							</button>
						</div>
					))}

					<button
						onClick={addRow}
						className="w-full mt-2 py-2.5 rounded-lg border border-dashed border-[#4a4d55] text-sm text-[#a9abb2] hover:border-[#6a6d75] hover:text-[#e8e6e1] flex items-center justify-center gap-1.5 transition-colors"
					>
						<Plus size={15} /> Add row
					</button>
				</div>

				<div className="px-5 py-4 border-t border-[#33363d] space-y-4">
					<div>
						<div className="flex justify-between text-xs text-[#a9abb2] mb-1.5">
							<span>Bead size</span><span className="font-mono">{beadRadius.toFixed(2)}</span>
						</div>
						<input type="range" min={0.2} max={0.8} step={0.01} value={beadRadius}
							onChange={e => setBeadRadius(Number(e.target.value))} className="w-full accent-[#c8524a]" />
					</div>
					<div>
						<div className="flex justify-between text-xs text-[#a9abb2] mb-1.5">
							<span>Row spacing</span><span className="font-mono">{rowHeight.toFixed(2)}</span>
						</div>
						<input type="range" min={0.6} max={3} step={0.05} value={rowHeight}
							onChange={e => setRowHeight(Number(e.target.value))} className="w-full accent-[#c8524a]" />
					</div>
					<div className="flex items-center gap-1.5 text-xs text-[#7c7f88] pt-1">
						<Circle size={10} /> {rows.length} rows · {totalBeads} beads total
					</div>
				</div>
			</div>

			{/* RIGHT: 3D preview */}
			<div className="flex-1 relative">
				<div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing"
					style={{ background: 'radial-gradient(circle at 50% 40%, #2b2e35 0%, #17181c 100%)' }} />
				<div className="absolute top-4 left-4 text-xs text-[#8b8d94] bg-[#1b1d22]/70 backdrop-blur px-3 py-1.5 rounded-full border border-[#33363d]">
					drag to rotate · scroll to zoom
				</div>
				<button
					onClick={resetView}
					className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#1b1d22]/70 backdrop-blur border border-[#33363d] flex items-center justify-center text-[#a9abb2] hover:text-white hover:border-[#5a5d65] transition-colors"
					title="Reset view"
				>
					<RotateCcw size={14} />
				</button>
			</div>
		</div>
	);
}
