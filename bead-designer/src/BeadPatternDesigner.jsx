import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Plus, Trash2, X, RotateCcw } from 'lucide-react';

const PALETTE = ['#c8524a', '#3f7cac', '#e0a458', '#5a8f5c', '#8e5aa8', '#d4874f', '#4a9ba8', '#b85c8a'];

let idCounter = 1;
const nextId = () => idCounter++;

function contrastText(hex) {
	if (!hex) return '#fff';
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	return lum > 0.6 ? '#1b1d22' : '#f5f4f1';
}

function BeadBadge({ id, color, selected, dim, onClick }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono border-2 flex-shrink-0 transition-transform ${selected ? 'border-[#e8b84a] scale-110' : 'border-black/25'} ${dim ? 'opacity-40' : ''} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
			style={{ background: color || '#888' }}
		>
			<span style={{ color: contrastText(color) }}>{id}</span>
		</button>
	);
}

// ---------- physics: seed positions from row/element rings, then relax by real bead touch-distance ----------
function seedPositions(rows, elements, beadRadius, layoutMode) {
	const pos = new Map();
	const rowH = beadRadius * 3.2;
	let cumRadius = 0;

	rows.forEach((row, rIdx) => {
		const m = row.elementIds.length || 1;
		const avgSize = row.elementIds.reduce((s, id) => s + elements[id].size, 0) / m || 4;
		const bandWidth = Math.max((m * avgSize * beadRadius * 2) / (2 * Math.PI), beadRadius * 2);

		let y, ringRadiusBase;
		if (layoutMode === 'flat') {
			y = 0;
			ringRadiusBase = rIdx === 0 && m === 1 ? 0 : cumRadius + bandWidth * 0.5;
			cumRadius += bandWidth + beadRadius * 1.2;
		} else {
			y = rIdx * rowH;
			ringRadiusBase = null; // computed per-element below (tube mode)
		}

		row.elementIds.forEach((elId, eIdx) => {
			const el = elements[elId];
			const elemAngle = (eIdx / m) * Math.PI * 2;
			const ringRadius = layoutMode === 'flat'
				? ringRadiusBase
				: Math.max((m * el.size * beadRadius * 2) / (2 * Math.PI), beadRadius * 3);
			const cx = Math.cos(elemAngle) * ringRadius;
			const cz = Math.sin(elemAngle) * ringRadius;
			const localR = beadRadius * 1.4;
			el.beadIds.forEach((bid, bIdx) => {
				if (pos.has(bid)) return;
				const a = (bIdx / el.size) * Math.PI * 2;
				pos.set(bid, new THREE.Vector3(
					cx + Math.cos(a) * localR + (Math.random() - 0.5) * 0.05,
					y + (Math.random() - 0.5) * 0.05,
					cz + Math.sin(a) * localR + (Math.random() - 0.5) * 0.05
				));
			});
		});
	});
	return pos;
}

function relax(beadList, connections, seed, iterations, flatten) {
	const n = beadList.length;
	const idx = new Map(beadList.map((b, i) => [b.id, i]));
	const pos = beadList.map(b => (seed.get(b.id) || new THREE.Vector3()).clone());
	const conn = connections.map(([a, b]) => [idx.get(a), idx.get(b)]);

	for (let iter = 0; iter < iterations; iter++) {
		const force = beadList.map(() => new THREE.Vector3());

		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const d = pos[j].clone().sub(pos[i]);
				let dist = d.length();
				if (dist < 1e-5) { d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); dist = d.length() || 1e-4; }
				const minDist = (beadList[i].radius + beadList[j].radius) * 1.04;
				if (dist < minDist) {
					const push = (minDist - dist) * 0.5;
					const dir = d.clone().normalize();
					force[i].addScaledVector(dir, -push);
					force[j].addScaledVector(dir, push);
				}
			}
		}

		conn.forEach(([i, j]) => {
			const d = pos[j].clone().sub(pos[i]);
			const dist = d.length() || 1e-5;
			const target = beadList[i].radius + beadList[j].radius;
			const diff = (dist - target) * 0.5;
			const dir = d.clone().normalize();
			force[i].addScaledVector(dir, diff);
			force[j].addScaledVector(dir, -diff);
		});

		if (flatten) {
			for (let i = 0; i < n; i++) force[i].y -= pos[i].y * 0.05;
		}

		for (let i = 0; i < n; i++) {
			const f = force[i];
			const maxStep = beadList[i].radius * 0.3;
			if (f.length() > maxStep) f.setLength(maxStep);
			pos[i].add(f);
		}
	}

	const result = new Map();
	beadList.forEach((b, i) => result.set(b.id, pos[i]));
	return result;
}

