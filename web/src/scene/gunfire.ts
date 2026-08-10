/**
 * 黑火药：弹丸离开炮管时是什么样子的。
 *
 * 大军团不靠鬼火作战。它的军官、线列步兵和炮兵用
 * 枪口的一团火光、一片灰白硝烟和一颗几乎快到来不及
 * 看清就横穿棋盘的弹丸在远处杀敌。这里的一切都是
 * 挂在调用方补间时钟上的加法混合广告牌——在一次射击内
 * 完成构建、动画与销毁，因此没有任何东西需要在
 * 帧循环里占一个常驻位置。
 *
 * 灯光永远是从场景共享池中*借用*的，绝不新建：
 * three.js 以场景中的灯光数量作为着色器程序的键，
 * 战斗中新增一盏灯会让大厅里所有材质重新编译
 * （见 {@link SpellLightPool}）。
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { Faction } from "../core/types";
import { AMMUNITION, type AmmoKind, type AmmoSpec, disposeAmmunition, loadRound } from "./ammunition";
import type { SpellLight } from "./spells";
import { fineSmokeTexture, muzzleFlashTexture, radialTexture, smokeTexture, tracerTexture } from "./textures";
import { TracerStreak } from "./tracer";

/** 一支军队的火药如何燃烧。双方使用相同的发射药；只有
 * 烟雾的军服色调不同，因此一轮齐射看起来永远是火药
 * 而非法术。 */
export interface GunLook {
  /** 膛口的火光。 */
  flash: number;
  /** 被推出膛口前方的燃烧火药光晕。 */
  ball: number;
  /** 从枪管上翻滚而下的火药烟。 */
  smoke: number;
  /** 火光投进大厅的颜色。 */
  light: number;
}

export const GUN_LOOK: Record<Faction, GunLook> = {
  w: { flash: 0xfff6dd, ball: 0xffe6b4, smoke: 0xcfd4dc, light: 0xffd9a0 },
  b: { flash: 0xfff1c8, ball: 0xffcf82, smoke: 0xc8bfae, light: 0xffb45e },
};

/** 归一化弹丸的建模坐标系：弹头朝 +Z。 */
const FORWARD = new THREE.Vector3(0, 0, 1);

let flashMap: THREE.CanvasTexture | null = null;
let ballMap: THREE.CanvasTexture | null = null;
let puffMap: THREE.CanvasTexture | null = null;
let finePuffMap: THREE.CanvasTexture | null = null;
let smearMap: THREE.CanvasTexture | null = null;
let smearGeometry: THREE.BufferGeometry | null = null;

function sharedFlashMap(): THREE.CanvasTexture {
  if (!flashMap) flashMap = muzzleFlashTexture();
  return flashMap;
}

function sharedBallMap(): THREE.CanvasTexture {
  if (!ballMap) ballMap = radialTexture("rgba(255,255,255,1)", "rgba(255,190,110,0)");
  return ballMap;
}

function sharedPuffMap(): THREE.CanvasTexture {
  if (!puffMap) puffMap = smokeTexture();
  return puffMap;
}

/** 线膛枪管留下的更淡、更纤细的烟晕。 */
function sharedFinePuffMap(): THREE.CanvasTexture {
  if (!finePuffMap) finePuffMap = fineSmokeTexture();
  return finePuffMap;
}

function sharedSmearMap(): THREE.CanvasTexture {
  if (!smearMap) smearMap = tracerTexture();
  return smearMap;
}

/**
 * 弹丸运动拖影的主体：一个一单位长的圆锥，在金属所在处
 * 又宽又亮，向后逐渐收窄至无。建模时宽端位于原点、
 * 尖端沿飞行轴负方向，因此一次射击只需把它指向飞行
 * 方向并按自身口径缩放即可。
 */
function sharedSmearGeometry(): THREE.BufferGeometry {
  if (!smearGeometry) {
    const cone = new THREE.CylinderGeometry(0.34, 0, 1, 10, 1, true);
    // 宽端对齐原点、尖端垂在下方，然后整体从车削体的
    // +Y 轴翻转到飞行轴上。
    cone.translate(0, -0.5, 0);
    cone.rotateX(Math.PI / 2);
    smearGeometry = cone;
  }
  return smearGeometry;
}

// ---------------------------------------------------------------- 弹丸

/** 命名模型轴，由生成器为每个雕塑报告。 */
type AxisName = "positiveX" | "negativeX" | "positiveY" | "negativeY" | "positiveZ" | "negativeZ";

const AXES: Record<AxisName, THREE.Vector3> = {
  positiveX: new THREE.Vector3(1, 0, 0),
  negativeX: new THREE.Vector3(-1, 0, 0),
  positiveY: new THREE.Vector3(0, 1, 0),
  negativeY: new THREE.Vector3(0, -1, 0),
  positiveZ: new THREE.Vector3(0, 0, 1),
  negativeZ: new THREE.Vector3(0, 0, -1),
};

