/**
 * 大军团的弹药库：每根枪炮管配一种弹丸，锻出来的，不是糊弄出来的。
 *
 * 棋盘上每一门火器过去都发射同一种发光圆点，而这恰恰是黑火药从未做过的
 * 事——1805 年的炮管里喷出来的东西没有一种是曳光弹。真正飞出那些膛口的
 * 是冷灰的铅或炽黑的铁，这里的四种弹丸每一种都按各自的时代图纸打造：
 *
 * - **pistol ball**（手枪弹）——军官燧发枪射出的小型铸造铅球，
 *   上面还带着模具合缝线和水口疤痕。
 * - **musket ball**（滑膛枪弹）——线列步兵的 .69 口径铅弹：更大、更软、
 *   被通条磕出凹痕，而且没有稳定自旋，所以飞行途中会飘移。
 * - **Minié bullet**（米涅弹）——神射手的线膛弹：带三条油脂槽和空底的
 *   锥形弹头，被膛线旋起来，飞得极稳。
 * - **round shot**（实心炮弹）——炮兵连的实心铁球：砂模铸出的麻点、
 *   出膛时还带着红热，重到足以穿过人体继续向前。
 *
 * 每种弹丸都按同一份契约制作，一次射击只需缩放它即可：**弹头朝向 +Z、
 * 以自身中点为中心、从弹头到弹底恰好一个世界单位。** 几何体与材质按种类
 * 缓存、按射击克隆；只有携带热量的弹丸才拥有自己的材质，好让它在飞行中
 * 冷却。
 */

import * as THREE from "three";

import type { StreakLook } from "./tracer";

/** 一根枪炮管里装的是哪种弹丸。 */
export type AmmoKind = "pistolBall" | "musketBall" | "minieBullet" | "roundShot";

/** 一种弹丸出膛之后的行为方式。 */
export interface AmmoSpec {
  /** 时代名称，留个记录。 */
  label: string;
  /**
   * 弹头到弹底的长度，以膛径的倍数表示。铸造铅球为 1（它是个球体）；
   * 米涅弹的长度接近宽度的两倍。
   */
  length: number;
  /**
   * 弹丸画得比实物大多少，以膛径的倍数表示。
   *
   * 一颗 .69 铅弹是一个人身高的五十分之一：在这么大的棋盘上按真实比例
   * 渲染只有一两个像素，一次射击*根本看不见*。这是弹药库里唯一一处刻意
   * 的谎言——弹丸按可读的规格绘制（放在人形旁边仍远小于一个拳头），而
   * 它的飞行路径、飘移和自旋都按真实数字走。
   */
  gauge: number;
  /**
   * 膛线效果。有稳定自旋的弹丸绕自身弹头轴线旋转、始终指向它被射出的
   * 方向；滑膛枪射出的圆球则带着出膛时碰巧获得的任意轴翻滚。
   */
  stabilised: boolean;
  /** 旋转速率，弧度/每前进一个世界单位。 */
  twist: number;
  /**
   * 弹丸在飞行中段偏离视线的距离，以膛径计。这就是滑膛枪在一百步外
   * 打不中一个人的全部原因，也是这里唯一完全没有飘移的是线膛弹的原因。
   */
  wander: number;
  /**
   * 弹丸离开枪口时仍携带的热量。铅弹能被看见时已经冷了；6 磅炮的
   * 实心弹出膛时带着暗红色，飞越整个大厅的过程中逐渐冷却。
   */
  heat: number;
  /**
   * *金属本身*的运动拖影：颜色、强度，以及以渲染弹径计的长度。这是模糊
   * 而不是火焰——没有任何时代弹丸是曳光弹，所以铅弹的拖影是灰色的，
   * 只有热膛中射出的铁弹才带暖色。它随弹丸一起移动；飞行轨迹由
   * {@link trail} 承担。
   */
  streak: { color: number; opacity: number; stretch: number };
  /**
   * 沿弹丸实际飞行路径留下的短拖尾——正是它让眼睛能追随一次射击从膛口
   * 到目标，而不只是看到它抵达。在 `tracer.ts` 中以真实几何体构建，所以
   * 滑膛铅球鼓出视线时它会跟着弯曲。
   */
  trail: StreakLook;
  /**
   * 弹丸转动时金属上捕捉到的火把一个反光，以纯白光的分数表示。没有它，
   * 冷铅穿过昏暗大厅时看上去就是什么都没有。
   */
  glint: number;
  /** 沉重弹丸身后拖动的空气尾流，以膛径计。小型火器为 0。 */
  wake: number;
  /**
   * 弹丸击碎目标的猛烈程度，以滑膛枪弹的倍数表示。驱动远端的碎屑场——
   * 火花雨、飞溅的碎片数量和冲击环的大小。这是质量乘以速度，不是
   * 表演：手枪弹不足 1，6 磅炮弹远超 2。
   */
  shatter: number;
  /**
   * 弹丸是否穿透身体而不是留在里面。黑火药初速下的软铅会拍扁并停下；
   * 旋转的锥形弹头与实心铁弹都会从另一侧穿出，这正是人体远侧和近侧
   * 都会溅出碎屑的原因。
   */
  through: boolean;
}

