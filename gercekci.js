// Actual room lights and planar mirror for the construction reference scene.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
RectAreaLightUniformsLib.init();

export function prepareMaterials(model, renderer) {
  const max = renderer.capabilities.getMaxAnisotropy();
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = !o.userData.roof && !o.userData.front;
    o.receiveShadow = true;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      for (const key of ['map','normalMap','roughnessMap','metalnessMap']) {
        const tex=m[key];if (!tex) continue;
        tex.anisotropy=max;
        tex.minFilter=THREE.LinearMipmapLinearFilter;
        tex.magFilter=THREE.LinearFilter;
        tex.generateMipmaps=true;
        tex.needsUpdate=true;
      }
      m.envMapIntensity=.35;
      if (m.transmission > 0) {
        o.castShadow=false;
        m.roughness=.035;m.ior=1.5;m.thickness=.008;
      }
      if (m.emissiveMap || m.emissive?.getHex()) o.castShadow=false;
    }
  });
}

export function constructionLighting(world, model, renderer, camera, daylight, ambient) {
  const previous={sun:daylight.intensity,ambient:ambient.intensity,exposure:renderer.toneMappingExposure};
  daylight.intensity=.15;ambient.intensity=.32;
  renderer.toneMappingExposure=.95;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const group=new THREE.Group();group.name='3000K gerçek banyo aydınlatması';world.add(group);
  const mobile=matchMedia('(pointer:coarse)').matches;
  // Six warm ceiling lights, two shadow maps rather than six expensive mobile maps.
  for (const x of [.55,1.65]) for (const z of [-.48,-1.375,-2.27]) {
    const light=new THREE.SpotLight(0xffd6a3,13,4.5,Math.PI*.37,.65,2);
    light.position.set(x,2.20,z);light.target.position.set(x,.10,z);
    light.castShadow=z===-1.375;
    light.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);
    light.shadow.camera.near=.04;light.shadow.camera.far=4.5;
    light.shadow.bias=-.00015;light.shadow.normalBias=.005;
    group.add(light,light.target);
  }
  function strip(w,h,x,y,z,tx,ty,tz,intensity=4){
    const light=new THREE.RectAreaLight(0xffd49b,intensity,w,h);
    light.position.set(x,y,z);light.lookAt(tx,ty,tz);group.add(light);
  }
  // Perimeter light grazes the tile, instead of an external simulated sun.
  strip(2.55,.035,.065,2.245,-1.375,.60,1.25,-1.375,7);
  strip(2.55,.035,2.135,2.245,-1.375,1.60,1.25,-1.375,7);
  strip(2.0,.035,1.10,2.245,-.065,1.10,1.25,-.65,7);
  strip(2.0,.035,1.10,2.245,-2.685,1.10,1.25,-2.10,7);
  strip(.76,.025,.80,1.52,-2.715,.80,1.52,-2.0,3);
  strip(.018,.95,2.185,1.30,-2.05,1.8,1.1,-2.05,2);
  const original=[];
  model.traverse(o=>{if(o.isMesh && o.name.startsWith('6_3_yuvarlak_ayna') && !o.name.includes('LED')){original.push(o);o.visible=false;}});
  // glTF names retain spaces in some versions of the exporter.
  if(!original.length)model.traverse(o=>{if(o.isMesh && o.name==='6_3 yuvarlak ayna'){original.push(o);o.visible=false;}});
  const mirror=new Reflector(new THREE.CircleGeometry(.40,128),{
    textureWidth:mobile?1024:2048,textureHeight:mobile?1024:2048,
    clipBias:.001,color:0xfafafa,multisample:mobile?0:4
  });
  mirror.name='Banyonun gerçek ayna yansıması';mirror.position.set(.80,1.52,-2.718);group.add(mirror);
  // Reflection stays disabled if a future geometry change cannot find the original mirror.
  mirror.visible=original.length>0;
  const originalEnvironment=world.environment;
  let environment=null;
  function refresh(){
    const target=new THREE.WebGLCubeRenderTarget(mobile?256:512,{type:THREE.HalfFloatType});
    const probe=new THREE.CubeCamera(.04,10,target);probe.position.set(1.05,1.35,-1.45);
    const visibility=mirror.visible,shadows=renderer.shadowMap.enabled;
    try{
      mirror.visible=false;world.environment=originalEnvironment;
      renderer.shadowMap.enabled=false;world.updateMatrixWorld(true);
      probe.update(renderer,world);
      const pmrem=new THREE.PMREMGenerator(renderer);
      const next=pmrem.fromCubemap(target.texture);pmrem.dispose();
      environment?.dispose();environment=next;world.environment=next.texture;
    }finally{
      target.dispose();mirror.visible=visibility;renderer.shadowMap.enabled=shadows;
      if(environment)world.environment=environment.texture;
    }
  }
  return {
    mirror:mirror.visible,lightCount:6,refresh,
    dispose(){
      original.forEach(o=>o.visible=true);
      world.environment=originalEnvironment;environment?.dispose();
      world.remove(group);mirror.dispose();mirror.geometry.dispose();
      group.traverse(o=>{if(o.isLight)o.dispose();});
      daylight.intensity=previous.sun;ambient.intensity=previous.ambient;
      renderer.toneMappingExposure=previous.exposure;renderer.shadowMap.enabled=false;
    }
  };
}