/** 生成的弹丸雕塑及其建模时所用的轴向。 */
export interface ShotModelSource {
  url: string;
  /** 该雕塑对应哪种弹丸的真身。 */
  ammo: AmmoKind;
  /**
   * 生成器报告时，弹头在雕塑自身坐标系中指向的方向。
   * 铸造弹丸是旋转体，因此通常返回*无方向*——省略此项时，
   * 将改用从网格测得的长轴作为弹头方向，这也正是子弹
   * 外形所表达的含义。
   */
  front?: AxisName;
  /** 雕塑自身的上方向轴。仅与 `front` 一起使用时才有意义。 */
  up?: AxisName;
}

/**
 * 生成的雕塑，按其替代的弹丸种类为键，只做一次归一化：
 * 弹头沿飞行线、以自身中心为原点、长度为一个世界单位，
 * 因此一次射击只需按口径缩放。手头没有雕塑的种类则改用
 * 程序化锻造（见 `ammunition.ts`），所以下载缓慢永远不会
 * 让军队失去弹药。
 */
const sculpts = new Map<AmmoKind, THREE.Object3D>();
const sculptJobs = new Map<AmmoKind, Promise<void>>();

function basis(front: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const f = front.clone().normalize();
  const r = new THREE.Vector3().crossVectors(up, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
}

/**
 * 从雕塑自身包围盒测得的最长轴。对铸造弹丸而言，按定义
 * 这就是弹头到弹底的连线，所以无方向的弹丸仍然可以
 * 弹头朝前飞行，而无需猜测偏航常量。
 */
function longestAxis(model: THREE.Object3D): THREE.Vector3 {
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(model).getSize(size);
  if (size.x >= size.y && size.x >= size.z) return new THREE.Vector3(1, 0, 0);
  if (size.y >= size.z) return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

/** 任一与给定向量正交的单位向量——足以补全一个基。 */
function perpendicular(axis: THREE.Vector3): THREE.Vector3 {
  return Math.abs(axis.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
}

/**
 * 拉取生成的弹丸并为其做好飞行准备。大厅构建时调用一次；
 * 失败会被有意吞掉——缺失的雕塑绝不能让军队失去炮火。
 */
export function primeShotModel(source: ShotModelSource): Promise<void> {
  const running = sculptJobs.get(source.ammo);
  if (running) return running;
  const job = (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(source.url);
      // 把雕塑自身坐标系旋转到“弹头沿 +Z、上方向沿 +Y”，
      // 这正是射击时沿飞行线定向所用的坐标系。无方向的
      // 弹丸没有报告 front，因此取其自身最长延伸作为弹头。
      const oriented = new THREE.Group();
      const front = source.front ? AXES[source.front] : longestAxis(gltf.scene);
      const up = source.up ? AXES[source.up] : perpendicular(front);
      const correction = basis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0))
        .multiply(basis(front, up).invert());
      gltf.scene.quaternion.copy(correction);
      oriented.add(gltf.scene);

      // 弹头到弹底一单位长，以自身中心为原点。
      const box = new THREE.Box3().setFromObject(oriented);
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(centre);
      const length = Math.max(1e-4, size.z);
      gltf.scene.position.sub(centre);
      oriented.scale.setScalar(1 / length);

      oriented.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // 飞行中的弹丸只是十分之一秒内掠过屏幕的几个像素；
        // 用过期的包围球剔除它会让它闪烁。
        mesh.frustumCulled = false;
        legible(mesh.material);
      });
      sculpts.set(source.ammo, oriented);
    } catch (error) {
      console.warn(`[gunfire] ${source.ammo} 雕塑不可用，改为程序化锻造`, error);
    }
  })();
  sculptJobs.set(source.ammo, job);
  return job;
}

/**
 * 让雕塑自身的金属在高速下仍然可辨。
 *
 * 生成的弹丸回来时是又小又暗、近乎镜面的物体。这在物理上
 * 合理，视觉上却毫无用处：火把照亮的大厅里没什么可反射，
 * 它渲染成几个像素宽的黑点，这一枪就像从没发生过。因此
 * 把金属从全镜面拉低、提高粗糙度、垫一层自发光灰，并让它
 * 强烈地接收环境反射。
 */
function legible(material: THREE.Material | THREE.Material[]): void {
  const list = Array.isArray(material) ? material : [material];
  for (const entry of list) {
    const metal = entry as THREE.MeshStandardMaterial;
    if (!metal.isMeshStandardMaterial) continue;
    metal.metalness = Math.min(metal.metalness, 0.6);
    metal.roughness = THREE.MathUtils.clamp(metal.roughness, 0.35, 0.7);
    metal.envMapIntensity = 1.3;
    // 着色垫一层底色，让弹丸对着大厅远墙时不会变成纯黑。
    metal.emissive = new THREE.Color(0x2c3138);
    metal.emissiveIntensity = 1;
    metal.needsUpdate = true;
  }
}

