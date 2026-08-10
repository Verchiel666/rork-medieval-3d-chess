import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { ArenaLook, FloraLook } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { terrainHeight } from "./battlefield";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";
import { shaftTexture, sparkTexture } from "./textures";

/**
 * 太阳神庙地图的热带雨林装饰：一圈树冠大树把空地围合起来，
 * 棕榈与蕨丛挤满残墙，藤蔓从拱廊垂下，阳光束穿过叶隙，
 * 花粉四处飘散，天际线上还有两座阶梯太阳金字塔。
 *
 * 整个覆盖层是一个分组，在其它地图上只是被隐藏，因此切换
 * 竞技场从不重建几何体。所有东西都是实例化的，且不受阴影
 * 影响（阴影相机只覆盖棋盘），所以只花少量绘制调用。
 */

const MAX_TREES = 150;
const MAX_PALMS = 34;
const MAX_FERNS = 190;
const MAX_VINES = 76;
const MAX_POLLEN = 260;
const BEAM_COUNT = 6;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一片躺在 XZ 平面上的披针形叶子，叶尖朝 +Z，基部在原点。 */
function leafGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.2, 0.22, 0.22, 0.72, 0, 1);
  shape.bezierCurveTo(-0.22, 0.72, -0.2, 0.22, 0, 0);
  const geometry = new THREE.ShapeGeometry(shape, 6);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** 茂密的地面蕨丛：五片成对叶子的羽叶从一个叶冠扇形展开。 */
function fernGeometry(leaf: THREE.BufferGeometry): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let frond = 0; frond < 5; frond += 1) {
    const spin = (frond / 5) * Math.PI * 2 + 0.4;
    for (let i = 0; i < 6; i += 1) {
      const along = i / 5;
      for (const side of [-1, 1]) {
        const blade = leaf.clone();
        const length = 0.42 * (1 - along * 0.55);
        blade.scale(length, length, length * 2.1);
        // 叶子沿羽叶排布，越靠近叶尖越向外倾。
        blade.rotateX(0.5 + along * 0.5);
        blade.rotateY(spin + side * (0.34 + along * 0.2));
        blade.translate(
          Math.sin(spin) * along * 0.5,
          0.16 + along * 0.62 - along * along * 0.34,
          Math.cos(spin) * along * 0.5,
        );
        parts.push(blade);
      }
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? leaf.clone();
}

/** 纤细的棕榈：倾斜的树干顶着一冠下垂的羽叶。 */
function palmGeometry(leaf: THREE.BufferGeometry): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.2, 1, 6, 1);
  trunk.translate(0, 0.5, 0);
  parts.push(trunk);

  for (let frond = 0; frond < 8; frond += 1) {
    const spin = (frond / 8) * Math.PI * 2 + 0.3;
    for (let i = 0; i < 5; i += 1) {
      const along = i / 4;
      for (const side of [-1, 1]) {
        const blade = leaf.clone();
        const length = 0.3 * (1 - along * 0.4);
        blade.scale(length, length, length * 2.4);
        blade.rotateX(0.9 + along * 0.9);
        blade.rotateY(spin + side * 0.3);
        blade.translate(Math.sin(spin) * (0.18 + along * 0.5), 1 - along * 0.28, Math.cos(spin) * (0.18 + along * 0.5));
        parts.push(blade);
      }
    }
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? trunk;
}

/** 垂挂的藤蔓：一条从原点垂下的单位长藤条，沿途长着叶子。 */
function vineGeometry(leaf: THREE.BufferGeometry): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cord = new THREE.CylinderGeometry(0.028, 0.02, 1, 4, 1);
  cord.translate(0, -0.5, 0);
  parts.push(cord);

  for (let i = 0; i < 7; i += 1) {
    const along = 0.12 + (i / 7) * 0.85;
    const blade = leaf.clone();
    blade.scale(0.16, 0.16, 0.3);
    blade.rotateX(1.1);
    blade.rotateY(i * 1.9);
    blade.translate(Math.sin(i * 1.9) * 0.06, -along, Math.cos(i * 1.9) * 0.06);
    parts.push(blade);
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged ?? cord;
}