/**
 * 四种弹丸，按重量排序。注意小型火器带的光多么少：铅是靠形状和它的
 * 运动拖影被读出来的，而不是靠光。
 */
export const AMMUNITION: Record<AmmoKind, AmmoSpec> = {
  // .58 铸造铅弹，出自军官的燧发枪。轻、快、几乎看不见。
  pistolBall: {
    label: "cast lead pistol ball",
    length: 1,
    gauge: 2.5,
    stabilised: false,
    twist: 5,
    wander: 0.9,
    heat: 0,
    streak: { color: 0xc9ced6, opacity: 0.34, stretch: 7 },
    // 棋盘上最轻的弹丸留下的痕迹也最少：只有半格宽的一缕稀薄的冷空气。
    trail: { span: 5, width: 0.6, color: 0xb7c0cb, core: 0xe9eff7, strength: 0.3 },
    glint: 0.4,
    wake: 0,
    shatter: 0.72,
    through: false,
  },
  // .69 Charleville 铅弹。线列步兵携带的最重之物，也是棋盘上最不
  // 准的弹丸。
  musketBall: {
    label: ".69 Charleville musket ball",
    length: 1,
    gauge: 2.3,
    stabilised: false,
    twist: 4,
    wander: 1.6,
    heat: 0,
    streak: { color: 0xc2c7ce, opacity: 0.4, stretch: 8.5 },
    // 又胖又灰、明显可见的弯曲弹道：正是这颗弹丸的飘移值得让拖尾
    // 用上几何体。
    trail: { span: 5.6, width: 0.74, color: 0xb2bac5, core: 0xe6edf5, strength: 0.36 },
    glint: 0.42,
    wake: 0,
    // 棋盘上最粗的小型火器弹丸，而且软到足以留在体内。
    shatter: 1,
    through: false,
  },
  // 线膛弹：锥形、高速旋转，也是唯一一颗指哪打哪的弹丸。
  minieBullet: {
    label: "Minié bullet",
    length: 1.9,
    gauge: 2.6,
    stabilised: true,
    // 绕自身弹头旋转，所以是油脂槽在闪烁而不是整颗弹丸在翻滚——
    // 这正是线膛枪管的标志。
    twist: 22,
    wander: 0,
    heat: 0,
    streak: { color: 0xdde1e7, opacity: 0.46, stretch: 11 },
    // 全军最长、最细、也是唯一笔直的拖尾：一颗线膛弹在大厅里
    // 拉出一根铁丝。
    trail: { span: 9, width: 0.48, color: 0xccd6e2, core: 0xf4f8ff, strength: 0.42 },
    glint: 0.5,
    wake: 0,
    // 比滑膛枪弹轻，但抵达时快得多且仍在旋转。
    shatter: 1.24,
    through: true,
  },
  // 实心铁弹，出自 6 磅炮。慢到可以目送，热到可以看见。
  roundShot: {
    label: "6-pounder round shot",
    length: 1,
    // 已经是棋盘上发射的最大东西：它需要的放大帮助最少。
    gauge: 1.7,
    stabilised: false,
    twist: 2.4,
    wander: 0.35,
    heat: 1,
    streak: { color: 0xff9a52, opacity: 0.52, stretch: 6 },
    // 短、宽、热——还带着膛内红热的铁球拖在身后的是一片灼热空气，
    // 而不是一根细丝。
    trail: { span: 4.2, width: 1, color: 0xff7f36, core: 0xffd9a4, strength: 0.5 },
    glint: 0.3,
    wake: 2.4,
    // 六磅铁。棋盘上没有任何东西挡得住它，而它穿过去之后还在飞。
    shatter: 2.5,
    through: true,
  },
};

