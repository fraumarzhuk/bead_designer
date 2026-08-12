
(function(){

/* ---------------- data model ----------------
   beads: { id, color, size(mm), x, y }   x/y = position in the 2D schema editor
   edges: { a, b, type }                  type: 'chain' (added together) or 'reuse' (linked after the fact)
   selected: Set<id>
------------------------------------------------ */

let nextId = 1;
const state = { beads: [], edges: [], selected: new Set() };

function findBead(id){ return state.beads.find(b=>b.id===id); }
function beadNumber(id){ return state.beads.findIndex(b=>b.id===id)+1; }
function hasEdge(a,b){ return state.edges.some(e=> (e.a===a&&e.b===b)||(e.a===b&&e.b===a)); }
function addEdgeIfMissing(a,b,type){
  if(a===b || hasEdge(a,b)) return false;
  state.edges.push({a,b,type});
  return true;
}

/* ---------------- physics (Position Based Dynamics) ---------------- */

let posMap = new Map(), prevPosMap = new Map();
let edgesResolved = [];
let edgeKeySet = new Set();
let sizeMap = new Map();

function rebuildPhysicsAux(){
  sizeMap = new Map(state.beads.map(b=>[b.id,b.size]));
  edgesResolved = state.edges.map(e=>({
    a:e.a, b:e.b, rest:(sizeMap.get(e.a)+sizeMap.get(e.b))/2*0.92
  }));
  edgeKeySet = new Set(state.edges.map(e=> e.a<e.b ? e.a+','+e.b : e.b+','+e.a));
}

function physicsAddBead(id, connectToIds){
  let seed;
  if(connectToIds.length){
    let ax=0,ay=0,az=0,c=0;
    connectToIds.forEach(cid=>{ const p=posMap.get(cid); if(p){ ax+=p.x; ay+=p.y; az+=p.z; c++; } });
    if(c>0){ ax/=c; ay/=c; az/=c; }
    seed = { x:ax+(Math.random()-0.5)*1.4, y:ay+(Math.random()-0.5)*1.4, z:az+(Math.random()-0.5)*1.4 };
  } else if(posMap.size>0){
    let ax=0,ay=0,az=0;
    posMap.forEach(p=>{ ax+=p.x; ay+=p.y; az+=p.z; });
    ax/=posMap.size; ay/=posMap.size; az/=posMap.size;
    seed = { x:ax+3+Math.random(), y:ay+Math.random(), z:az+Math.random() };
  } else {
    seed = { x:0, y:0, z:0 };
  }
  posMap.set(id, seed);
  prevPosMap.set(id, {...seed});
  rebuildPhysicsAux();
}

function physicsDeleteBeads(ids){
  ids.forEach(id=>{ posMap.delete(id); prevPosMap.delete(id); });
  rebuildPhysicsAux();
}

function physicsFullReset(){
  posMap.clear(); prevPosMap.clear();
  state.beads.forEach((b,i)=>{
    const angle = i*2.399963; // golden angle -> decent spread for the solver to untangle
    const r = Math.sqrt(i+1)*2.2;
    const seed = { x:r*Math.cos(angle), y:r*Math.sin(angle), z:(Math.random()-0.5)*2 };
    posMap.set(b.id, seed);
    prevPosMap.set(b.id, {...seed});
  });
  rebuildPhysicsAux();
}

function physicsStep(iterations){
  const ids = state.beads.map(b=>b.id);
  const n = ids.length;
  if(n===0) return;
  const damping = 0.96;

  for(let i=0;i<n;i++){
    const id=ids[i];
    const p=posMap.get(id), pp=prevPosMap.get(id);
    const vx=(p.x-pp.x)*damping, vy=(p.y-pp.y)*damping, vz=(p.z-pp.z)*damping;
    prevPosMap.set(id, {x:p.x,y:p.y,z:p.z});
    posMap.set(id, {x:p.x+vx,y:p.y+vy,z:p.z+vz});
  }

  /* long-range repulsion between every pair — keeps rings open and makes
     the whole net balloon into a convex shape instead of folding up */
  let avgSize=0;
  for(let i=0;i<n;i++) avgSize += sizeMap.get(ids[i]) ?? 3;
  avgSize = (avgSize/n) || 3;
  const repelStrength = avgSize*avgSize*0.9;
  const maxPush = avgSize*0.06;
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const pa=posMap.get(ids[i]), pb=posMap.get(ids[j]);
      const dx=pb.x-pa.x, dy=pb.y-pa.y, dz=pb.z-pa.z;
      const distSq=dx*dx+dy*dy+dz*dz;
      const dist=Math.sqrt(distSq)||0.0001;
      let push=repelStrength/distSq;
      if(push>maxPush) push=maxPush;
      const ux=dx/dist, uy=dy/dist, uz=dz/dist;
      pa.x-=ux*push*0.5; pa.y-=uy*push*0.5; pa.z-=uz*push*0.5;
      pb.x+=ux*push*0.5; pb.y+=uy*push*0.5; pb.z+=uz*push*0.5;
    }
  }

  for(let it=0; it<iterations; it++){
    edgesResolved.forEach(({a,b,rest})=>{
      const pa=posMap.get(a), pb=posMap.get(b);
      if(!pa||!pb) return;
      const dx=pb.x-pa.x, dy=pb.y-pa.y, dz=pb.z-pa.z;
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)||0.0001;
      const diff=(dist-rest)/dist*0.5;
      pa.x+=dx*diff; pa.y+=dy*diff; pa.z+=dz*diff;
      pb.x-=dx*diff; pb.y-=dy*diff; pb.z-=dz*diff;
    });
    for(let i=0;i<n;i++){
      for(let j=i+1;j<n;j++){
        const idA=ids[i], idB=ids[j];
        const key = idA<idB ? idA+','+idB : idB+','+idA;
        if(edgeKeySet.has(key)) continue;
        const pa=posMap.get(idA), pb=posMap.get(idB);
        const dx=pb.x-pa.x, dy=pb.y-pa.y, dz=pb.z-pa.z;
        const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)||0.0001;
        const sa=sizeMap.get(idA)??3, sb=sizeMap.get(idB)??3;
        const minDist=(sa+sb)/2*0.95;
        if(dist<minDist){
          const diff=(dist-minDist)/dist*0.5;
          pa.x+=dx*diff; pa.y+=dy*diff; pa.z+=dz*diff;
          pb.x-=dx*diff; pb.y-=dy*diff; pb.z-=dz*diff;
        }
      }
    }
  }

  let cx=0,cy=0,cz=0;
  for(let i=0;i<n;i++){ const p=posMap.get(ids[i]); cx+=p.x; cy+=p.y; cz+=p.z; }
  cx/=n; cy/=n; cz/=n;
  for(let i=0;i<n;i++){
    const p=posMap.get(ids[i]), pp=prevPosMap.get(ids[i]);
    p.x-=cx; p.y-=cy; p.z-=cz;
    pp.x-=cx; pp.y-=cy; pp.z-=cz;
  }

  /* remove net rigid-body rotation each frame, same reasoning as translation
     above — otherwise the whole structure can spin forever */
  let Lx=0,Ly=0,Lz=0, Iscalar=0;
  for(let i=0;i<n;i++){
    const p=posMap.get(ids[i]), pp=prevPosMap.get(ids[i]);
    const rx=p.x, ry=p.y, rz=p.z;
    const vx=p.x-pp.x, vy=p.y-pp.y, vz=p.z-pp.z;
    Lx += ry*vz - rz*vy;
    Ly += rz*vx - rx*vz;
    Lz += rx*vy - ry*vx;
    Iscalar += rx*rx+ry*ry+rz*rz;
  }
  if(Iscalar > 1e-6){
    const wx=Lx/Iscalar, wy=Ly/Iscalar, wz=Lz/Iscalar;
    for(let i=0;i<n;i++){
      const p=posMap.get(ids[i]), pp=prevPosMap.get(ids[i]);
      const rx=p.x, ry=p.y, rz=p.z;
      const cvx = wy*rz - wz*ry;
      const cvy = wz*rx - wx*rz;
      const cvz = wx*ry - wy*rx;
      pp.x += cvx; pp.y += cvy; pp.z += cvz;
    }
  }
}