/** 注入实例化植物材质顶点阶段的风中摇摆。 */
function addSway(material: THREE.MeshStandardMaterial, time: { value: number }, amount: number, speed: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uSway = { value: amount };
    shader.uniforms.uSwaySpeed = { value: speed };
    shader.vertexShader = `uniform float uTime;\nuniform float uSway;\nuniform float uSwaySpeed;\n${shader.vertexShader}`.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayOrigin = instanceMatrix[3].xyz;
        #else
          vec3 swayOrigin = vec3(0.0);
        #endif
        float swayPhase = uTime * uSwaySpeed + swayOrigin.x * 0.09 + swayOrigin.z * 0.11;
        float swayReach = max(0.0, position.y) + 0.35;
        transformed.x += sin(swayPhase) * uSway * swayReach;
        transformed.z += cos(swayPhase * 0.83) * uSway * 0.65 * swayReach;
      `,
    );
  };
  material.needsUpdate = true;
}

export class JungleOverlay {
  readonly group = new THREE.Group();

  private rng = mulberry32(0x51a17e);
  private disposables: { dispose: () => void }[] = [];
  private windUniforms: { value: number }[] = [];

  private trunkMaterial: THREE.MeshStandardMaterial | null = null;
  private canopyMaterials: THREE.MeshStandardMaterial[] = [];
  private frondMaterial: THREE.MeshStandardMaterial | null = null;
  private vineMaterial: THREE.MeshStandardMaterial | null = null;
  private templeStone: THREE.MeshStandardMaterial | null = null;
  private templeMoss: THREE.MeshStandardMaterial | null = null;
  private templeGold: THREE.MeshStandardMaterial | null = null;
  private sunDiscMaterial: THREE.MeshBasicMaterial | null = null;

  private trunks: THREE.InstancedMesh | null = null;
  private canopies: THREE.InstancedMesh[] = [];
  private palms: THREE.InstancedMesh | null = null;
  private ferns: THREE.InstancedMesh | null = null;
  private vines: THREE.InstancedMesh | null = null;
  private beams: THREE.Mesh[] = [];
  private pollen: THREE.Points | null = null;
  private pollenMaterial: THREE.PointsMaterial | null = null;
  private pollenDrift: Float32Array = new Float32Array(0);

  private beamOpacity = 0.3;
  private beamsAllowed = true;
  private elapsed = 0;
  private look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA];

  constructor(quality: QualityPreset, look: ArenaLook = ARENA_LOOKS[DEFAULT_ARENA]) {
    this.group.name = "jungle";
    this.group.visible = false;

    const leaf = leafGeometry();
    this.buildForest();
    this.buildUnderstory(leaf);
    this.buildVines(leaf);
    this.buildTemples();
    this.buildBeams();
    this.buildPollen();
    leaf.dispose();

    this.applyQuality(quality);
    this.applyArena(look);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  // ----------------------------------------------------------------- 树冠

  /**
   * 围合空地的雨林树墙。树按距离排序摆放，因此调低画质
   * 预设时先削减远处的林线，始终保住框住棋盘的那一圈。
   */
  private buildForest(): void {
    const trunkGeo = this.track(new THREE.CylinderGeometry(0.28, 0.62, 1, 6, 1));
    trunkGeo.translate(0, 0.5, 0);
    const blobGeo = this.track(new THREE.IcosahedronGeometry(1, 0));

    const trunkMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x5b4732, roughness: 1, metalness: 0, flatShading: true }),
    );
    this.trunkMaterial = trunkMat;

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
    trunks.frustumCulled = false;
    this.trunks = trunks;
    this.group.add(trunks);

    const layers = 3;
    const time = { value: 0 };
    this.windUniforms.push(time);
    for (let layer = 0; layer < layers; layer += 1) {
      const material = this.track(
        new THREE.MeshStandardMaterial({ color: 0x4f8c33, roughness: 0.95, metalness: 0, flatShading: true }),
      );
      addSway(material, time, 0.05 + layer * 0.02, 0.6);
      this.canopyMaterials.push(material);
      const mesh = new THREE.InstancedMesh(blobGeo, material, MAX_TREES);
      mesh.frustumCulled = false;
      this.canopies.push(mesh);
      this.group.add(mesh);
    }

    // 一圈树，靠近空地处更密更高，让空地有被墙围起来的感觉。
    const trees: { x: number; z: number; y: number; height: number; girth: number; radius: number }[] = [];
    for (let i = 0; i < MAX_TREES; i += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = 24 + Math.pow(this.rng(), 0.7) * 62;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      trees.push({
        x,
        z,
        y: terrainHeight(x, z) - 0.7,
        height: 11 + this.rng() * 13 + Math.max(0, 34 - radius) * 0.22,
        girth: 0.8 + this.rng() * 0.7,
        radius,
      });
    }
    trees.sort((a, b) => a.radius - b.radius);

    const dummy = new THREE.Object3D();
    trees.forEach((tree, index) => {
      dummy.position.set(tree.x, tree.y, tree.z);
      dummy.rotation.set((this.rng() - 0.5) * 0.09, this.rng() * Math.PI, (this.rng() - 0.5) * 0.09);
      dummy.scale.set(tree.girth, tree.height, tree.girth);
      dummy.updateMatrix();
      trunks.setMatrixAt(index, dummy.matrix);

      // 树冠、中层和背光的下层团块——三团块构成一棵可信的树。
      const crowns: [number, number][] = [
        [1, 3.1 + this.rng() * 1.5],
        [0.82, 3.6 + this.rng() * 1.6],
        [0.64, 3.1 + this.rng() * 1.4],
      ];
      crowns.forEach(([lift, size], layer) => {
        const wobble = 0.6 + this.rng() * 0.8;
        dummy.position.set(
          tree.x + Math.sin(index * 2.1 + layer) * wobble,
          tree.y + tree.height * lift - size * 0.35,
          tree.z + Math.cos(index * 1.7 + layer) * wobble,
        );
        dummy.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
        const flatten = 0.68 + this.rng() * 0.2;
        dummy.scale.set(size, size * flatten, size);
        dummy.updateMatrix();
        this.canopies[layer].setMatrixAt(index, dummy.matrix);
      });
    });

    trunks.instanceMatrix.needsUpdate = true;
    for (const mesh of this.canopies) mesh.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------- 下层植被

  /** 挤满断墙线与庭院边缘的棕榈和蕨丛。 */
  private buildUnderstory(leaf: THREE.BufferGeometry): void {
    const time = { value: 0 };
    this.windUniforms.push(time);

    const frondMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x63993a,
        roughness: 0.86,
        metalness: 0,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
    );
    addSway(frondMat, time, 0.045, 1.05);
    this.frondMaterial = frondMat;

    const palmGeo = this.track(palmGeometry(leaf));
    const palms = new THREE.InstancedMesh(palmGeo, frondMat, MAX_PALMS);
    palms.frustumCulled = false;
    this.palms = palms;
    this.group.add(palms);

    const fernGeo = this.track(fernGeometry(leaf));
    const ferns = new THREE.InstancedMesh(fernGeo, frondMat, MAX_FERNS);
    ferns.frustumCulled = false;
    this.ferns = ferns;
    this.group.add(ferns);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < MAX_PALMS; i += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = 18.5 + this.rng() * 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      dummy.position.set(x, terrainHeight(x, z) - 0.7, z);
      dummy.rotation.set((this.rng() - 0.5) * 0.3, this.rng() * Math.PI, (this.rng() - 0.5) * 0.3);
      dummy.scale.setScalar(4.5 + this.rng() * 3.4);
      dummy.updateMatrix();
      palms.setMatrixAt(i, dummy.matrix);
    }
    palms.instanceMatrix.needsUpdate = true;

    // 蕨丛先贴着瓦砾线生长，再蔓延到平原上。
    const spots: { x: number; z: number; radius: number }[] = [];
    for (let i = 0; i < MAX_FERNS; i += 1) {
      const angle = this.rng() * Math.PI * 2;
      const radius = 15.8 + Math.pow(this.rng(), 0.8) * 20;
      spots.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius });
    }
    spots.sort((a, b) => a.radius - b.radius);
    spots.forEach((spot, index) => {
      dummy.position.set(spot.x, terrainHeight(spot.x, spot.z) - 0.72, spot.z);
      dummy.rotation.set(0, this.rng() * Math.PI, 0);
      dummy.scale.setScalar(1.1 + this.rng() * 1.5);
      dummy.updateMatrix();
      ferns.setMatrixAt(index, dummy.matrix);
    });
    ferns.instanceMatrix.needsUpdate = true;
  }

  /** 从拱廊和残破幕墙上垂落的藤蔓。 */
  private buildVines(leaf: THREE.BufferGeometry): void {
    const time = { value: 0 };
    this.windUniforms.push(time);
    const material = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x4f7d36,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
    );
    addSway(material, time, 0.03, 0.8);
    this.vineMaterial = material;

    const geometry = this.track(vineGeometry(leaf));
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_VINES);
    mesh.frustumCulled = false;
    this.vines = mesh;
    this.group.add(mesh);

    const dummy = new THREE.Object3D();
    for (let i = 0; i < MAX_VINES; i += 1) {
      // 三分之二挂在柱拱廊上，其余挂在墙残桩上。
      const fromArcade = i % 3 !== 0;
      const angle = this.rng() * Math.PI * 2;
      const radius = fromArcade ? 12.5 + (this.rng() - 0.5) * 1.4 : 17 + (this.rng() - 0.5) * 0.8;
      const top = fromArcade ? 9.3 : 4.6 + this.rng() * 3;
      dummy.position.set(Math.cos(angle) * radius, top, Math.sin(angle) * radius);
      dummy.rotation.set(0, this.rng() * Math.PI, 0);
      const length = 2.4 + this.rng() * 4.4;
      dummy.scale.set(1 + this.rng() * 0.5, length, 1 + this.rng() * 0.5);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ----------------------------------------------------------------- 神庙

  private buildTemples(): void {
    this.templeStone = this.track(
      new THREE.MeshStandardMaterial({ color: 0xb3a785, roughness: 0.95, metalness: 0.02 }),
    );
    this.templeMoss = this.track(new THREE.MeshStandardMaterial({ color: 0x6d8149, roughness: 1 }));
    this.templeGold = this.track(
      new THREE.MeshStandardMaterial({ color: 0xe2b64c, roughness: 0.32, metalness: 0.85 }),
    );

    this.group.add(this.buildTemple(1.02, 58, 1, true));
    this.group.add(this.buildTemple(2.75, 70, 0.58, false));
  }

/** 一座阶梯太阳金字塔：覆满苔藓的层级、一段阶梯，以及顶部一座镀金神龛。 */
  private buildTemple(angle: number, radius: number, scale: number, gilded: boolean): THREE.Group {
    const temple = new THREE.Group();
    const stone = this.templeStone as THREE.MeshStandardMaterial;
    const moss = this.templeMoss as THREE.MeshStandardMaterial;
    const gold = this.templeGold as THREE.MeshStandardMaterial;

    const tiers = 6;
    const tierHeight = 4.4;
    let width = 30;
    for (let i = 0; i < tiers; i += 1) {
      const geometry = this.track(new THREE.BoxGeometry(width, tierHeight, width));
      const tier = new THREE.Mesh(geometry, i % 2 === 0 ? stone : moss);
      tier.position.y = i * tierHeight + tierHeight / 2;
      temple.add(tier);

      // 每级台阶边缘的长苔凸沿，让层级在远处也能看清。
      const lipGeo = this.track(new THREE.BoxGeometry(width + 0.9, 0.7, width + 0.9));
      const lip = new THREE.Mesh(lipGeo, moss);
      lip.position.y = i * tierHeight + tierHeight - 0.2;
      temple.add(lip);

      width -= 4.1;
    }

    const summit = tiers * tierHeight;

    // 沿朝向棋盘那一面而下的中央阶梯。
    const stairGeo = this.track(new THREE.BoxGeometry(7.4, summit * 1.02, 13));
    const stair = new THREE.Mesh(stairGeo, stone);
    stair.position.set(0, summit / 2, 15.5);
    stair.rotation.x = -0.62;
    temple.add(stair);

    // 神龛。
    const shrineGeo = this.track(new THREE.BoxGeometry(width + 3.4, 7.4, width + 3.4));
    const shrine = new THREE.Mesh(shrineGeo, stone);
    shrine.position.y = summit + 3.7;
    temple.add(shrine);

    const combGeo = this.track(new THREE.BoxGeometry(width + 4.6, 3.4, 1.6));
    const comb = new THREE.Mesh(combGeo, gilded ? gold : moss);
    comb.position.y = summit + 9;
    temple.add(comb);

    const doorGeo = this.track(new THREE.BoxGeometry(3.2, 4.4, 1.2));
    const door = new THREE.Mesh(doorGeo, moss);
    door.position.set(0, summit + 2.4, (width + 3.4) / 2);
    temple.add(door);

    if (gilded) {
      const discGeo = this.track(new THREE.CircleGeometry(3.1, 24));
      const discMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffd06a, fog: false }));
      this.sunDiscMaterial = discMat;
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.set(0, summit + 4.6, (width + 3.4) / 2 + 0.9);
      temple.add(disc);

      const raysGeo = this.track(new THREE.RingGeometry(3.4, 4.6, 16, 1));
      const rays = new THREE.Mesh(raysGeo, gold);
      rays.position.copy(disc.position).setZ(disc.position.z - 0.3);
      temple.add(rays);
    }

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    temple.position.set(x, terrainHeight(x, z) - 0.9, z);
    temple.rotation.y = -angle + Math.PI / 2;
    temple.scale.setScalar(scale);
    return temple;
  }

  // ------------------------------------------------------------ 大气效果

  /** 穿过树冠缝隙刺向空地的阳光束。 */
  private buildBeams(): void {
    const map = this.track(shaftTexture());
    const geometry = this.track(new THREE.PlaneGeometry(4.6, 22));

    for (let i = 0; i < BEAM_COUNT; i += 1) {
      const material = this.track(
        new THREE.MeshBasicMaterial({
          map,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          opacity: 0.3,
          fog: false,
        }),
      );
      const beam = new THREE.Mesh(geometry, material);
      const angle = (i / BEAM_COUNT) * Math.PI * 2 + 0.5;
      const radius = 7.5 + this.rng() * 8;
      beam.position.set(Math.cos(angle) * radius, 7.5, Math.sin(angle) * radius);
      beam.scale.set(0.7 + this.rng() * 0.7, 1, 1);
      beam.renderOrder = 2;
      this.beams.push(beam);
      this.group.add(beam);
    }
  }

  /** 在光柱中翻飞的花粉与种绒。 */
  private buildPollen(): void {
    const positions = new Float32Array(MAX_POLLEN * 3);
    this.pollenDrift = new Float32Array(MAX_POLLEN);
    for (let i = 0; i < MAX_POLLEN; i += 1) {
      positions[i * 3] = (this.rng() - 0.5) * 34;
      positions[i * 3 + 1] = this.rng() * 11;
      positions[i * 3 + 2] = (this.rng() - 0.5) * 34;
      this.pollenDrift[i] = 0.1 + this.rng() * 0.32;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = this.track(
      new THREE.PointsMaterial({
        size: 0.12,
        map: this.track(sparkTexture()),
        color: 0xffe6a0,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    this.pollenMaterial = material;
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.pollen = points;
    this.group.add(points);
  }

  // ---------------------------------------------------------------- 运行时

  /** 只为请求它的地图布置雨林，并重新上色。 */
  applyArena(look: ArenaLook): void {
    this.look = look;
    const flora: FloraLook = look.flora;
    this.group.visible = flora.enabled;
    if (!flora.enabled) return;

    this.trunkMaterial?.color.setHex(flora.trunk);
    const shades = [flora.canopySun, flora.canopy, flora.canopyDeep];
    this.canopyMaterials.forEach((material, index) => material.color.setHex(shades[index] ?? flora.canopy));
    this.frondMaterial?.color.setHex(flora.frond);
    this.vineMaterial?.color.setHex(flora.vine);
    this.templeStone?.color.setHex(flora.temple.stone);
    this.templeMoss?.color.setHex(flora.temple.moss);
    this.templeGold?.color.setHex(flora.temple.gold);
    this.sunDiscMaterial?.color.setHex(flora.temple.gold).lerp(new THREE.Color(0xffffff), 0.35);

    this.beamOpacity = flora.beam.opacity;
    for (const beam of this.beams) {
      const material = beam.material as THREE.MeshBasicMaterial;
      material.color.setHex(flora.beam.color);
    }
    if (this.pollenMaterial) {
      this.pollenMaterial.color.setHex(flora.pollen.color);
      this.pollenMaterial.opacity = flora.pollen.opacity;
    }
  }

  applyQuality(preset: QualityPreset): void {
    const settings = QUALITY_SETTINGS[preset];
    const density = preset === "low" ? 0.4 : preset === "medium" ? 0.68 : preset === "high" ? 0.88 : 1;

    const trees = Math.round(MAX_TREES * density);
    if (this.trunks) this.trunks.count = trees;
    for (const mesh of this.canopies) mesh.count = trees;
    if (this.palms) this.palms.count = Math.round(MAX_PALMS * density);
    if (this.ferns) this.ferns.count = Math.round(MAX_FERNS * density);
    if (this.vines) {
      this.vines.count = Math.round(MAX_VINES * density);
      this.vines.visible = settings.battleProps;
    }
    // 背光的下层树冠纯粹是景深层次——最先被砍掉的东西。
    if (this.canopies[2]) this.canopies[2].visible = preset !== "low";

    this.beamsAllowed = settings.lightShafts;
    for (const beam of this.beams) beam.visible = this.beamsAllowed;

    if (this.pollen) {
      const count = Math.min(MAX_POLLEN, Math.round(settings.dustCount * 0.3));
      this.pollen.visible = count > 0;
      this.pollen.geometry.setDrawRange(0, count);
    }
  }

  update(delta: number, camera: THREE.Camera): void {
    if (!this.group.visible) return;
    this.elapsed += delta;
    for (const uniform of this.windUniforms) uniform.value = this.elapsed;

    for (const beam of this.beams) {
      if (!beam.visible) continue;
      // 绕 Y 轴做广告牌化，让光柱永远不会塌成一条线。
      beam.rotation.y = Math.atan2(camera.position.x - beam.position.x, camera.position.z - beam.position.z);
      const material = beam.material as THREE.MeshBasicMaterial;
      material.opacity = this.beamOpacity * (0.72 + Math.sin(this.elapsed * 0.55 + beam.position.x) * 0.25);
    }

    if (this.pollen?.visible) {
      const attribute = this.pollen.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const count = this.pollen.geometry.drawRange.count;
      for (let i = 0; i < count; i += 1) {
        const drift = this.pollenDrift[i];
        array[i * 3] += Math.sin(this.elapsed * 0.5 + i) * 0.004 + 0.006;
        array[i * 3 + 1] += (drift - 0.16) * delta * 0.8;
        array[i * 3 + 2] += Math.cos(this.elapsed * 0.42 + i * 0.7) * 0.004;
        if (array[i * 3 + 1] > 12 || array[i * 3 + 1] < 0) {
          array[i * 3 + 1] = array[i * 3 + 1] < 0 ? 0.2 : 0.4;
          array[i * 3] = (Math.random() - 0.5) * 34;
          array[i * 3 + 2] = (Math.random() - 0.5) * 34;
        }
      }
      attribute.needsUpdate = true;
    }
  }

  /** 当前绘制到覆盖层上的主题。 */
  get staged(): boolean {
    return this.look.flora.enabled;
  }

  dispose(): void {
    for (const mesh of [this.trunks, this.palms, this.ferns, this.vines, ...this.canopies]) mesh?.dispose();
    this.pollen?.geometry.dispose();
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.canopies = [];
    this.beams = [];
    this.group.clear();
  }
}