// ------------------------------------------------------------------ 金属

let leadMaterial: THREE.MeshStandardMaterial | null = null;
let ironMaterial: THREE.MeshStandardMaterial | null = null;
const geometries: THREE.BufferGeometry[] = [];

/**
 * 未抛光的铸造铅：本身几乎没有颜色、在火把下发暗，但刻意不拉满金属度。
 * 一颗只有几个像素的镜面金属球在昏暗大厅里没有什么可反射的，会渲染成
 * 一个黑点；更粗糙、更亮的铅能接住火把的光，飞越大厅时始终可见。
 */
function lead(): THREE.MeshStandardMaterial {
  if (!leadMaterial) {
    leadMaterial = new THREE.MeshStandardMaterial({
      color: 0xb4bac2,
      metalness: 0.62,
      roughness: 0.44,
      // 永远不全黑，哪怕所有火把都在它身后。
      emissive: new THREE.Color(0x2c3138),
      emissiveIntensity: 1,
    });
    leadMaterial.envMapIntensity = 1.3;
  }
  return leadMaterial;
}

/** 砂铸铁：近黑、哑光，也是唯一会发光的弹丸。 */
function iron(): THREE.MeshStandardMaterial {
  if (!ironMaterial) {
    ironMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b3936,
      metalness: 0.68,
      roughness: 0.72,
      emissive: new THREE.Color(0xff5a1e),
      emissiveIntensity: 0,
    });
    ironMaterial.envMapIntensity = 1;
  }
  return ironMaterial;
}

function track<T extends THREE.BufferGeometry>(geometry: T): T {
  geometries.push(geometry);
  return geometry;
}

// ------------------------------------------------------------------ 铸造

/** 廉价而稳定的哈希——模具痕迹必须每次都一样。 */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 0.5) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 两半模具铸出的铅球：不太圆，两半模具合拢处有一条凸起的合缝线，
 * 还有从浇口上剪下来时留下的水口残茬。
 *
 * @param dents 表面偏离正球体的程度（软铅球上通条和纸壳弹造成的磨损）
 */
function castBall(dents: number): THREE.BufferGeometry[] {
  const ball = track(new THREE.SphereGeometry(0.5, 20, 14));
  const position = ball.getAttribute("position") as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    // 柔和的低频形变：铅是被压瘪的，不是被磕碎的。
    const wobble = 1 + (hash(i * 3.7) - 0.5) * dents;
    vertex.multiplyScalar(wobble);
    position.setXYZ(i, vertex.x, vertex.y * 0.985, vertex.z);
  }
  ball.computeVertexNormals();
  // 模具合缝线，比表面高出头发丝的一点。
  const seam = track(new THREE.TorusGeometry(0.495, 0.013, 5, 26));
  // 水口疤痕：剪得齐平，所以是个残茬而不是尖刺。
  const sprue = track(new THREE.CylinderGeometry(0.07, 0.085, 0.05, 8));
  sprue.translate(0, 0.5, 0);
  return [ball, seam, sprue];
}

/**
 * 米涅弹的剖面，在车床上车出，正如它当年被压制的那样：长长的弧形弹头、
 * 被三条油脂槽切开的承重弹体（槽里装的是软化火药残渣的牛油），以及
 * 空心弹底——发射药把它的裙边吹进膛线里。
 */
