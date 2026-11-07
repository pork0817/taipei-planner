// Loads the Kenney CC0 model kits (assets/models/*), merges each model into a
// single geometry centred on x/z with its base at y=0, and shares one Lambert
// material per kit (they all use a small colour-map texture).
import * as THREE from '../../vendor/three.module.min.js';
import { GLTFLoader } from '../../vendor/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';

const L = c => c.split('');
export const MODEL_SETS = {
  commercial: [...L('abcdefghijklmn').map(c => 'building-' + c), ...L('abcde').map(c => 'building-skyscraper-' + c)],
  suburban: [...L('abcdefghijklmnopqrstu').map(c => 'building-type-' + c), 'tree-large', 'tree-small'],
  industrial: [...L('abcdefghijklmnopqrst').map(c => 'building-' + c), 'detail-tank', 'water-tower'],
  cars: ['sedan', 'taxi', 'suv', 'van', 'police', 'delivery', 'truck', 'hatchback-sports', 'suv-luxury', 'garbage-truck'],
};

const VARIANTS = { commercial: ['variation-a', 'variation-b'], suburban: ['variation-a', 'variation-b', 'variation-c'], industrial: ['variation-a', 'variation-b', 'variation-c'], cars: [] };

export class ModelLibrary {
  constructor() { this.models = {}; this.mats = {}; this.variantMats = {}; this.ready = false; }

  async load(onProgress) {
    const loader = new GLTFLoader();
    const jobs = [];
    for (const [kit, names] of Object.entries(MODEL_SETS)) for (const n of names) jobs.push([kit, n]);
    let done = 0;
    await Promise.all(jobs.map(async ([kit, name]) => {
      try {
        const g = await loader.loadAsync(`assets/models/${kit}/${name}.glb`);
        g.scene.updateMatrixWorld(true);
        const geos = [];
        let map = null;
        g.scene.traverse(o => {
          if (!o.isMesh) return;
          let geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld);
          for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a);
          if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
          if (geo.index) geo = geo.toNonIndexed();
          geos.push(geo);
          map ||= o.material && o.material.map;
        });
        const merged = mergeGeometries(geos, false);
        merged.computeBoundingBox();
        const b = merged.boundingBox;
        merged.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        merged.computeBoundingBox();
        const size = merged.boundingBox.getSize(new THREE.Vector3());
        if (!this.mats[kit] && map) {
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.LinearMipmapLinearFilter;
          map.colorSpace = THREE.SRGBColorSpace;
          this.mats[kit] = new THREE.MeshLambertMaterial({ map });
        }
        this.models[`${kit}/${name}`] = { key: `${kit}/${name}`, kit, name, geo: merged, size, tris: merged.attributes.position.count / 3 };
      } catch (e) { console.warn('model failed', kit, name, e); }
      onProgress?.(++done / jobs.length);
    }));
    // extra colour-map textures shipped with each kit give buildings varied facades
    const tl = new THREE.TextureLoader();
    for (const [kit, names] of Object.entries(VARIANTS)) {
      const base = this.mats[kit];
      if (!base) continue;
      this.variantMats[kit] = [base];
      for (const n of names) {
        try {
          const t = await tl.loadAsync(`assets/models/${kit}/Textures/${n}.png`);
          t.flipY = base.map.flipY; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
          this.variantMats[kit].push(new THREE.MeshLambertMaterial({ map: t }));
        } catch (e) { /* optional */ }
      }
    }
    for (const m of Object.values(this.models)) { m.mat = this.mats[m.kit] || new THREE.MeshLambertMaterial({ color: 0xcccccc }); m.variants = this.variantMats[m.kit] || [m.mat]; }
    this.ready = true;
    return this;
  }

  get(key) { return this.models[key]; }
  list(kit, prefix = '') { return Object.values(this.models).filter(m => m.kit === kit && m.name.startsWith(prefix)); }
}