/* ---------------- 2D schema canvas ---------------- */

const schemaCanvas = document.getElementById('schemaCanvas');
const sctx = schemaCanvas.getContext('2d');
let schemaBeadScreen = [];

function resizeCanvas(){
  const rect = schemaCanvas.getBoundingClientRect();
  schemaCanvas.width = rect.width * devicePixelRatio;
  schemaCanvas.height = rect.height * devicePixelRatio;
  sctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  drawSchema();
}

function isLight(hex){
  const c = hex.replace('#','');
  const r = parseInt(c.substr(0,2),16), g = parseInt(c.substr(2,2),16), b = parseInt(c.substr(4,2),16);
  return (0.299*r+0.587*g+0.114*b) > 165;
}

function drawSchema(){
  const w = schemaCanvas.clientWidth, h = schemaCanvas.clientHeight;
  sctx.clearRect(0,0,w,h);
  schemaBeadScreen = [];
  if(state.beads.length===0){
    sctx.fillStyle = '#5d6a61';
    sctx.font = '13px -apple-system, sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('Click "+ Add bead" to place your first bead', w/2, h/2);
    return;
  }

  state.edges.forEach(e=>{
    const ba = findBead(e.a), bb = findBead(e.b);
    if(!ba||!bb) return;
    sctx.strokeStyle = e.type==='reuse' ? 'rgba(179,70,60,0.65)' : 'rgba(63,107,138,0.55)';
    sctx.lineWidth = e.type==='reuse' ? 1.6 : 1.1;
    sctx.beginPath();
    sctx.moveTo(ba.x,ba.y); sctx.lineTo(bb.x,bb.y);
    sctx.stroke();
  });

  state.beads.forEach((bead,i)=>{
    const r = Math.max(7, Math.min(16, 4+bead.size*2));
    const isSel = state.selected.has(bead.id);
    sctx.beginPath();
    sctx.arc(bead.x,bead.y,r,0,Math.PI*2);
    sctx.fillStyle = bead.color;
    sctx.fill();
    sctx.lineWidth = isSel ? 2.5 : 1;
    sctx.strokeStyle = isSel ? '#b8863c' : 'rgba(28,35,33,0.35)';
    sctx.stroke();
    sctx.fillStyle = isLight(bead.color) ? '#1c2321' : '#f2ede2';
    sctx.font = `${Math.max(8,r*0.85)}px ui-monospace, monospace`;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillText(String(i+1), bead.x, bead.y+0.5);
    schemaBeadScreen.push({ id:bead.id, x:bead.x, y:bead.y, r });
  });
}