function minieProfile(): THREE.BufferGeometry {
  const halfWidth = 0.263;
  const groove = halfWidth - 0.036;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(halfWidth - 0.03, 0.0),
    // 裙边：薄壁、略外撇，是空心弹底的标志。
    new THREE.Vector2(halfWidth, 0.028),
    new THREE.Vector2(halfWidth, 0.15),
    new THREE.Vector2(groove, 0.181),
    new THREE.Vector2(halfWidth, 0.212),
    new THREE.Vector2(halfWidth, 0.3),
    new THREE.Vector2(groove, 0.331),
    new THREE.Vector2(halfWidth, 0.362),
    new THREE.Vector2(halfWidth, 0.45),
    new THREE.Vector2(groove, 0.481),
    new THREE.Vector2(halfWidth, 0.512),
    // 承重面一路到肩部，然后是弧形弹头。
    new THREE.Vector2(halfWidth - 0.004, 0.6),
    new THREE.Vector2(halfWidth - 0.014, 0.68),
    new THREE.Vector2(halfWidth - 0.036, 0.76),
    new THREE.Vector2(halfWidth - 0.072, 0.84),
    new THREE.Vector2(halfWidth - 0.122, 0.91),
    new THREE.Vector2(halfWidth - 0.19, 0.966),
    new THREE.Vector2(0.0, 1.0),
  ];
  const bullet = track(new THREE.LatheGeometry(points, 22));
  // 制作时弹底到弹头沿 +Y；契约要求弹头沿 +Z、居中。
  bullet.translate(0, -0.5, 0);
  bullet.rotateX(Math.PI / 2);
  bullet.computeVertexNormals();
  return bullet;
}

/**
 * 砂模铸出的实心弹：通体麻点，腰部还留着铸造合缝线。正是这些麻点让它
 * 读起来是铁，而不是一颗光滑的游戏引擎球体。
 */
function solidShot(): THREE.BufferGeometry[] {
  const shot = track(new THREE.IcosahedronGeometry(0.5, 3));
  const position = shot.getAttribute("position") as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const pit = hash(i * 5.13);
    // 大部分表面只是不平整；每六个顶点里有一个是真正的凹坑。
    const depth = pit > 0.84 ? 0.052 * (pit - 0.84) / 0.16 : 0;
    vertex.multiplyScalar(1 - depth + (hash(i * 2.91) - 0.5) * 0.018);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  shot.computeVertexNormals();
  const seam = track(new THREE.TorusGeometry(0.492, 0.011, 5, 30));
  return [shot, seam];
}

interface Forged {
  geometries: THREE.BufferGeometry[];
  material: THREE.MeshStandardMaterial;
}

const forges: Partial<Record<AmmoKind, Forged>> = {};

function forge(kind: AmmoKind): Forged {
  const existing = forges[kind];
  if (existing) return existing;
  let made: Forged;
  switch (kind) {
    case "pistolBall":
      made = { geometries: castBall(0.028), material: lead() };
      break;
    case "musketBall":
      // 软铅球被塞进一根积满残渣的枪管，一路磕碰。
      made = { geometries: castBall(0.05), material: lead() };
      break;
    case "minieBullet":
      made = { geometries: [minieProfile()], material: lead() };
      break;
    case "roundShot":
      made = { geometries: solidShot(), material: iron() };
      break;
  }
  forges[kind] = made;
  return made;
}

/** 为一次射击构建的一颗弹丸，外加它身上还带着热的部分。 */
export interface Round {
  object: THREE.Object3D;
  /** 辉光需要在飞行中冷却的材质；冷铅弹为空。 */
  heated: THREE.MeshStandardMaterial[];
}

/**
 * 构建一颗指定种类的弹丸，规范化为弹头沿 +Z、一个单位长，随时可按
 * 火炮口径缩放。携带热量的弹丸会克隆一份自己的材质，好让它的辉光
 * 可以淡出而不影响空中的其他弹丸。
 */
export function loadRound(kind: AmmoKind): Round {
  const spec = AMMUNITION[kind];
  const { geometries: parts, material } = forge(kind);
  const hot = spec.heat > 0;
  const shared = hot ? (material.clone() as THREE.MeshStandardMaterial) : material;
  const group = new THREE.Group();
  group.name = `round_${kind}`;
  for (const geometry of parts) {
    const mesh = new THREE.Mesh(geometry, shared);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // 一颗十分之一秒内穿过画面的弹丸，绝不能被落后一帧的包围球剔除。
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return { object: group, heated: hot ? [shared] : [] };
}

/** 释放共享的金属与模具（场景拆除时调用）。 */
export function disposeAmmunition(): void {
  for (const geometry of geometries) geometry.dispose();
  geometries.length = 0;
  leadMaterial?.dispose();
  ironMaterial?.dispose();
  leadMaterial = null;
  ironMaterial = null;
  for (const kind of Object.keys(forges) as AmmoKind[]) delete forges[kind];
}