/**
 * 为一次射击复制雕塑材质并返回，这样一颗带着炽热离开
 * 膛口的弹丸可以在飞越途中冷却，而不会让仍在空中的
 * 同类弹丸一起变暗。
 */
function ownMetal(round: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const owned: THREE.MeshStandardMaterial[] = [];
  round.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const metal = mesh.material as THREE.MeshStandardMaterial;
    if (!metal.isMeshStandardMaterial) return;
    const copy = metal.clone();
    copy.emissive = new THREE.Color(0xff5a1e);
    copy.emissiveIntensity = 0;
    mesh.material = copy;
    owned.push(copy);
  });
  return owned;
}

/** 释放共享贴图、模具和金属材质（场景拆除）。 */
export function disposeGunAssets(): void {
  flashMap?.dispose();
  ballMap?.dispose();
  puffMap?.dispose();
  finePuffMap?.dispose();
  smearMap?.dispose();
  smearGeometry?.dispose();
  flashMap = null;
  ballMap = null;
  puffMap = null;
  finePuffMap = null;
  smearMap = null;
  smearGeometry = null;
  sculpts.clear();
  sculptJobs.clear();
  disposeAmmunition();
}

export interface MuzzleFlashOptions {
  look: GunLook;
  /** 火光宽度（世界单位）——手枪是野战炮的四分之一。 */
  size: number;
  /** 枪管指向，火焰由此倾出膛口。 */
  direction: THREE.Vector3;
  /** 火焰在屏幕上停留的时长。火药只烧一两三帧。 */
  life?: number;
  /** 从场景灯光池借用的槽位，为 null 则无光射击。 */
  light?: SpellLight | null;
}

/**
 * 膛口火光，由四层叠加而成。
 *
 * 过去是两张广告牌从单个精灵淡出，在旧的发光点弹丸旁边
 * 还算清楚，但如今真正的雕塑弹丸以数倍口径的宽度离开
 * 枪管时就远远不够了：弹丸抵达时*比送它出膛的发射药还亮*。
 * 因此：
 *
 * 1. **星形** —— 锯齿花瓣纹理，广告牌化，火焰的剪影。
 * 2. **核心** —— 一小片纯平白色圆盘，以加法混合叠在星形
 *    自身过曝的中心上。加法层是突破不透明度 1 的手段：
 *    它会被截到纯白，因此也是泛光通道唯一真正抓住的部分。
 * 3. **喷流** —— 沿射线方向的火焰锥体，*不做*广告牌化，
 *    让火光沿枪管生长而不是只作为圆盘膨胀。正是它告诉
 *    眼睛弹丸刚刚飞向何方。
 * 4. **前置光晕** —— 保留的旧前置烟团，位于一个枪管宽度之外。
 *
 * 包络与尺寸同等重要。火药在一帧内点燃，因此整个叠加层
 * 在生命周期的前五分之一（`IGNITION`）保持*全*亮度，之后
 * 才衰减——第一帧就开始衰减的火光在 60fps 下根本不会
 * 被察觉。最后一段带有闪烁，因为发射药是不均匀烧尽的，
 * 而不是像旋钮一样线性调暗。
 */
const IGNITION = 0.2;