function canvasXY(e){
  const rect = schemaCanvas.getBoundingClientRect();
  return { x: e.clientX-rect.left, y: e.clientY-rect.top };
}
function hitTestBead(x,y){
  for(const b of schemaBeadScreen){
    const dx=x-b.x, dy=y-b.y;
    if(dx*dx+dy*dy <= (b.r+2)*(b.r+2)) return b;
  }
  return null;
}

let dragCandidate = null;

schemaCanvas.addEventListener('mousedown', e=>{
  const {x,y} = canvasXY(e);
  const hit = hitTestBead(x,y);
  if(hit){
    dragCandidate = { id:hit.id, startX:x, startY:y, moved:false };
  } else {
    dragCandidate = null;
    if(state.selected.size){
      state.selected.clear();
      renderInspector(); updateToolbarState(); drawSchema();
    }
  }
});
window.addEventListener('mousemove', e=>{
  if(!dragCandidate) return;
  const {x,y} = canvasXY(e);
  const dx=x-dragCandidate.startX, dy=y-dragCandidate.startY;
  if(dragCandidate.moved || Math.hypot(dx,dy)>4){
    dragCandidate.moved = true;
    const bead = findBead(dragCandidate.id);
    if(bead){ bead.x=x; bead.y=y; drawSchema(); }
  }
});
window.addEventListener('mouseup', ()=>{
  if(!dragCandidate) return;
  if(!dragCandidate.moved) toggleSelect(dragCandidate.id);
  dragCandidate = null;
});

function toggleSelect(id){
  if(state.selected.has(id)){
    state.selected.delete(id);
  } else {
    state.selected.add(id);
    const b = findBead(id);
    if(b){
      document.getElementById('defaultColor').value = b.color;
	  document.getElementById('bgColor').value = b.color;
      document.getElementById('defaultSize').value = b.size;
      document.getElementById('defaultSizeVal').textContent = b.size+' mm';
    }
  }
  renderInspector();
  updateToolbarState();
  drawSchema();
}

