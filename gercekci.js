// Actual photograph colours, with a single inexpensive mobile render pass.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
          material.name=m.name;replacements.set(m.uuid,material);
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
