// Actual photograph colours, with a single inexpensive mobile render pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Photograph-measured wall illumination; two tiny lookup textures, no light/render passes.
function profileTexture(profile) {
  const size=128,data=new Uint8Array(size*4),stops=profile.samples;
  for(let i=0;i<size;i++){
    const t=i/(size-1);let hi=stops.findIndex(s=>s.at>=t);if(hi<0)hi=stops.length-1;
    const b=stops[hi],a=stops[Math.max(0,hi-1)],f=b.at===a.at?0:(t-a.at)/(b.at-a.at);
    for(let c=0;c<3;c++)data[i*4+c]=Math.round(THREE.MathUtils.lerp(a.srgb[c],b.srgb[c],f));
    data[i*4+3]=Math.round(255*THREE.MathUtils.lerp(a.strength,b.strength,f));
  }
  const texture=new THREE.DataTexture(data,size,1,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=texture.magFilter=THREE.LinearFilter;
  texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.generateMipmaps=false;texture.needsUpdate=true;
  return texture;
}

export function createPhotoLedSpill(config) {
  const reference=config.reference_appearance.led_spill;
  const top=(config.shower_side_niche_bottom_cm+config.shower_side_niche_cm[1])/100;
  return {
    ceiling:profileTexture(reference.ceiling),niche:profileTexture(reference.niche),source:reference.source,
    room:new THREE.Vector3(config.room_width_cm/100,2.31,2.75),
    nicheBounds:new THREE.Vector4(config.shower_side_niche_center_cm/100,config.shower_side_niche_cm[0]/200,config.shower_side_niche_bottom_cm/100,top),
    ranges:new THREE.Vector3(reference.ceiling.offset_below_room_top_cm/100,reference.ceiling.length_cm/100,reference.niche.length_cm/100)
  };
}

export function applyPhotoLedSpill(material,spill,ceiling=false) {
  // Store textures directly on the material so the existing model disposer frees them.
  material.photoCeilingProfile=spill.ceiling;material.photoNicheProfile=spill.niche;
  material.userData.ledSpill={source:spill.source,ceiling:!ceiling,niche:!ceiling,ceilingSurface:ceiling};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{
      photoCeilingProfile:{value:spill.ceiling},photoNicheProfile:{value:spill.niche},
      photoRoom:{value:spill.room},photoNicheBounds:{value:spill.nicheBounds},photoRanges:{value:spill.ranges},photoSurfaceKind:{value:ceiling?1:0}
    });
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec3 vPhotoPosition;
      varying vec3 vPhotoNormal;
    `).replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
      vPhotoPosition=(modelMatrix*vec4(transformed,1.0)).xyz;
      vPhotoNormal=normalize(mat3(modelMatrix)*normal);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vPhotoPosition;
      varying vec3 vPhotoNormal;
      uniform sampler2D photoCeilingProfile;
      uniform sampler2D photoNicheProfile;
      uniform vec3 photoRoom;
      uniform vec4 photoNicheBounds;
      uniform vec3 photoRanges;
      uniform float photoSurfaceKind;
      vec4 coveSample(float t){return texture2D(photoCeilingProfile,vec2(clamp(t,0.0,1.0),0.5));}
      vec4 nicheSample(float t){return texture2D(photoNicheProfile,vec2(clamp(t,0.0,1.0),0.5));}
    `).replace('#include <opaque_fragment>',`
      vec3 p=vPhotoPosition,n=normalize(vPhotoNormal);
      if(photoSurfaceKind<0.5){
        float vertical=1.0-smoothstep(0.1,0.6,abs(n.y));
        float down=(photoRoom.y-photoRanges.x)-p.y;
        float coveWindow=smoothstep(-0.055,-0.005,down);
        vec4 cove=coveSample(down/photoRanges.y);
        outgoingLight=mix(outgoingLight,cove.rgb,cove.a*vertical*coveWindow);
        float widthWindow=1.0-smoothstep(photoNicheBounds.y-0.012,photoNicheBounds.y+0.005,abs(p.z+photoNicheBounds.x));
        float depthWindow=smoothstep(photoRoom.x-0.006,photoRoom.x+0.014,p.x);
        float heightWindow=smoothstep(photoNicheBounds.z-0.01,photoNicheBounds.z+0.004,p.y)*(1.0-smoothstep(photoNicheBounds.w,photoNicheBounds.w+0.008,p.y));
        float nicheWindow=widthWindow*depthWindow*heightWindow;
        vec4 niche=nicheSample((photoNicheBounds.w-p.y)/photoRanges.z);
        outgoingLight=mix(outgoingLight,niche.rgb,niche.a*nicheWindow);
        // Soft reflection on the horizontal stone ledge at the bottom of the recess.
        float shelfReflection=exp(-abs(p.y-photoNicheBounds.z)/0.025)*smoothstep(0.7,0.98,n.y)*widthWindow*depthWindow*0.45;
        outgoingLight=mix(outgoingLight,nicheSample(0.20).rgb,shelfReflection);
      }else{
        float edge=max(0.0,min(min(p.x,photoRoom.x-p.x),min(-p.z,photoRoom.z+p.z)));
        float reveal=(1.0-smoothstep(0.055,0.075,edge))*smoothstep(photoRoom.y-0.015,photoRoom.y,p.y);
        float panelEdge=(1.0-smoothstep(0.05,0.20,edge))*0.12;
        outgoingLight=mix(outgoingLight,coveSample(0.11).rgb,max(reveal,panelEdge));
      }
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=>`photo-led-spill-1:${ceiling?1:0}`;
  material.needsUpdate=true;
}

function batchStaticMeshes(model) {
  model.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(model.matrixWorld).invert();
  const groups=new Map();
  model.traverse(o=>{
    if(!o.isMesh || !o.visible || Array.isArray(o.material) || o.material.transparent || o.userData.service_layer)return;
    const geometry=o.geometry;
    const attributes=Object.keys(geometry.attributes).sort().map(k=>`${k}:${geometry.attributes[k].itemSize}:${geometry.attributes[k].normalized}`).join(',');
    const flags={roof:!!o.userData.roof,front:!!o.userData.front,wood_selectable:!!o.userData.wood_selectable,reference_surface:o.userData.reference_surface||''};
    const key=`${o.material.uuid}|${JSON.stringify(flags)}|${!!geometry.index}|${attributes}`;
    if(!groups.has(key))groups.set(key,{flags,meshes:[]});
    groups.get(key).meshes.push(o);
  });
  let before=0,after=0;
  for(const {flags,meshes} of groups.values()) {
    before+=meshes.length;
    if(meshes.length<2){after++;continue;}
    const parts=meshes.map(o=>o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));
    const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());
    if(!geometry){after+=meshes.length;continue;}
    const mesh=new THREE.Mesh(geometry,meshes[0].material);mesh.name=meshes[0].name+' | birleşik';mesh.userData={...flags};
    model.add(mesh);
    const previous=new Set();meshes.forEach(o=>{o.removeFromParent();previous.add(o.geometry);});previous.forEach(g=>g.dispose());after++;
  }
  return {before,after};
}

export function prepareMaterials(model, renderer, config) {
  const replacements=new Map(),oldMaterials=new Set(),oldTextures=new Set(),retainedTextures=new Set();
  const anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const palette=config.reference_appearance;
  const spill=createPhotoLedSpill(config);
  model.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=false;o.receiveShadow=false;
    const old=Array.isArray(o.material)?o.material:[o.material];
    const next=old.map(m=>{
      for(const value of Object.values(m))if(value?.isTexture)oldTextures.add(value);
      for(const key of ['map','normalMap','roughnessMap']){
        const texture=m[key];if(!texture)continue;
        texture.anisotropy=anisotropy;
      }
      const tile=o.userData.reference_surface==='photo_tile'||/^(Fayans \||Lavabo \|)/.test(m.name);
      if(tile){
        const key=m.map?.uuid||m.uuid;
        if(!replacements.has(key)){
          const material=new THREE.MeshBasicMaterial({map:m.map,color:0xffffff,side:m.side,toneMapped:false});
          material.name=m.name;material.userData={photoSource:palette.source,colourManaged:true};
          if(material.map){material.map.colorSpace=THREE.SRGBColorSpace;material.map.wrapS=material.map.wrapT=THREE.MirroredRepeatWrapping;material.map.needsUpdate=true;}
          applyPhotoLedSpill(material,spill);
          replacements.set(key,material);
        }
        oldMaterials.add(m);return replacements.get(key);
      }
      if(m.transmission>0){
        if(!replacements.has(m.uuid)){
          const glass=new THREE.MeshBasicMaterial({color:0xe9efed,transparent:true,opacity:.10,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
          glass.name=m.name;replacements.set(m.uuid,glass);
        }
        oldMaterials.add(m);return replacements.get(m.uuid);
      }
      const ceiling=/Alçıpan/.test(m.name);
      const light=m.emissive && m.emissive.getHex()!==0;
      if(ceiling||light){
        if(!replacements.has(m.uuid)){
          const material=new THREE.MeshBasicMaterial({color:ceiling?new THREE.Color(...palette.ceiling_srgb.map(c=>c/255)).convertSRGBToLinear():0xe8e6ce,toneMapped:false});
          material.name=m.name;
          if(ceiling)applyPhotoLedSpill(material,spill,true);
          replacements.set(m.uuid,material);
        }
        oldMaterials.add(m);return replacements.get(m.uuid);
      }
      m.envMapIntensity=.45;
      return m;
    });
    o.material=Array.isArray(o.material)?next:next[0];
    for(const m of next)for(const value of Object.values(m))if(value?.isTexture)retainedTextures.add(value);
  });
  oldMaterials.forEach(m=>m.dispose());
  oldTextures.forEach(t=>{if(!retainedTextures.has(t))t.dispose();});
  return batchStaticMeshes(model);
}

export function constructionLighting(world, model, renderer, camera, daylight, ambient, config, batch) {
  const previous={sun:daylight.intensity,sunColor:daylight.color.clone(),ambient:ambient.intensity,sky:ambient.color.clone(),ground:ambient.groundColor.clone(),exposure:renderer.toneMappingExposure,toneMapping:renderer.toneMapping};
  // Neutral fill affects furniture only. Photograph tiles bypass lighting and tone mapping.
  daylight.color.set(0xffffff);daylight.intensity=.65;
  ambient.color.set(0xffffff);ambient.groundColor.set(0xffffff);ambient.intensity=2.1;
  renderer.toneMapping=THREE.NoToneMapping;renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=false;
  return {
    mirror:false,lightCount:2,passes:1,batch,source:config.reference_appearance.source,
    dispose(){
      daylight.intensity=previous.sun;daylight.color.copy(previous.sunColor);
      ambient.intensity=previous.ambient;ambient.color.copy(previous.sky);ambient.groundColor.copy(previous.ground);
      renderer.toneMapping=previous.toneMapping;renderer.toneMappingExposure=previous.exposure;
    }
  };
}