export default function BeadPatternDesigner() {
	const [rows, setRows] = useState([]); // [{id, elementIds:[]}]
	const [elements, setElements] = useState({}); // id -> {rowId, size, beadIds:[], color}
	const [beads, setBeads] = useState({}); // id -> {color}
	const [beadRadius, setBeadRadius] = useState(0.45);
	const [layoutMode, setLayoutMode] = useState('tube'); // 'tube' | 'flat'

	const [addingToRow, setAddingToRow] = useState(null);
	const [formSize, setFormSize] = useState(4);
	const [formColor, setFormColor] = useState(PALETTE[0]);
	const [formReused, setFormReused] = useState([]);

	const mountRef = useRef(null);
	const threeRef = useRef({});
	const camDragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

	// ---------- row / element management ----------
	const addRow = () => setRows(prev => [...prev, { id: nextId(), elementIds: [] }]);

	const removeRow = (rowId) => {
		const row = rows.find(r => r.id === rowId);
		setElements(prev => {
			const cp = { ...prev };
			row.elementIds.forEach(id => delete cp[id]);
			return cp;
		});
		setRows(prev => prev.filter(r => r.id !== rowId));
		if (addingToRow === rowId) setAddingToRow(null);
	};

	const removeElement = (elId) => {
		const el = elements[elId];
		setElements(prev => { const cp = { ...prev }; delete cp[elId]; return cp; });
		setRows(prev => prev.map(r => r.id === el.rowId ? { ...r, elementIds: r.elementIds.filter(id => id !== elId) } : r));
	};

	const openAddForm = (rowId) => {
		const row = rows.find(r => r.id === rowId);
		const lastElId = row.elementIds[row.elementIds.length - 1];
		const lastEl = lastElId != null ? elements[lastElId] : null;
		const defaultReuse = lastEl ? [lastEl.beadIds[lastEl.beadIds.length - 1]] : [];
		const usedColors = Object.values(elements).map(e => e.color);
		const nextColor = PALETTE[usedColors.length % PALETTE.length];
		setAddingToRow(rowId);
		setFormSize(lastEl ? lastEl.size : 4);
		setFormColor(lastEl ? lastEl.color : nextColor);
		setFormReused(defaultReuse);
	};

	const toggleReuse = (beadId) => {
		setFormReused(prev => prev.includes(beadId) ? prev.filter(x => x !== beadId) : [...prev, beadId]);
	};

	const confirmAdd = () => {
		const newCount = formSize - formReused.length;
		if (newCount < 0) return;
		const newBeadIds = [];
		const beadUpdates = {};
		for (let i = 0; i < newCount; i++) {
			const id = nextId();
			beadUpdates[id] = { color: formColor };
			newBeadIds.push(id);
		}
		setBeads(prev => ({ ...prev, ...beadUpdates }));
		const beadIds = [...formReused, ...newBeadIds];
		const elId = nextId();
		setElements(prev => ({ ...prev, [elId]: { rowId: addingToRow, size: formSize, beadIds, color: formColor } }));
		setRows(prev => prev.map(r => r.id === addingToRow ? { ...r, elementIds: [...r.elementIds, elId] } : r));
		setAddingToRow(null);
	};

	const totalBeadIds = new Set(Object.values(elements).flatMap(e => e.beadIds));

	// ---------- three.js init (once) ----------
	useEffect(() => {
		const mount = mountRef.current;
		const width = mount.clientWidth, height = mount.clientHeight;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
		camera.position.set(0, 0, 12);

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		mount.appendChild(renderer.domElement);

		scene.add(new THREE.AmbientLight(0xffffff, 0.55));
		const key = new THREE.DirectionalLight(0xffffff, 0.9);
		key.position.set(5, 8, 10);
		scene.add(key);
		const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
		fill.position.set(-6, -3, -8);
		scene.add(fill);

		const beadGroup = new THREE.Group();
		scene.add(beadGroup);

		threeRef.current = { scene, camera, renderer, beadGroup, zoom: 12, rotX: -0.25, rotY: 0.5 };
		beadGroup.rotation.x = -0.25;
		beadGroup.rotation.y = 0.5;

		let frameId;
		const animate = () => { frameId = requestAnimationFrame(animate); renderer.render(scene, camera); };
		animate();

		const ro = new ResizeObserver(() => {
			const w = mount.clientWidth, h = mount.clientHeight;
			if (!w || !h) return;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		});
		ro.observe(mount);

		const onPointerDown = (e) => { camDragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY }; };
		const onPointerMove = (e) => {
			if (!camDragRef.current.dragging) return;
			const dx = e.clientX - camDragRef.current.lastX, dy = e.clientY - camDragRef.current.lastY;
			camDragRef.current.lastX = e.clientX; camDragRef.current.lastY = e.clientY;
			const t = threeRef.current;
			t.rotY += dx * 0.008;
			t.rotX = Math.max(-1.4, Math.min(1.4, t.rotX + dy * 0.008));
			beadGroup.rotation.y = t.rotY;
			beadGroup.rotation.x = t.rotX;
		};
		const onPointerUp = () => { camDragRef.current.dragging = false; };
		const onWheel = (e) => {
			e.preventDefault();
			const t = threeRef.current;
			t.zoom = Math.max(3, Math.min(40, t.zoom + e.deltaY * 0.02));
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
		t.rotX = -0.25; t.rotY = 0.5; t.zoom = 12;
		t.beadGroup.rotation.x = t.rotX;
		t.beadGroup.rotation.y = t.rotY;
		t.camera.position.z = t.zoom;
	};

	// ---------- rebuild 3D whenever pattern changes: seed + physics relax + render ----------
	useEffect(() => {
		const t = threeRef.current;
		if (!t.beadGroup) return;
		const group = t.beadGroup;
		while (group.children.length) {
			const obj = group.children.pop();
			obj.geometry?.dispose();
			obj.material?.dispose();
		}

		const beadIdSet = new Set(Object.values(elements).flatMap(e => e.beadIds));
		const beadListLocal = Array.from(beadIdSet).map(id => ({ id, radius: beadRadius }));
		if (beadListLocal.length === 0) return;

		const connSet = new Map();
		Object.values(elements).forEach(el => {
			const ids = el.beadIds;
			for (let i = 0; i < ids.length; i++) {
				const a = ids[i], b = ids[(i + 1) % ids.length];
				const key = a < b ? `${a}-${b}` : `${b}-${a}`;
				if (!connSet.has(key)) connSet.set(key, [a, b]);
			}
		});
		const connections = Array.from(connSet.values());

		const seed = seedPositions(rows, elements, beadRadius, layoutMode);
		const iterations = beadListLocal.length > 150 ? 160 : 320;
		const positions = relax(beadListLocal, connections, seed, iterations, layoutMode === 'flat');

		let cx = 0, cy = 0, cz = 0;
		positions.forEach(p => { cx += p.x; cy += p.y; cz += p.z; });
		const cnt = positions.size || 1;
		cx /= cnt; cy /= cnt; cz /= cnt;

		const threadMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, metalness: 0.1 });

		beadListLocal.forEach(b => {
			const p = positions.get(b.id);
			const geo = new THREE.SphereGeometry(beadRadius, 20, 16);
			const mat = new THREE.MeshStandardMaterial({ color: beads[b.id]?.color || '#999999', roughness: 0.25, metalness: 0.15 });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(p.x - cx, p.y - cy, p.z - cz);
			group.add(mesh);
		});

		connections.forEach(([a, b]) => {
			const p1 = positions.get(a), p2 = positions.get(b);
			if (!p1 || !p2) return;
			const v1 = new THREE.Vector3(p1.x - cx, p1.y - cy, p1.z - cz);
			const v2 = new THREE.Vector3(p2.x - cx, p2.y - cy, p2.z - cz);
			const dir = new THREE.Vector3().subVectors(v2, v1);
			const len = dir.length();
			if (len < 1e-4) return;
			const r = beadRadius * 0.12;
			const geo = new THREE.CylinderGeometry(r, r, len, 6);
			const mesh = new THREE.Mesh(geo, threadMat);
			mesh.position.copy(new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5));
			mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
			group.add(mesh);
		});
	}, [rows, elements, beadRadius, beads, layoutMode]);

	return (
		<div className="flex h-screen w-full bg-[#1b1d22] text-[#e8e6e1] font-sans overflow-hidden">
			{/* LEFT: row / element editor */}
			<div className="w-[430px] flex-shrink-0 flex flex-col border-r border-[#33363d] bg-[#202226]">
				<div className="px-5 pt-5 pb-3 border-b border-[#33363d]">
					<h1 className="text-lg font-semibold tracking-tight">Bead Pattern Designer</h1>
					<p className="text-xs text-[#8b8d94] mt-1">Rows of closed elements · right-angle weave</p>
				</div>

				<div className="px-5 py-3 border-b border-[#33363d] space-y-3">
					<div>
						<div className="flex justify-between text-xs text-[#a9abb2] mb-1.5">
							<span>Bead size</span><span className="font-mono">{beadRadius.toFixed(2)}</span>
						</div>
						<input type="range" min={0.2} max={0.8} step={0.01} value={beadRadius}
							onChange={e => setBeadRadius(Number(e.target.value))} className="w-full accent-[#c8524a]" />
					</div>
					<div>
						<div className="text-xs text-[#a9abb2] mb-1.5">Layout</div>
						<div className="flex gap-1.5">
							<button onClick={() => setLayoutMode('tube')}
								className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${layoutMode === 'tube' ? 'bg-[#c8524a] text-white' : 'bg-[#2a2d33] text-[#a9abb2] hover:bg-[#33363d]'}`}>
								Tube (rows stack up)
							</button>
							<button onClick={() => setLayoutMode('flat')}
								className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${layoutMode === 'flat' ? 'bg-[#c8524a] text-white' : 'bg-[#2a2d33] text-[#a9abb2] hover:bg-[#33363d]'}`}>
								Flat (rows ring outward)
							</button>
						</div>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
					{rows.map((row, rIdx) => (
						<div key={row.id} className="rounded-lg bg-[#26282e] border border-[#33363d] p-3">
							<div className="flex items-center justify-between mb-2">
								<span className="text-xs font-semibold text-[#c9cbd1]">Row {rIdx + 1}</span>
								<button onClick={() => removeRow(row.id)} className="text-[#7c7f88] hover:text-[#c8524a]">
									<Trash2 size={13} />
								</button>
							</div>

							<div className="flex flex-wrap gap-1.5 mb-2">
								{row.elementIds.map(elId => {
									const el = elements[elId];
									return (
										<div key={elId} className="flex items-center gap-1 border border-[#3a3d45] rounded-md pl-1.5 pr-1 py-1 bg-[#2a2d33]">
											<div className="flex -space-x-1.5">
												{el.beadIds.map(bid => <BeadBadge key={bid} id={bid} color={beads[bid]?.color} />)}
											</div>
											<button onClick={() => removeElement(elId)} className="text-[#7c7f88] hover:text-[#c8524a] ml-0.5">
												<X size={11} />
											</button>
										</div>
									);
								})}
							</div>

							{addingToRow === row.id ? (
								<div className="p-3 rounded-lg bg-[#1e2024] border border-[#3a3d45] space-y-3">
									<div className="flex items-center gap-2 flex-wrap">
										<label className="text-[11px] text-[#a9abb2]">Total beads</label>
										<input type="number" min={2} max={12} value={formSize}
											onChange={e => setFormSize(Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
											className="w-12 bg-[#1b1d22] rounded px-1.5 py-1 text-sm text-center border border-[#33363d]" />
										<label className="relative w-7 h-7 rounded-full overflow-hidden border border-[#4a4d55] cursor-pointer">
											<input type="color" value={formColor} onChange={e => setFormColor(e.target.value)}
												className="absolute -top-1 -left-1 w-10 h-10 cursor-pointer" />
										</label>
										<span className={`text-[11px] ml-auto font-mono ${formReused.length > formSize ? 'text-[#c8524a]' : 'text-[#7c7f88]'}`}>
											reuse {formReused.length} · new {Math.max(0, formSize - formReused.length)}
										</span>
									</div>

									{row.elementIds.length > 0 && (
										<div>
											<div className="text-[10px] uppercase tracking-wide text-[#7c7f88] mb-1">Reuse from this row</div>
											<div className="flex flex-wrap gap-1.5">
												{row.elementIds.flatMap(elId => elements[elId].beadIds).map(bid => (
													<BeadBadge key={bid} id={bid} color={beads[bid]?.color} selected={formReused.includes(bid)} onClick={() => toggleReuse(bid)} />
												))}
											</div>
										</div>
									)}

									{rIdx > 0 && (
										<div>
											<div className="text-[10px] uppercase tracking-wide text-[#7c7f88] mb-1">Reuse from row below</div>
											<div className="flex flex-wrap gap-1.5">
												{rows[rIdx - 1].elementIds.flatMap(elId => elements[elId].beadIds).map(bid => (
													<BeadBadge key={bid} id={bid} color={beads[bid]?.color} selected={formReused.includes(bid)} onClick={() => toggleReuse(bid)} />
												))}
											</div>
										</div>
									)}

									<div className="flex items-center gap-2 pt-1">
										<button onClick={confirmAdd} disabled={formReused.length > formSize}
											className="px-3 py-1.5 rounded-md bg-[#c8524a] text-white text-xs font-medium disabled:opacity-40">
											Add element
										</button>
										<button onClick={() => setAddingToRow(null)} className="px-3 py-1.5 rounded-md bg-[#33363d] text-xs text-[#a9abb2]">
											Cancel
										</button>
									</div>
								</div>
							) : (
								<button onClick={() => openAddForm(row.id)}
									className="px-2.5 py-1 rounded-md border border-dashed border-[#4a4d55] text-[11px] text-[#a9abb2] hover:border-[#6a6d75] hover:text-white flex items-center gap-1">
									<Plus size={12} /> Add element
								</button>
							)}
						</div>
					))}

					<button onClick={addRow}
						className="w-full py-2.5 rounded-lg border border-dashed border-[#4a4d55] text-sm text-[#a9abb2] hover:border-[#6a6d75] hover:text-[#e8e6e1] flex items-center justify-center gap-1.5">
						<Plus size={15} /> Add row
					</button>

					{rows.length === 0 && (
						<p className="text-xs text-[#5c5f68] leading-relaxed pt-2">
							Add a row, then add an element (a closed loop — e.g. 5 beads for your first circle).
							For the next element, tick the bead(s) you reuse from the previous element or the row below —
							the rest fill in as new beads.
						</p>
					)}
				</div>

				<div className="px-5 py-3 border-t border-[#33363d] text-xs text-[#7c7f88]">
					{rows.length} rows · {Object.keys(elements).length} elements · {totalBeadIds.size} beads
				</div>
			</div>

			{/* RIGHT: 3D preview */}
			<div className="flex-1 relative">
				<div ref={mountRef} className="absolute inset-0 cursor-grab active:cursor-grabbing"
					style={{ background: 'radial-gradient(circle at 50% 40%, #2b2e35 0%, #17181c 100%)' }} />
				<div className="absolute top-4 left-4 text-xs text-[#8b8d94] bg-[#1b1d22]/70 backdrop-blur px-3 py-1.5 rounded-full border border-[#33363d]">
					drag to rotate · scroll to zoom
				</div>
				<button onClick={resetView}
					className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#1b1d22]/70 backdrop-blur border border-[#33363d] flex items-center justify-center text-[#a9abb2] hover:text-white hover:border-[#5a5d65] transition-colors"
					title="Reset view">
					<RotateCcw size={14} />
				</button>
			</div>
		</div>
	);
}