export async function spawnMuzzleFlash(
  scene: THREE.Object3D,
  tweens: { to: (spec: { duration: number; easing: (t: number) => number; onUpdate: (t: number) => void }) => Promise<void> },
  at: THREE.Vector3,
  options: MuzzleFlashOptions,
): Promise<void> {
  const life = options.life ?? 0.11;
  const size = options.size;
  const group = new THREE.Group();
  group.name = "muzzle_flash";
  group.position.copy(at);
  scene.add(group);

  const star = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sharedFlashMap(),
      color: options.look.flash,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1,
      rotation: Math.random() * Math.PI,
    }),
  );
  star.scale.setScalar(size);
  star.renderOrder = 8;
  star.frustumCulled = false;

  // 星形中心上的纯平白色。刻意做小：它的职责是把核心
  // 打到过曝，而不是把火焰拉宽。
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sharedBallMap(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1,
    }),
  );
  core.scale.setScalar(size * 0.46);
  core.position.copy(options.direction).multiplyScalar(size * 0.08);
  core.renderOrder = 11;
  core.frustumCulled = false;

  // 第二团光晕位于射线前方一个枪管宽度处。
  const lead = new THREE.Sprite((star.material as THREE.SpriteMaterial).clone());
  (lead.material as THREE.SpriteMaterial).color.setHex(options.look.ball);
  lead.position.copy(options.direction).multiplyScalar(size * 0.34);
  lead.scale.setScalar(size * 0.62);
  lead.renderOrder = 9;
  lead.frustumCulled = false;

  // 喷出的发射药本身：一个宽亮端坐在膛口、尖端沿瞄准线
  // 延伸的锥体。拖影锥体建模时尖端朝 -Z，因此把 +Z 映射到
  // 瞄准方向的*反方向*即可让尖端指向弹丸飞去的方向。
  const jet = new THREE.Mesh(
    sharedSmearGeometry(),
    new THREE.MeshBasicMaterial({
      map: sharedSmearMap(),
      color: options.look.flash,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  jet.quaternion.setFromUnitVectors(FORWARD, options.direction.clone().negate());
  jet.scale.set(size * 0.8, size * 0.8, size * 1.5);
  jet.renderOrder = 10;
  jet.frustumCulled = false;

  group.add(star, jet, lead, core);

  const starMaterial = star.material as THREE.SpriteMaterial;
  const leadMaterial = lead.material as THREE.SpriteMaterial;
  const coreMaterial = core.material as THREE.SpriteMaterial;
  const jetMaterial = jet.material as THREE.MeshBasicMaterial;

  try {
    await tweens.to({
      duration: life,
      easing: (t: number) => t,
      onUpdate: (t: number) => {
        // 先全开再消失：亮度的衰减远快于尺寸。
        const burn = t <= IGNITION ? 1 : Math.pow(1 - (t - IGNITION) / (1 - IGNITION), 2.1);
        // 不均匀燃尽——发射药在摇曳熄灭，而不是被旋钮调暗。
        const flicker = 0.82 + 0.18 * Math.abs(Math.sin(t * 47));
        const fade = burn * flicker;
        starMaterial.opacity = fade;
        leadMaterial.opacity = fade * 0.9;
        // 核心最后变宽、最先熄灭，正是这一点让第一帧
        // 读起来像一次爆轰。
        coreMaterial.opacity = Math.pow(burn, 1.6);
        jetMaterial.opacity = fade * 0.85;
        star.scale.setScalar(size * (1 + t * 0.6));
        lead.scale.setScalar(size * (0.62 + t * 0.8));
        core.scale.setScalar(size * (0.46 + t * 0.22));
        // 喷流在消亡时向外*拉长*而不是膨胀：这是外泄的燃气。
        jet.scale.set(size * (0.8 + t * 0.5), size * (0.8 + t * 0.5), size * (1.5 + t * 1.1));
        starMaterial.rotation += 0.12;
        options.light?.set(group.position, fade * 38 * size);
      },
    });
  } finally {
    options.light?.release();
    starMaterial.dispose();
    leadMaterial.dispose();
    coreMaterial.dispose();
    jetMaterial.dispose();
    group.removeFromParent();
    group.clear();
  }
}

/**
 * 一颗飞行中的弹丸。
 *
 * 弹丸本体是真实网格——该种类已拉到雕塑时用雕塑，否则
 * 由 `ammunition.ts` 锻造——其余的一切都是为了让金属在
 * 高速下可辨，而不是让它发光。
 *
 * 按重要性排序，承担视觉辨识的有三样：
 *
 * 1. **拖影。** 弹丸头部的一截模糊金属锥，金属所在处最亮，
 *    几个口径之后消失。它随弹丸一起移动；弹丸飞过的路径
 *    单独绘制（见 {@link TracerStreak}），那才是眼睛真正
 *    追随的东西。
 * 2. **闪光。** 金属上一小片捕捉到火光的广告牌，让弹丸即使
 *    对着大厅昏暗的远墙也能被看见。
 * 3. **余热。** 仅野战炮发射的铁弹：一路飞越一路冷却的暗红
 *    辉光，外加被弹丸拖着走的一团空气。
 *
 * 它位于世界空间，由 {@link flyShot} 每帧放置。
 */
class Shot {
  readonly group = new THREE.Group();
  /** 运动拖影锥，指向飞行线方向。 */
  private readonly smear: THREE.Mesh;
  /** 转动金属上捕捉到的火光。 */
  private readonly glint: THREE.Sprite;
  /** 带着炽热出膛的弹丸金属中残留的热量。 */
  private readonly glow: THREE.Sprite | null;
  /** 沉重弹丸身后拖动的空气。 */
  private readonly wake: THREE.Sprite | null;
  private readonly light: SpellLight | null;
  /** 弹丸本体。 */
  private readonly round: THREE.Object3D;
  /** 辉光需要随弹丸飞越而冷却的材质。 */
  private readonly heated: THREE.MeshStandardMaterial[];
  private readonly spec: AmmoSpec;
  /**
   * 弹丸绕什么轴旋转。线膛子弹绕自身弹头轴自旋；滑膛
   * 弹丸则绕着它离开枪管时恰好带上的任意轴翻滚。
   */
  private readonly axis: THREE.Vector3;
  private readonly spin: number;
  /** 弹丸的渲染直径：口径，放大到可辨的尺寸。 */
  readonly gauge: number;

  constructor(kind: AmmoKind, look: GunLook, size: number, light: SpellLight | null) {
    const spec = AMMUNITION[kind];
    this.spec = spec;
    this.light = light;
    this.group.name = `shot_${kind}`;
    const gauge = size * spec.gauge;
    this.gauge = gauge;
    const sculpt = sculpts.get(kind);
    if (sculpt) {
      this.round = sculpt.clone(true);
      // 雕塑的金属与同类所有弹丸共享，因此需要冷却的弹丸
      // 在动其辉光之前必须先拿到自己的副本。
      this.heated = spec.heat > 0 ? ownMetal(this.round) : [];
    } else {
      const forged = loadRound(kind);
      this.round = forged.object;
      this.heated = forged.heated;
    }
    // 网格弹头到弹底一单位长，因此渲染口径乘以弹丸自身
    // 比例就是它所需的全部缩放。
    this.round.scale.setScalar(gauge * spec.length);
    this.group.add(this.round);

    this.axis = spec.stabilised
      ? FORWARD.clone()
      : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.spin = (Math.random() > 0.5 ? 1 : -1) * spec.twist * (0.85 + Math.random() * 0.3);

    this.smear = new THREE.Mesh(
      sharedSmearGeometry(),
      new THREE.MeshBasicMaterial({
        map: sharedSmearMap(),
        color: spec.streak.color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: spec.streak.opacity,
        side: THREE.DoubleSide,
      }),
    );
    // 头部与弹丸同宽，向后延伸几个口径长。
    this.smear.scale.set(gauge, gauge, gauge * spec.streak.stretch * NOSE_BLUR);
    this.smear.renderOrder = 6;
    this.smear.frustumCulled = false;
    this.group.add(this.smear);

    this.glint = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sharedBallMap(),
        color: spec.streak.color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: spec.glint,
      }),
    );
    this.glint.scale.setScalar(gauge * 1.6);
    this.glint.renderOrder = 7;
    this.glint.frustumCulled = false;
    this.group.add(this.glint);

    if (spec.heat > 0) {
      this.glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: sharedBallMap(),
          color: 0xff7a2e,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: 0.55 * spec.heat,
        }),
      );
      this.glow.scale.setScalar(gauge * 1.7);
      this.glow.renderOrder = 7;
      this.glow.frustumCulled = false;
      this.group.add(this.glow);
    } else {
      this.glow = null;
    }

    if (spec.wake > 0) {
      this.wake = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: sharedPuffMap(),
          color: look.smoke,
          transparent: true,
          depthWrite: false,
          opacity: 0.18,
        }),
      );
      this.wake.scale.setScalar(gauge * spec.wake);
      this.wake.renderOrder = 5;
      this.wake.frustumCulled = false;
      this.group.add(this.wake);
    } else {
      this.wake = null;
    }
  }

  /**
   * @param cooling 出膛瞬间为 1，抵达目标时为 0——
   *   只有铁弹才带得上足以可见的热量。
   */
  place(at: THREE.Vector3, cooling: number): void {
    this.group.position.copy(at);
    const heat = this.spec.heat * (0.4 + cooling * 0.6);
    if (this.glow) {
      (this.glow.material as THREE.SpriteMaterial).opacity = 0.55 * heat;
      this.glow.scale.setScalar(this.gauge * (1.6 + cooling * 0.5));
    }
    for (const material of this.heated) material.emissiveIntensity = 1.15 * heat;
    this.light?.set(at, heat * 5);
  }

  /**
   * 把弹丸指向飞行线并让它在飞行中旋转：米涅弹绕弹头轴
   * 自旋、始终指向发射方向，铸造弹丸则绕自身轴翻滚。
   * 拖影沿同一条线铺设，因此它总是拖在金属之后而不是
   * 跟着相机。
   *
   * @param haste 飞行速度相对基准节奏的倍数，让快弹的
   *   拖影比慢弹更长
   */
  aimAlong(direction: THREE.Vector3, travelled: number, haste: number): void {
    this.round.quaternion.setFromUnitVectors(FORWARD, direction);
    this.round.rotateOnAxis(this.axis, travelled * this.spin);
    this.smear.quaternion.setFromUnitVectors(FORWARD, direction);
    this.smear.scale.z = this.gauge * this.spec.streak.stretch * NOSE_BLUR * haste;
    // 被拖动的空气尾流挂在拖影之后。
    this.wake?.position.copy(direction).multiplyScalar(-this.wake.scale.x * 0.42);
  }

  dispose(): void {
    this.light?.release();
    (this.glint.material as THREE.Material).dispose();
    (this.smear.material as THREE.Material).dispose();
    if (this.glow) (this.glow.material as THREE.Material).dispose();
    if (this.wake) (this.wake.material as THREE.Material).dispose();
    // 只有炽热的弹丸拥有自己的材质；冷铅弹共享缓存的那份。
    for (const material of this.heated) material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

export interface ShotOptions {
  look: GunLook;
  /** 枪管里装的是哪种弹丸。 */
  ammo: AmmoKind;
  /** 膛口直径（世界单位）。 */
  size: number;
  /**
   * 飞行秒数。足够长，让眼睛能捕捉到弹丸并追随它——
   * 真实的膛口初速会让它在两帧内钻进目标身体，这正是
   * 没人能看见这一枪的原因。
   */
  flight: number;
  /** 从场景灯光池借用的槽位，或 null。 */
  light?: SpellLight | null;
  /** 每帧以弹丸位置回调，用于它留下的烟雾。 */
  onTrail?: (at: THREE.Vector3, t: number) => void;
  /**
   * 弹丸身后拖出的轨迹条的脊线采样数。这是画质在轨迹上
   * 唯一的调节旋钮；0 表示不给弹丸加轨迹。
   */
  trailDetail?: number;
}

/**
 * 如今飞行路径已作为几何体绘制（`tracer.ts`），弹丸建模
 * 时的头部拖影保留多少。
 *
 * 锥体的职责已经收窄：它是金属*表面*的模糊，即头部几个
 * 口径长的拉伸高光。按原来的全长，两层会叠在一起，
 * 读起来像一团没有方向的肥污迹。
 */
const NOSE_BLUR = 0.5;

/**
 * 弹丸落地后，把轨迹条交给一段属于它自己的短暂淡出。
 *
 * 在命中那一帧直接删除轨迹条会让它戛然而止，读起来像
 * 故障。让它在一个半帧节拍里慢慢消散，读起来就像某个
 * 高速移动物体的残影，并在碎屑与命中火光之下消逝。
 */
function releaseStreak(
  streak: TracerStreak,
  tweens: { to: (spec: { duration: number; easing: (t: number) => number; onUpdate: (t: number) => void }) => Promise<void> },
  strength: number,
): void {
  void (async () => {
    try {
      await tweens.to({
        duration: 0.16,
        easing: (t: number) => t,
        onUpdate: (t: number) => streak.fade(strength * Math.pow(1 - t, 1.7)),
      });
    } finally {
      streak.dispose();
    }
  })();
}

/**
 * 把一颗弹丸从枪口送向目标身体：笔直线、无弧线、无缓动。
 * 弹丸平飞过一个棋盘的距离，正是这份平直告诉眼睛这是
 * 火枪，而不是抛掷的法术。
 *
 * 唯一*不*走直线的是滑膛弹丸。弹丸在没有膛线的枪管里
 * 哐当作响地滚出去时带着旋转，而旋转的球体会走弧线：
 * 它先鼓出视线之外，再拐回目标身上。这就是火绳枪在
 * 百步之外不可信的原因，而线膛米涅弹是军队中唯一
 * 走真正直线的弹丸。
 */
export async function flyShot(
  scene: THREE.Object3D,
  tweens: { to: (spec: { duration: number; easing: (t: number) => number; onUpdate: (t: number) => void }) => Promise<void> },
  from: THREE.Vector3,
  to: THREE.Vector3,
  options: ShotOptions,
): Promise<void> {
  const spec = AMMUNITION[options.ammo];
  const shot = new Shot(options.ammo, options.look, options.size, options.light ?? null);
  const heading = to.clone().sub(from);
  const distance = Math.max(1e-4, heading.length());
  heading.divideScalar(distance);
  // 弹丸鼓出的平面：横跨射线方向，并略微倾斜，让漂移
  // 永远不是平板的侧向滑动。
  const drift = new THREE.Vector3(0, 1, 0).cross(heading).normalize();
  drift.addScaledVector(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.7).normalize();
  const wander = spec.wander * options.size * (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.8);
  // 相对基准节奏的每秒格数，让快枪管的拖影拉长、慢枪管
  // 的拖影缩短，而不是固定不变的一道痕迹。
  const haste = THREE.MathUtils.clamp(distance / Math.max(0.01, options.flight) / 12, 0.55, 1.9);
  shot.place(from, 1);
  shot.aimAlong(heading, 0, haste);
  scene.add(shot.group);
  // 轨迹条位于世界空间而不是挂在弹丸上：它是路径，所以
  // 必须留在弹丸经过的地方，而不是随弹丸一起移动。
  const rings = options.trailDetail ?? 20;
  const streak = rings > 0 ? new TracerStreak(spec.trail, shot.gauge, rings) : null;
  if (streak) scene.add(streak.object);
  const at = new THREE.Vector3();
  try {
    await tweens.to({
      duration: options.flight,
      easing: (t: number) => t,
      onUpdate: (t: number) => {
        at.lerpVectors(from, to, t);
        // 在飞行中段达到峰值再收拢：弹丸仍会命中目标，
        // 只是不走直线到达。
        if (wander !== 0) at.addScaledVector(drift, wander * Math.sin(Math.PI * t));
        shot.place(at, 1 - t);
        // 弹丸刚出膛时拖影很短，提速后才展开到全长：
        // 弹丸在移动之前没有模糊。
        shot.aimAlong(heading, t * distance, haste * Math.min(1, 0.35 + t * 6));
        streak?.extend(at);
        options.onTrail?.(at, t);
      },
    });
  } finally {
    shot.dispose();
    if (streak) releaseStreak(streak, tweens, spec.trail.strength);
  }
}

export interface PowderCloudOptions {
  look: GunLook;
  /** 烟云的宽度（世界单位）。 */
  size: number;
  /** 烟被推出的方向，即射线方向。 */
  direction: THREE.Vector3;
  /** 组成这团烟的烟团数量。 */
  count: number;
  /** 从点火到最后一缕消散的秒数。 */
  life?: number;
  /**
   * 覆盖阵营色调。线膛枪管的小份紧裹发射药几乎完全
   * 燃烧，因此它的烟团是浅灰色，而不是滑膛齐射的
   * 煤烟色。
   */
  tint?: number;
  /** 烟团的浓厚程度。1 = 火绳枪；低于 1 可以透过它看东西。 */
  density?: number;
  /**
   * 细粒火药：换用更淡、更纤细的贴图，以更短更急促的
   * 节拍喷出、上升更快、更早撕裂消散。
   */
  fine?: boolean;
  /**
   * 大厅自身的空气流动（世界单位/秒）。最终把烟团带离
   * 发射格子的就是它——没有它，烟会停在原地只是变暗，
   * 那永远读不出空气的感觉。
   */
  draft?: THREE.Vector3;
  /**
   * 烟团不再下沉而是沿其铺开的世界高度，即棋盘顶面。
   * 到达它的烟停止下落并向四周摊开。
   */
  floor?: number;
}

/**
 * 烟团的一个分叶，自带完整的历史：何时离开膛口、力度
 * 多大、能活多久，以及存活期间如何翻卷。
 *
 * 每个分叶都从自己的*绝对年龄*做闭式积分，而不是逐帧
 * 步进。这是有意为之：烟团由补间的归一化时钟驱动，
 * 闭式路径是让烟雾在任何帧率下都保持一致的唯一办法，
 * 而且让每个分叶能在同一条共享时间线内按自己的节奏
 * 出生与消亡。
 */
interface PowderPuff {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  /** 分叶生成处相对膛口的偏移。 */
  seat: THREE.Vector3;
  /** 它离开膛口时的速度，在空气阻力削减之前。 */
  jet: THREE.Vector3;
  /** 那股喷射速度被空气吃掉的速度。 */
  drag: number;
  /** 点火后多少秒这个分叶出现。 */
  born: number;
  /** 出现之后能持续多少秒。 */
  span: number;
  /** 出生时的宽度，以及它会膨胀到多少倍。 */
  seed: number;
  swell: number;
  /** 炽热轻气体的向上浮力。 */
  lift: number;
  /** 它一路翻卷的振幅与速率。 */
  churn: THREE.Vector3;
  rate: number;
  phase: number;
  spin: number;
  peak: number;
}

/**
 * 黑火药发射药在枪口前留下的一团悬烟。
 *
 * 旧版本是一小把精灵，全在同一帧出现、匀速直线外滑、
 * 一起变暗——砰的一声，然后什么都没有。发射药真实的
 * 行为有三个截然不同的阶段，这里三个阶段都建了模：
 *
 * 1. **喷出。** 燃气在大约十分之一秒内陆续离开膛口，并非
 *    一次性全出，因此分叶在 `vent` 期间*按序出生*，最早
 *    的一批获得最猛的推力。这让烟团从枪管里长出来，
 *    而不是凭空出现在枪管周围。
 * 2. **失速。** 喷射速度几乎立刻被空气吃掉：每个分叶行进
 *    `jet/drag · (1 − e^⁻ᵈʳᵃᵍ·ᵃᵍᵉ)`，也就是向前冲大约一格
 *    就停下。此后只剩浮力、大厅的气流和它自身的翻卷——
 *    是一朵云，而不是抛射体。
 * 3. **消散。** 质量守恒而体积不守恒：分叶膨胀就必须变薄，
 *    因此不透明度在淡出之上再乘以 `(seed/width)^1.35`。
 *    烟雾变淡*正是因为它在扩散*，这就是它从一团实白变成
 *    能透过它看清棋盘的薄雾的原因。
 */
export async function spawnPowderCloud(
  scene: THREE.Object3D,
  tweens: { to: (spec: { duration: number; easing: (t: number) => number; onUpdate: (t: number) => void }) => Promise<void> },
  at: THREE.Vector3,
  options: PowderCloudOptions,
): Promise<void> {
  const life = options.life ?? 1.5;
  const fine = options.fine === true;
  const tint = options.tint ?? options.look.smoke;
  const density = options.density ?? 1;
  const size = options.size;
  const group = new THREE.Group();
  group.name = "powder_cloud";
  group.position.copy(at);
  scene.add(group);

  // 燃气持续从膛口冒出的时长。紧裹的线膛枪发射药烧完的
  // 时间只有火绳枪散装药喷完所需时间的一半。
  const vent = Math.min(life * 0.4, fine ? 0.1 : 0.17);
  // 棋盘以下都在石头里，所以沉到那么低的烟团会贴着
  // 它摊平。
  const floor = options.floor != null ? options.floor - at.y : null;
  const side = new THREE.Vector3(0, 1, 0).cross(options.direction).normalize();
  const up = new THREE.Vector3(0, 1, 0);

  const puffs: PowderPuff[] = [];
  for (let i = 0; i < options.count; i += 1) {
    // 这个分叶在喷出序列中的位置：0 是最先出膛的燃气。
    const order = options.count <= 1 ? 0 : i / (options.count - 1);
    const material = new THREE.SpriteMaterial({
      map: fine ? sharedFinePuffMap() : sharedPuffMap(),
      color: tint,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      rotation: Math.random() * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 5;
    sprite.frustumCulled = false;
    sprite.visible = false;
    group.add(sprite);

    // 后出的燃气更冷更慢：刚勉强冲出枪口就留下来绕着
    // 枪口打转，这正是挂在枪管上的那部分烟。
    const push = 1 - order * 0.62;
    const seed = size * (fine ? 0.16 + Math.random() * 0.2 : 0.22 + Math.random() * 0.28);
    puffs.push({
      sprite,
      material,
      seat: options.direction
        .clone()
        .multiplyScalar(size * order * (fine ? 0.16 : 0.22))
        .addScaledVector(side, (Math.random() - 0.5) * size * 0.22)
        .addScaledVector(up, (Math.random() - 0.5) * size * 0.2),
      jet: options.direction
        .clone()
        .multiplyScalar(size * (fine ? 5.4 : 4.1) * push * (0.7 + Math.random() * 0.6))
        // 从弹丸周围泄出的燃气从不直行：它从膛口呈扇形散开。
        .addScaledVector(side, (Math.random() - 0.5) * size * (fine ? 1.5 : 2.6))
        .addScaledVector(up, (Math.random() - 0.35) * size * (fine ? 1.9 : 1.5)),
      // 纤细的喷流比粗重煤烟的喷流更快被空气拦停。
      drag: (fine ? 5.4 : 4.2) * (0.8 + Math.random() * 0.5),
      born: vent * order * (0.55 + Math.random() * 0.9),
      // 小分叶最先被撕裂；总有少数活得比其它的久，因此
      // 烟团绝不会在同一帧整体消失。
      span: life * (0.5 + Math.random() * 0.5) * (Math.random() < 0.18 ? 1.25 : 1),
      seed,
      swell: fine ? 3.4 + Math.random() * 1.8 : 2.6 + Math.random() * 1.5,
      lift: size * (fine ? 0.34 + Math.random() * 0.3 : 0.15 + Math.random() * 0.22),
      churn: new THREE.Vector3(
        (Math.random() - 0.5) * size * 0.5,
        (Math.random() - 0.5) * size * 0.3,
        (Math.random() - 0.5) * size * 0.5,
      ),
      rate: 1.1 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * (fine ? 1.5 : 1),
      peak: (fine ? 0.34 : 0.56) * density * (0.7 + Math.random() * 0.6),
    });
  }

  const place = new THREE.Vector3();
  try {
    await tweens.to({
      duration: life,
      easing: (t: number) => t,
      onUpdate: (t: number) => {
        const now = t * life;
        for (const puff of puffs) {
          const age = now - puff.born;
          if (age <= 0 || age >= puff.span) {
            puff.sprite.visible = false;
            continue;
          }
          puff.sprite.visible = true;
          const u = age / puff.span;

          // 先猛冲再失速：喷射速度几帧内耗尽，剩下的是
          // 一朵悬在空中被推动的云。
          const carried = (1 - Math.exp(-puff.drag * age)) / puff.drag;
          place.copy(puff.seat).addScaledVector(puff.jet, carried);
          // 浮力是逐渐积累的而不是初始的一脚：火药烟先
          // 从枪管下垂，之后才开始爬升。
          place.y += puff.lift * age * age * 0.75;
          if (options.draft) place.addScaledVector(options.draft, age);
          // 湍流翻卷——分叶自身滚转而不是平移滑动。
          const swirl = Math.min(1, age / 0.4);
          place.addScaledVector(puff.churn, Math.sin(age * puff.rate + puff.phase) * swirl);
          if (floor != null && place.y < floor) place.y = floor;
          puff.sprite.position.copy(place);

          // 卷吸效应：气体尚热时快速膨胀，随后放缓。
          const width = puff.seed * (1 + (puff.swell - 1) * Math.pow(u, 0.55));
          puff.sprite.scale.setScalar(width);
          // 扩散带来的变薄（质量除以体积），上面再叠一条柔和
          // 的尾部衰减，让最后的烟散进大厅而不是被直接关掉。
          const bloom = Math.min(1, age / (fine ? 0.05 : 0.07));
          const thinning = Math.pow(puff.seed / width, 1.35);
          puff.material.opacity = puff.peak * bloom * thinning * Math.pow(1 - u, 0.85);
          // 角阻力：分叶失去能量时翻卷减慢。
          puff.material.rotation += puff.spin * 0.016 * (1 - u * 0.7);
        }
      },
    });
  } finally {
    for (const puff of puffs) puff.material.dispose();
    group.removeFromParent();
    group.clear();
  }
}