/* ---------------- inspector ---------------- */

const inspector = document.getElementById('inspector');

function renderInspector(){
  const ids = [...state.selected];
  if(ids.length===0){
    inspector.innerHTML = state.beads.length
      ? '<span class="empty">click beads to select them, then add / Connect / delete. click empty space to clear selection.</span>'
      : '<span class="empty">Click "+ add bead" to place your first bead.</span>';
    return;
  }
  const first = findBead(ids[0]);
  if(!first) return;
  const label = ids.length===1 ? `bead #${beadNumber(ids[0])}` : `${ids.length} beads selected`;
  inspector.innerHTML = `
    <span class="badge">${label}</span>
    <div class="field"><label>Color</label><input type="color" id="editColor" value="${first.color}"></div>
    <div class="field"><label>Size</label><input type="range" id="editSize" min="1" max="8" step="0.5" value="${first.size}"><span id="editSizeVal">${first.size} mm</span></div>
  `;
  document.getElementById('editColor').addEventListener('input', e=>{
    ids.forEach(id=>{ const b=findBead(id); if(b) b.color=e.target.value; });
    rebuildPhysicsAux(); refreshView();
  });
  document.getElementById('editSize').addEventListener('input', e=>{
    const v = parseFloat(e.target.value);
    document.getElementById('editSizeVal').textContent = v+' mm';
    ids.forEach(id=>{ const b=findBead(id); if(b) b.size=v; });
    rebuildPhysicsAux(); refreshView();
  });
}

function updateToolbarState(){
  document.getElementById('connectBtn').disabled = state.selected.size<2;
  document.getElementById('deleteBtn').disabled = state.selected.size<1;
}

/* ---------------- 3D view ---------------- */

const threeCanvas = document.getElementById('threeCanvas');
const emptyLabel = document.getElementById('empty-3d');
const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias:true, alpha:true });
const scene = new THREE.Scene();
const bgPicker = document.getElementById('bgColor');
scene.background = new THREE.Color(bgPicker.value);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dLight = new THREE.DirectionalLight(0xffffff, 0.9);
dLight.position.set(30,40,50);
scene.add(dLight);
const dLight2 = new THREE.DirectionalLight(0x88aaff, 0.25);
dLight2.position.set(-30,-20,-40);
scene.add(dLight2);

let beadMeshes = [];
let lineSegs = null;

function rebuildThree(){
  beadMeshes.forEach(m=>{ scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
  beadMeshes = [];
  if(lineSegs){ scene.remove(lineSegs); lineSegs.geometry.dispose(); lineSegs.material.dispose(); lineSegs=null; }

  state.beads.forEach(bead=>{
    const geo = new THREE.SphereGeometry(bead.size/2, 14, 14);
    const mat = new THREE.MeshPhysicalMaterial({
      color: bead.color, roughness:0.25, metalness:0.05,
      transparent:true, opacity:0.94, clearcoat:0.4
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.beadId = bead.id;
    scene.add(mesh);
    beadMeshes.push(mesh);
  });

  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({ color:0x999999, transparent:true, opacity:0.35 });
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(state.edges.length*6), 3));
  lineSegs = new THREE.LineSegments(lineGeo, lineMat);
  scene.add(lineSegs);

  emptyLabel.style.display = state.beads.length ? 'none' : 'flex';
}

function syncThree(){
  beadMeshes.forEach(mesh=>{
    const p = posMap.get(mesh.userData.beadId);
    if(p) mesh.position.set(p.x,p.y,p.z);
  });
  if(lineSegs){
    const arr = lineSegs.geometry.attributes.position.array;
    state.edges.forEach((e,k)=>{
      const pa = posMap.get(e.a), pb = posMap.get(e.b);
      if(pa && pb){
        arr[k*6+0]=pa.x; arr[k*6+1]=pa.y; arr[k*6+2]=pa.z;
        arr[k*6+3]=pb.x; arr[k*6+4]=pb.y; arr[k*6+5]=pb.z;
      }
    });
    lineSegs.geometry.attributes.position.needsUpdate = true;
  }
}

let camAngleX = 0.25, camAngleY = 0.7, camDist = 55, dragging=false, lastX=0, lastY=0;

function updateCamera(){
  camera.position.x = camDist*Math.sin(camAngleY)*Math.cos(camAngleX);
  camera.position.y = camDist*Math.sin(camAngleX);
  camera.position.z = camDist*Math.cos(camAngleY)*Math.cos(camAngleX);
  camera.lookAt(0,0,0);
}

bgPicker.addEventListener('input', (e) => {
    scene.background = new THREE.Color(e.target.value);
});

threeCanvas.addEventListener('mousedown', e=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; });
window.addEventListener('mouseup', ()=> dragging=false);
window.addEventListener('mousemove', e=>{
  if(!dragging) return;
  const dx = e.clientX-lastX, dy = e.clientY-lastY;
  lastX=e.clientX; lastY=e.clientY;
  camAngleY -= dx*0.006;
  camAngleX = Math.max(-1.4, Math.min(1.4, camAngleX + dy*0.006));
});
threeCanvas.addEventListener('wheel', e=>{
  e.preventDefault();
  camDist = Math.max(8, Math.min(220, camDist * (1 + e.deltaY*0.001)));
}, { passive:false });

function resizeThree(){
  const rect = threeCanvas.getBoundingClientRect();
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width/Math.max(1,rect.height);
  camera.updateProjectionMatrix();
}

function animate(){
  requestAnimationFrame(animate);
  if(state.beads.length){
    physicsStep(3);
    syncThree();
  }
  updateCamera();
  renderer.render(scene, camera);
}

/* ---------------- top-level actions ---------------- */

function refreshView(){
  rebuildThree();
  drawSchema();
  updateToolbarState();
}

function addBead(connectToIds){
  const id = nextId++;
  const color = document.getElementById('defaultColor').value;
  const size = parseFloat(document.getElementById('defaultSize').value)||3;
  const w = schemaCanvas.clientWidth, h = schemaCanvas.clientHeight;
  let x,y;
  if(connectToIds.length){
    let ax=0,ay=0;
    connectToIds.forEach(cid=>{ const b=findBead(cid); if(b){ ax+=b.x; ay+=b.y; } });
    ax/=connectToIds.length; ay/=connectToIds.length;
    const cx=w/2, cy=h/2;
    const dx=ax-cx, dy=ay-cy, dist=Math.hypot(dx,dy)||1;
    x = ax + dx/dist*24 + (Math.random()-0.5)*6;
    y = ay + dy/dist*24 + (Math.random()-0.5)*6;
  } else if(state.beads.length){
    const last = state.beads[state.beads.length-1];
    x = last.x + 26; y = last.y + (Math.random()-0.5)*10;
  } else {
    x = w/2; y = h/2;
  }
  state.beads.push({ id, color, size, x, y });
  connectToIds.forEach(cid=> state.edges.push({ a:cid, b:id, type:'chain' }));
  physicsAddBead(id, connectToIds);
  state.selected = new Set([id]);
  refreshView();
  renderInspector();
}

function connectSelected(){
  const ids = [...state.selected];
  if(ids.length<2) return;
  let added=false;
  for(let i=0;i<ids.length;i++){
    for(let j=i+1;j<ids.length;j++){
      if(addEdgeIfMissing(ids[i], ids[j], 'reuse')) added=true;
    }
  }
  if(added){ rebuildPhysicsAux(); refreshView(); }
}

function deleteSelected(){
  const ids = state.selected;
  if(ids.size===0) return;
  state.beads = state.beads.filter(b=>!ids.has(b.id));
  state.edges = state.edges.filter(e=>!ids.has(e.a) && !ids.has(e.b));
  physicsDeleteBeads([...ids]);
  state.selected = new Set();
  refreshView();
  renderInspector();
}

document.getElementById('addBeadBtn').addEventListener('click', ()=> addBead([...state.selected]));
document.getElementById('connectBtn').addEventListener('click', connectSelected);
document.getElementById('deleteBtn').addEventListener('click', deleteSelected);
document.getElementById('resetPhysicsBtn').addEventListener('click', physicsFullReset);
document.getElementById('defaultSize').addEventListener('input', e=>{
  document.getElementById('defaultSizeVal').textContent = e.target.value+' mm';
});

window.addEventListener('resize', ()=>{ resizeCanvas(); resizeThree(); });

resizeCanvas();
resizeThree();
refreshView();
renderInspector();
updateToolbarState();
animate();

})();