import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

import {
  ARMY_SKINS,
  DEFAULT_ARMY_SKINS,
  PIECE_MODEL_ORIENTATION,
  type ArmySkin,
  type ArmySkinId,
  type ArsenalId,
  type PieceAnimationSet,
} from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";
import { loadGltf } from "./gltfQueue";
import { BADGE_LIFT, BADGE_SCALE, TOKEN_SCALE, rankBadgeTexture, tacticalTokenTexture } from "./rankBadges";
import { factionRingTexture, radialTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";
import { armSculptWarmJobs, attachWeapons, type AttachedArms } from "./weapons";

/**
 * 各棋子的渲染高度（世界单位，1 单位 = 1 格棋盘）。
 *
 * 在镜头距离上只有两个层级能被分辨出来：王冠派出的士卒，以及王冠
 * 本身。因此三个军官阶位站在王后身旁的王室梯队里——骑士、法师和塔楼
 * 守卫是勇士而非普通士卒，若仍保持旧的 0.84-0.88 高度，它们与步卒的
 * 0.7 过于接近，会被误认作步卒。唯有国王依然凌驾于一切之上。
 *
 * 士卒的高度取 0.78 而非 0.7：棋盘上三十二枚棋子中有十六枚是步卒，
 * 大厅的主体就是它们；在 0.7 时一个人形只有其所占地砖约三分之二高，
 * 读起来更像摆在格子上的筹码，而不是驻守格子的士兵。0.78 与军官梯队
 * 之间仍留有约五分之一格的空隙，正是这道缝隙让两个层级得以区分。
 */
export const PIECE_HEIGHT: Record<PieceKind, number> = {
  p: 0.78,
  n: 0.98,
  b: 1.0,
  r: 0.99,
  q: 1.0,
  k: 1.12,
};

export const FACTION_ACCENT: Record<Faction, number> = {
  w: 0x6ea8ff,
  b: 0xff5a4a,
};

/**
 * 每一枚棋子都携带的两个身份信号，无论它穿的是哪支军队的装束。
 *
 * 仅靠皮肤无法回答"那是谁的？"：当双方征募同一支军队时造型完全相同，
 * 而当双方征募*不同*军队时，各自又保留自己的彩绘纹理（见
 * {@link applyFactionLook}）——于是在镜头距离上、火把照亮的大厅里，
 * 三十二个深色身影会读作同一片人群。因此阵营要用两条失效方式不同的
 * 通道声明两次：
 *
 *  - `ring`——涂在棋子所占地砖上的色环，既有军队的颜色*又有自己的
 *    形状*（见 {@link factionRingTexture}），即使色盲玩家也能区分。
 *  - `rim`——沿着轮廓边缘的一圈光，让棋子能与身后的棋子以及地面
 *    区分开，而不只是与脚下区分开。
 */
const FACTION_RING: Record<Faction, number> = {
  w: 0x5fb0ff,
  b: 0xff5230,
};

/** 地砖色环的形状——信号中不依赖颜色的那一半。 */
const FACTION_RING_SHAPE: Record<Faction, "band" | "sunburst"> = {
  w: "band",
  b: "sunburst",
};

/** 沿轮廓的边缘光，使用军队的颜色。 */
const FACTION_RIM: Record<Faction, number> = {
  w: 0x74baff,
  b: 0xff6134,
};

/**
 * 地砖色环的静置不透明度。从站立的视角一眼就能读到即可，不要把格子
 * 照得像标记物一样——选中和将军警报仍要在它之上留有余量
 * （见 {@link PieceView.update}）。
 *
 * 刻意低于一半：色环位于棋子*下方*，它每增加一点不透明度，都会有队伍
 * 颜色溢到靴子和衣摆上。色环的形状（见 {@link factionRingTexture}）承载
 * 信号；亮度只需让那个形状可见即可。
 */
const RING_REST = 0.3;

/**
 * 边缘光贴合轮廓的强度，以及它与边缘贴合的紧密度
 * （即菲涅尔指数，见 {@link installDissolve}）。
 *
 * 这两个数值相互取舍，而"紧而淡"的一端才是正确的选择：一圈又宽又强的
 * 边缘光不是给制服描边，而是在*重涂*制服——这项是叠加到着色后的颜色
 * 之上的，指数低时它会深入轮廓内部，把辫饰、襟章和火枪构件都淹没在
 * 一片平色里。高指数把它限制在轮廓处掠射的几度之内，而那才是唯一需要
 * 让棋子与身后棋子区分开的部分，于是强度可以降到极轻却依然可读。
 * 模型本身的涂装始终是你注视的主体。
 */
const RIM_STRENGTH = 0.26;
const RIM_FALLOFF = 4.6;

/** 沿消融边缘燃烧的光——每个文明一种色调。 */
const DISSOLVE_EMBER: Record<Faction, number> = {
  w: 0xa8ccff,
  b: 0xff7a32,
};

/**
 * 驱动单枚棋子的烧蚀消散与阵营边缘光的共享 uniform 块——
 * 覆盖其所有材质，身体与武器通用。
 */
interface DissolveUniforms {
  uDissolve: { value: number };
  uDissolveEdge: { value: number };
  uDissolveScale: { value: number };
  /** （足底线高度、棋子高度），以模型自身的单位表示。 */
  uDissolveSpan: { value: THREE.Vector2 };
  uDissolveEmber: { value: THREE.Color };
  /** 阵营边缘光，线性空间（在色调映射之后叠加）。 */
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
}

/** 廉价的三线性值噪声——两个倍频程足以表现燃烧边缘。 */
const DISSOLVE_NOISE = `
float dvHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}
float dvNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = dvHash(i);
  float n100 = dvHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = dvHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = dvHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = dvHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = dvHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = dvHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = dvHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
`;

/**
 * 向一个受光照的材质注入两样东西：噪声烧蚀消散，以及阵营边缘光。
 *
 * 烧蚀通过一个带炽热边缘的漂移噪声场侵蚀表面，倒下的棋子会化作碎屑
 * 散入空气，而不是凭空闪烁消失。
 *
 * 边缘光是一项在 `opaque_fragment` *之后*叠加的菲涅尔项——那里着色颜色
 * 刚刚写入、色调映射尚未执行——因此边缘光会与画面其余部分一起被调色，
 * 而不是像一层平贴花一样浮在最上方。正是它让一支军队的轮廓在任意镜头
 * 高度下、在火把照亮的大厅里，都能与身后的棋子区分开来。
 *
 * @param heightBias 烧蚀从足底向上扫过的程度（0 = 均匀）
 */
function installDissolve(
  material: THREE.MeshStandardMaterial,
  uniforms: DissolveUniforms,
  heightBias: number,
): void {
  const bias = heightBias.toFixed(3);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vDissolveP;\nvarying vec3 vRimView;",
      )
      .replace(
        "#include <project_vertex>",
        `vDissolveP = transformed;
vRimView = -(modelViewMatrix * vec4(transformed, 1.0)).xyz;
#include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uDissolve;
uniform float uDissolveEdge;
uniform float uDissolveScale;
uniform vec2 uDissolveSpan;
uniform vec3 uDissolveEmber;
uniform vec3 uRimColor;
uniform float uRimStrength;
varying vec3 vDissolveP;
varying vec3 vRimView;
${DISSOLVE_NOISE}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
float dvGlow = 0.0;
if (uDissolve > 0.001) {
  vec3 dvP = vDissolveP * uDissolveScale;
  float dvN = dvNoise(dvP) * 0.65 + dvNoise(dvP * 2.7 + 11.3) * 0.35;
  float dvH = clamp((vDissolveP.y - uDissolveSpan.x) / max(uDissolveSpan.y, 0.0001), 0.0, 1.0);
  float dvMask = mix(dvN, dvN * 0.45 + dvH * 0.55, ${bias});
  float dvCut = mix(-uDissolveEdge, 1.0 + uDissolveEdge, uDissolve);
  if (dvMask < dvCut) discard;
  dvGlow = (1.0 - smoothstep(0.0, uDissolveEdge * 1.6, dvMask - dvCut)) *
           smoothstep(0.0, 0.06, uDissolve);
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float rimFacing = 1.0 - clamp(dot(normalize(normal), normalize(vRimView)), 0.0, 1.0);
float rimAmount = pow(rimFacing, ${RIM_FALLOFF.toFixed(1)}) * uRimStrength * (1.0 - uDissolve);
#include <opaque_fragment>
gl_FragColor.rgb += uRimColor * rimAmount;
gl_FragColor.rgb += uDissolveEmber * dvGlow * 3.2;`,
      );
  };
  // 参数相同但注入源码不同的两个材质，否则会共享同一份编译好的程序。
  material.customProgramCacheKey = () => `dissolve-${bias}`;
  material.needsUpdate = true;
}

const AXIS_VECTORS = {
  positiveX: new THREE.Vector3(1, 0, 0),
  negativeX: new THREE.Vector3(-1, 0, 0),
  positiveY: new THREE.Vector3(0, 1, 0),
  negativeY: new THREE.Vector3(0, -1, 0),
  positiveZ: new THREE.Vector3(0, 0, 1),
  negativeZ: new THREE.Vector3(0, 0, -1),
} as const;

type AxisName = keyof typeof AXIS_VECTORS;

function basisQuaternion(front: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const f = front.clone().normalize();
  const r = new THREE.Vector3().crossVectors(up, f).normalize();
  const u = new THREE.Vector3().crossVectors(f, r).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
}

/**
 * 旋转生成的模型，使其分类得到的本地前向轴指向
 * `desiredWorldForward`，同时本地向上轴保持与世界向上对齐。
 */
function orientationCorrection(desiredWorldForward: THREE.Vector3): THREE.Quaternion {
  const local = basisQuaternion(
    AXIS_VECTORS[PIECE_MODEL_ORIENTATION.localFrontAxis as AxisName],
    AXIS_VECTORS[PIECE_MODEL_ORIENTATION.localUpAxis as AxisName],
  );
  const world = basisQuaternion(desiredWorldForward, new THREE.Vector3(0, 1, 0));
  return world.multiply(local.invert());
}

/** 实际渲染的包围盒，感知蒙皮（见 three.js 资产指南）。 */
function measureModel(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  const rootInverse = object.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const childBox = new THREE.Box3();
  const toRoot = new THREE.Matrix4();
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const skinned = node as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.skeleton.update();
      skinned.computeBoundingBox();
      childBox.copy(skinned.boundingBox ?? new THREE.Box3());
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      childBox.copy(mesh.geometry.boundingBox ?? new THREE.Box3());
    }
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    box.union(childBox.applyMatrix4(toRoot));
  });
  return box;
}

/** 棋子可播放的骨骼动画剪辑，全部绑定到同一个自动骨架上。 */
export interface PieceClips {
  idle?: THREE.AnimationClip;
  attack?: THREE.AnimationClip;
  death?: THREE.AnimationClip;
  /** 循环的原地踏步，用于徒步走过棋盘。 */
  walk?: THREE.AnimationClip;
  /** 循环的原地奔跑——骑士在跃起冲锋时使用。 */
  run?: THREE.AnimationClip;
  /**
   * 开火后播放的一次性操练动作。只有火药军队携带它——
   * 持剑者没有东西需要装填。
   */
  reload?: THREE.AnimationClip;
  /**
   * 循环的瞄准姿态：枪管抬起并平指目标，在射手稳定身形期间保持。
   * 只有火药军队携带它——正是它让一次射击读作瞄准后的开火，而不是
   * 从站姿里凭空冒出的一道火光。
   */
  aim?: THREE.AnimationClip;
  /**
   * 单膝与双脚之间的一次性姿态切换。按跪姿到站姿制作，并双向播放：
   * 正向用于从膝上起身，反向用于跪落到膝上（见 {@link PieceView.playKneel}
   * 与 {@link PieceView.playRise}）。只有以跪姿作战的角色才有此剪辑。
   */
  rise?: THREE.AnimationClip;
}

export type ClipName = keyof PieceClips;

/**
 * 一副骨架能携带的全部剪辑，按游戏需要的顺序排列。步伐紧跟在
 * 站姿之后：任何游戏要做的第一件事就是*移动*棋子，而尚未加载到位的
 * 步伐会让这次移动失去双腿。攻击与死亡排在后面，因为吃子会按名字
 * 点名索取它们之后才播放（见 {@link PieceFactory.ensureClip}），所以
 * 它们绝不会缺席——而步伐在此前却可能缺席。
 */
export const CLIP_ORDER: ClipName[] = ["idle", "walk", "run", "attack", "death", "reload", "aim", "rise"];

/**
 * 起身剪辑中人物真正在起身的部分所占比例。
 *
 * 在火枪手那条剪辑的髋部上实测得到：它以跪姿在 48 单位高处开始，
 * 到 70% 处已站至全高（92），此后保持不动。若完整播放或倒放整条
 * 2.6 秒的剪辑，会把三分之一的节拍浪费在一个已经停住的角色上——
 * 因此两个方向都只跑这一区间，静止的尾段永不展示。
 */
const RISE_SPAN = 0.72;

/**
 * 与骨架本身一同获取的剪辑。其余剪辑都在之后按需拉取
 * （见 {@link PieceFactory.warmClips}），以免开局一次性发出七十个
 * 请求——正是那样的突发请求过去会让棋子丢失攻击动画。
 */
const OPENING_CLIPS: ClipName[] = ["idle"];

/** 两个移动循环剪辑，与站姿和一次性动作相对。 */
export type MarchClip = "walk" | "run";

interface Template {
  scene: THREE.Object3D;
  scale: number;
  offset: THREE.Vector3;
  skinned: boolean;
  clips: PieceClips;
  /** 模型自身单位下的棋子高度——武器尺寸的参照。 */
  unit: number;
  /** 模型自身单位下的足底线高度，用于让道具不陷入地面。 */
  baseY: number;
  /**
   * 当模型正是为这支军队制作时为 true。这类模型保留自己的彩绘
   * 纹理；共享模型则改为重染成阵营制服色。
   */
  ownLivery: boolean;
  /** 角色所配武器所属的兵器库。 */
  arsenal: ArsenalId;
}

export interface PieceVisualOptions {
  contactShadows: boolean;
  /** 循环播放战斗站姿。一次性动作（攻击 / 死亡）始终播放。 */
  idleAnimation?: boolean;
  /** 悬浮在棋子头顶的军衔徽记。 */
  rankBadge?: boolean;
}

/** 王室：国王与王后移动更慢、身姿比士卒更高大。 */
const ROYAL_KINDS: PieceKind[] = ["k", "q"];

/**
 * 目标播放时长。士兵的攻击干脆利落；王室则以悠长、从容的节拍出手，
 * 让这一击读作宣判，而非混战。
 */
function oneShotSeconds(kind: PieceKind, name: OneShot): number {
  const royal = ROYAL_KINDS.includes(kind);
  if (name === "attack") return royal ? 1.5 : 0.95;
  // 操练动作从不仓促：装药、入弹、通条，再收回肩头。
  if (name === "reload") return royal ? 1.25 : 1.05;
  return royal ? 1.15 : 0.85;
}

/** 只播放一次、之后把身体交还给站姿的剪辑。 */
type OneShot = "attack" | "death" | "reload";

/** 每条剪辑实测的步伐周期，保证一条剪辑只被分析一次。 */
const GAIT_PERIODS = new WeakMap<THREE.AnimationClip, number>();

/** 腿部骨骼，按回答"一步有多长？"这一问题的优先级排序。 */
const LEG_BONES = [/upleg/i, /thigh/i, /(^|[^a-z])leg/i, /foot/i];

/**
 * 一条移动剪辑中**一个**步态周期（两次落足）的时长，单位秒。
 *
 * 生成器并不会每条剪辑只给出一个周期：`spear-walk` 是单个 1.13 秒
 * 周期，但 `casual-walk` 是 4.23 秒共*三个*周期，`confident-strut`
 * 是 2.7 秒两个周期，`sneaky-walk` 是 2.9 秒两个半周期。若把整条
 * 剪辑当作一个周期来重定时，就会向混合器请求 3-4 倍的时间缩放，
 * 从而顶到 {@link PieceView.startMarch} 中的上限：双腿无论走多远都以
 * 固定的模糊残影飞快摆动，与落足节奏完全脱节，行军根本不再读作
 * 行走。重装阶位受害最重——国王、王后和战车都走 `casual-walk`。
 *
 * 周期从剪辑本身读出（对一条腿骨摆动做自相关），因此换入的步伐是
 * 实测而非猜测；且按剪辑缓存，因为答案永不会变。
 */
function gaitCycle(clip: THREE.AnimationClip): number {
  const cached = GAIT_PERIODS.get(clip);
  if (cached !== undefined) return cached;
  const period = measureGaitCycle(clip);
  GAIT_PERIODS.set(clip, period);
  return period;
}

function measureGaitCycle(clip: THREE.AnimationClip): number {
  const track = findLegTrack(clip);
  // 没有腿形轨迹可读：按常见情况把整条剪辑当作单一周期处理。
  if (!track || track.times.length < 12) return clip.duration;

  // 信号：腿部相对首帧摆开的角度。一个步行周期会让它回到原位，
  // 因此信号的周期就是步伐的周期。
  const frames = track.times.length;
  const signal = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let dot = 0;
    for (let c = 0; c < 4; c += 1) dot += track.values[i * 4 + c] * track.values[c];
    signal[i] = 2 * Math.acos(Math.min(1, Math.abs(dot)));
  }

  let mean = 0;
  for (const value of signal) mean += value;
  mean /= frames;
  let energy = 0;
  for (let i = 0; i < frames; i += 1) {
    signal[i] -= mean;
    energy += signal[i] * signal[i];
  }
  // 一条从不摆动的腿（驱动内容并非步态的剪辑）。
  if (energy < 1e-6) return clip.duration;

  // 自相关：取曲线从零滞后处回落*之后*的第一个峰值——若直接取全局
  // 最大值，它会欣然以两步作答。
  const limit = Math.floor(frames * 0.8);
  const correlation = new Float32Array(limit);
  for (let lag = 0; lag < limit; lag += 1) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i + lag < frames; i += 1) {
      sum += signal[i] * signal[i + lag];
      count += 1;
    }
    correlation[lag] = sum / count / (energy / frames);
  }
  let lag = 1;
  while (lag < limit && correlation[lag] > 0.1) lag += 1;
  let period = 0;
  for (; lag < limit - 1; lag += 1) {
    if (correlation[lag] > correlation[lag - 1] && correlation[lag] >= correlation[lag + 1]) {
      if (correlation[lag] > 0.55) period = lag;
      break;
    }
  }
  if (period <= 0) return clip.duration;

  const step = (track.times[frames - 1] - track.times[0]) / (frames - 1);
  const seconds = period * step;
  // 与整条剪辑相差无几的周期就是整条剪辑；短于三分之一秒的周期
  // 是噪声，不是步伐。
  if (seconds < 0.3 || seconds > clip.duration * 0.8) return clip.duration;
  return seconds;
}

/** 剪辑中摆动幅度最大的腿部轨迹：优先大腿，最后是脚趾。 */
function findLegTrack(clip: THREE.AnimationClip): THREE.QuaternionKeyframeTrack | null {
  for (const pattern of LEG_BONES) {
    for (const track of clip.tracks) {
      if (!track.name.endsWith(".quaternion")) continue;
      if (track.values.length / 4 !== track.times.length) continue;
      if (pattern.test(track.name)) return track as THREE.QuaternionKeyframeTrack;
    }
  }
  return null;
}

/**
 * 一个渲染出的棋子。遵循放置约定：
 * container（棋盘落位）→ runtime（待机摇曳、攻击动作）→ visual
 * （对生成模型做的一次性缩放 / 朝向 / 居中）。
 */
export class PieceView {
  readonly container = new THREE.Group();
  readonly runtime = new THREE.Group();
  readonly visual = new THREE.Group();
  readonly kind: PieceKind;
  readonly color: Faction;
  /** 该棋子所配武器所属的兵器库——战斗表现由此读取风格。 */
  readonly arsenal: ArsenalId;

  private materials: THREE.MeshStandardMaterial[] = [];
  private baseEmissive = 0.05;
  private glow: THREE.Mesh;
  private shadow: THREE.Mesh | null = null;
  private phase = Math.random() * Math.PI * 2;
  private hovered = false;
  private selected = false;
  private alarm = 0;
  /** 击中瞬间为 1 并随时间衰减——驱动红色受击闪光。 */
  private hit = 0;
  /** 棋子落定瞬间为 1 并随时间衰减——让地面光环闪耀。 */
  private aura = 0;
  /** 死亡剪辑一旦开始播放即置位，防止任何东西把尸体重新拉起。 */
  private slain = false;
  /** 静置朝向（面向敌方一侧），战斗结束后回到此朝向。 */
  private homeFacing = new THREE.Quaternion();
  /**
   * 不可见的拾取代理。直接对模型做射线检测既缓慢（每个棋子有数万
   * 个蒙皮三角形）又不可靠，因此每个棋子都携带一个精确立于其格子上
   * 的廉价盒体。
   */
  private readonly collider: THREE.Mesh;

  private arms: AttachedArms | null = null;
  private readonly majestic: boolean;

  /** 模型与武器的所有网格——燃烧期间要撤掉投影。 */
  private meshes: THREE.Mesh[] = [];
  /** 0 为实体 → 1 为完全飞散。驱动烧蚀消散着色器。 */
  private dissolveAmount = 0;
  private readonly dissolveUniforms: DissolveUniforms;

  /**
   * 战术视图使用的平面俯视筹码。棋盘首次被压平时构建，此后在棋子
   * 的整个生命周期内保留。
   */
  private token: THREE.Mesh | null = null;
  private tokenMaterial: THREE.MeshBasicMaterial | null = null;
  /** 棋盘正被从正上方当作 2D 地图阅读时为 true。 */
  private flat = false;
  /** 在模型与筹码之间做缓动过渡，避免切换变成硬切。 */
  private tokenFade = 0;
  /** 平面内的旋转，让印制的军衔在屏幕上保持端正。 */
  private tokenYaw = 0;

  /** 悬浮的军衔徽记；它是精灵，会自动面向镜头。 */
  private badge: THREE.Sprite | null = null;
  private badgeWanted = true;
  /** 当模态界面（升变选择器）占据屏幕时压下徽记。 */
  private badgeMuted = false;
  private badgeOpacity = 0;
  /** 由托盘 / 死亡编排施加的全局淡入淡出。 */
  private fade = 1;

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private activeOneShot: ClipName | null = null;
  private idleLooping = false;
  /** 当前正驮着棋子穿过棋盘的移动循环。 */
  private marchLoop: MarchClip | null = null;
  /** 当前行军所走的每秒落足数。 */
  private marchRate = 0;
  /** 棋子正把瞄准保持在目标身上时为 true。 */
  private aiming = false;
  /** 根骨骼及其绑定平移，用于剥离剪辑的根位移。 */
  private rootBone: THREE.Bone | null = null;
  private rootRest = new THREE.Vector3();
  private lockRootMotion = true;
  /** 该棋子是否被允许循环播放站姿（画质设置）。 */
  private idleWanted = true;
  /**
   * 由手工驱动攻击保持的身体倾角。混合器每帧都会重写 runtime 的
   * 旋转，因此程序化挥击必须在它之后重新施加——否则缺少攻击剪辑的
   * 棋子只会向前滑。
   */
  private strikeTilt = 0;

  constructor(
    kind: PieceKind,
    color: Faction,
    model: THREE.Object3D,
    options: PieceVisualOptions,
    clips: PieceClips = {},
    unit = 1,
    baseY = 0,
    ownLivery = false,
    arsenal: ArsenalId = "kingdom",
  ) {
    this.kind = kind;
    this.color = color;
    this.arsenal = arsenal;
    this.majestic = ROYAL_KINDS.includes(kind);

    this.container.name = `piece_${color}${kind}`;
    this.container.add(this.runtime);
    this.runtime.add(this.visual);
    this.visual.add(model);
    this.container.userData.piece = this;

    this.collider = new THREE.Mesh(sharedColliderGeometry(kind), sharedColliderMaterial());
    this.collider.position.y = PIECE_HEIGHT[kind] * 0.55;
    this.collider.castShadow = false;
    this.collider.receiveShadow = false;
    this.collider.userData.piece = this;
    this.container.add(this.collider);

    const span = Math.max(unit, 1e-3);
    this.dissolveUniforms = {
      uDissolve: { value: 0 },
      uDissolveEdge: { value: 0.14 },
      // 不管模型用什么单位制作，身体上大约横跨十个噪声单元。
      uDissolveScale: { value: 10 / span },
      uDissolveSpan: { value: new THREE.Vector2(baseY, span) },
      uDissolveEmber: { value: new THREE.Color(DISSOLVE_EMBER[color]) },
      uRimColor: { value: new THREE.Color(FACTION_RIM[color]).convertSRGBToLinear() },
      uRimStrength: { value: RIM_STRENGTH },
    };

    model.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.piece = this;
      const source = mesh.material as THREE.MeshStandardMaterial;
      const material = source.clone();
      applyFactionLook(material, color, ownLivery);
      installDissolve(material, this.dissolveUniforms, 0.85);
      mesh.material = material;
      this.materials.push(material);
      this.meshes.push(mesh);
    });

    // 画在地砖上而不是叠加到地砖上：一道染着军队颜色的加法辉光在
    // 被照亮的大理石格子（棋盘的大部分）里会消失不见，而消失恰恰是
    // 它绝不可以做的事。
    const glowMaterial = new THREE.MeshBasicMaterial({
      map: sharedRingTexture(color),
      color: FACTION_RING[color],
      transparent: true,
      opacity: RING_REST,
      depthWrite: false,
      // 色环是仪表而非受光的石头：让它脱离调色管线，在明亮与昏暗的
      // 大厅里都读作同样的样子。
      toneMapped: false,
    });
    this.glow = new THREE.Mesh(sharedDiscGeometry(), glowMaterial);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.012;
    this.glow.renderOrder = 3;
    this.container.add(this.glow);

    if (options.contactShadows) {
      const shadowMaterial = new THREE.MeshBasicMaterial({
        map: sharedShadowTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      this.shadow = new THREE.Mesh(sharedDiscGeometry(), shadowMaterial);
      this.shadow.rotation.x = -Math.PI / 2;
      this.shadow.position.y = 0.006;
      this.shadow.scale.setScalar(0.85);
      this.shadow.renderOrder = 1;
      this.container.add(this.shadow);
    }

    this.badgeWanted = options.rankBadge !== false;
    this.buildBadge();

    this.setupAnimations(model, clips, options.idleAnimation !== false);
    this.equipArms(model, unit, baseY, arsenal);
  }

  /** 徽记精灵，停在棋子头顶上方。 */
  private buildBadge(): void {
    const material = new THREE.SpriteMaterial({
      map: rankBadgeTexture(this.kind, this.color),
      transparent: true,
      // 始终可读：藏在身前棋子后面的徽记会让放置它的意义荡然无存。
      depthTest: false,
      depthWrite: false,
      opacity: 0,
      sizeAttenuation: true,
    });
    const badge = new THREE.Sprite(material);
    badge.scale.setScalar(BADGE_SCALE[this.kind]);
    badge.position.y = PIECE_HEIGHT[this.kind] + BADGE_LIFT;
    badge.renderOrder = 40;
    badge.visible = this.badgeWanted;
    badge.frustumCulled = false;
    this.badge = badge;
    this.container.add(badge);
  }

  /** 全盘统一开关悬浮军衔徽记。 */
  setBadgeEnabled(enabled: boolean): void {
    this.badgeWanted = enabled;
    if (!this.badge) return;
    this.badge.visible = enabled && !this.badgeMuted && !this.slain;
    if (!enabled) {
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    }
  }

  /**
   * 在不改动玩家偏好的前提下把徽记移出屏幕。徽记有意忽略深度缓冲，
   * 因此模态面板弹出时它本会直接穿透面板。
   */
  setBadgeMuted(muted: boolean): void {
    if (this.badgeMuted === muted) return;
    this.badgeMuted = muted;
    if (!this.badge) return;
    if (muted) {
      this.badge.visible = false;
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    } else {
      this.badge.visible = this.badgeWanted && !this.slain && !this.flat;
    }
  }

  // ------------------------------------------------------------ 战术视图

  /**
   * 把立体模型换成平面俯视筹码。在俯视视角中，与真人等大的棋子会
   * 遮住周围的格子，因此战术棋盘把每一尊雕像换成一枚躺在地砖上的
   * 彩绘圆片。
   */
  setFlat(enabled: boolean): void {
    if (this.flat === enabled) return;
    this.flat = enabled;
    if (enabled && !this.token) this.buildToken();
    this.visual.visible = !enabled;
    if (this.shadow) this.shadow.visible = !enabled;
    if (this.badge) this.badge.visible = !enabled && this.badgeWanted && !this.badgeMuted && !this.slain;
    if (this.token) this.token.visible = enabled;
    // 棋盘压平时被冻结在半途的攻击动作必须被释放。
    if (!enabled && !this.slain && this.mixer) this.returnToStance(0.2);
  }

  /** 屏幕向上方向（棋盘偏航角）——让每个印制的军衔保持可读。 */
  setTokenYaw(yaw: number): void {
    this.tokenYaw = yaw;
  }

  private buildToken(): void {
    const material = new THREE.MeshBasicMaterial({
      map: tacticalTokenTexture(this.kind, this.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // 筹码是仪表而非受光的石头：让它脱离调色管线。
      toneMapped: false,
    });
    const token = new THREE.Mesh(sharedTokenGeometry(), material);
    token.rotation.x = -Math.PI / 2;
    token.position.y = 0.055;
    token.scale.setScalar(TOKEN_SCALE[this.kind]);
    token.renderOrder = 12;
    token.frustumCulled = false;
    token.visible = false;
    this.token = token;
    this.container.add(token);
    this.tokenMaterial = material;
  }

  private updateToken(delta: number, alarmPulse: number): void {
    const token = this.token;
    const material = this.tokenMaterial;
    if (!token || !material) return;

    if (this.flat) this.tokenFade = Math.min(1, this.tokenFade + delta * 5);
    else this.tokenFade = Math.max(0, this.tokenFade - delta * 7);

    token.visible = this.tokenFade > 0.01;
    if (!token.visible) return;

    token.rotation.z = this.tokenYaw;
    const settle = this.aura * this.aura;
    const pop =
      1 + (this.selected ? 0.14 : this.hovered ? 0.07 : 0) + alarmPulse * 0.2 + settle * 0.16;
    token.scale.setScalar(TOKEN_SCALE[this.kind] * pop * this.tokenFade);
    token.position.y = 0.055 + (this.selected ? 0.05 : 0);

    // 打击与将军警报直接烧穿圆片表面。
    const heat = Math.min(1, this.hit * this.hit + alarmPulse * 0.7);
    material.color.setRGB(1 + heat * 1.1, 1 - heat * 0.5, 1 - heat * 0.6);
    material.opacity = this.tokenFade * this.fade * (1 - this.dissolveAmount);
  }

  private updateBadge(delta: number, elapsed: number, alarmPulse: number): void {
    const badge = this.badge;
    if (!badge) return;
    const visible = this.badgeWanted && !this.badgeMuted && !this.slain && !this.flat;
    badge.visible = visible;
    if (!visible) return;

    const target = this.selected ? 1 : this.hovered ? 0.95 : 0.72;
    this.badgeOpacity += (target - this.badgeOpacity) * Math.min(1, delta * 6);
    const material = badge.material as THREE.SpriteMaterial;
    material.opacity = this.badgeOpacity * this.fade;

    const bob = Math.sin(elapsed * 1.5 + this.phase) * 0.022;
    badge.position.y =
      PIECE_HEIGHT[this.kind] + BADGE_LIFT + bob + (this.selected ? 0.05 : 0);
    const pop = 1 + (this.selected ? 0.16 : this.hovered ? 0.08 : 0) + alarmPulse * 0.22;
    badge.scale.setScalar(BADGE_SCALE[this.kind] * pop);
  }

  /**
   * 在站姿姿态就位后把武器交到棋子手上，让道具对齐玩家实际看到的
   * 姿态。
   */
  private equipArms(model: THREE.Object3D, unit: number, baseY: number, arsenal: ArsenalId): void {
    try {
      this.mixer?.update(0);
      const arms = attachWeapons(model, this.kind, this.color, unit, baseY, arsenal);
      this.arms = arms;
      for (const mesh of arms.meshes) mesh.userData.piece = this;
      // 道具挂在骨骼上，因此它们按同一时钟燃烧，但没有自下而上的
      // 扫掠——它们的本地空间与棋子的本地空间不同。
      for (const material of arms.materials) installDissolve(material, this.dissolveUniforms, 0);
      this.meshes.push(...arms.meshes);
    } catch (error) {
      console.warn(`[pieces] could not arm "${this.kind}"`, error);
    }
  }

  private setupAnimations(model: THREE.Object3D, clips: PieceClips, idleEnabled: boolean): void {
    const entries = (Object.keys(clips) as ClipName[]).filter((name) => clips[name]);
    this.idleWanted = idleEnabled;

    let rigged = false;
    model.traverse((node) => {
      const bone = node as THREE.Bone;
      if (bone.isBone) {
        rigged = true;
        if (!this.rootBone) {
          this.rootBone = bone;
          this.rootRest.copy(bone.position);
        }
      }
      const skinned = node as THREE.SkinnedMesh;
      // 蒙皮包围盒每帧都在变；按绑定姿态做剔除会造成跳变。
      if (skinned.isSkinnedMesh) {
        rigged = true;
        skinned.frustumCulled = false;
      }
    });

    // 还没有任何剪辑的骨架也照样拿到混合器：战斗剪辑会在后台陆续
    // 到达，并在落地时绑定到这枚棋子上。
    if (!rigged && entries.length === 0) return;

    this.mixer = new THREE.AnimationMixer(model);
    for (const name of entries) {
      const clip = clips[name];
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(name, action);
    }

    // 播完的攻击会自行回到站姿；死亡则停在最后一帧。
    this.mixer.addEventListener("finished", (event) => {
      const action = (event as unknown as { action: THREE.AnimationAction }).action;
      if (this.activeOneShot === "attack" && action === this.actions.get("attack")) {
        this.returnToStance(0.2);
      }
    });

    this.returnToStance(0);
  }

  /**
   * 绑定在棋子构建之后才到达的剪辑。战斗剪辑在后台下载，因此开局
   * 期间创建的棋子必须能在稍后接收它的攻击、死亡或步伐剪辑，而无需
   * 重建。
   */
  installClip(name: ClipName, clip: THREE.AnimationClip): void {
    if (!this.mixer || this.actions.has(name)) return;
    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    this.actions.set(name, action);
    // 站姿是当前唯一要紧的剪辑——其余剪辑会在棋子下次战斗或移动时
    // 按名字索取。
    if (name !== "idle" || this.slain || this.activeOneShot || this.marchLoop) return;
    if (this.idleWanted) this.playIdle(0.35);
    else this.poseFromIdle();
  }

  /**
   * 由手工而非骨骼驱动的攻击所用的身体倾角：负值向后仰离目标，
   * 正值把肩背压向打击方向。
   */
  setStrikeTilt(tilt: number): void {
    this.strikeTilt = tilt;
  }

  get hasAnimations(): boolean {
    return this.mixer !== null;
  }

  /** 该模型是否真的携带某条剪辑（各阶位的骨架不同）。 */
  hasClip(name: ClipName): boolean {
    return this.actions.has(name);
  }

  get isMarching(): boolean {
    return this.marchLoop !== null;
  }

  /**
   * 让棋子用自己的双腿完成一次棋盘移动。`stepRate` 是行军应有的
   * 每秒落足数；剪辑是一个完整的步态周期（两步），因此会被重定时到
   * 该步频，调用方的步伐时钟与骨骼始终互相锁定。模型没有对应剪辑时
   * 返回 false，调用方可回退为滑动。
   */
  startMarch(name: MarchClip, stepRate: number): boolean {
    const action = this.actions.get(name);
    if (!action || !this.mixer || this.slain) return false;
    const clip = action.getClip();
    const cycles = Math.max(0.15, stepRate * 0.5);
    // 按剪辑*自身*的步长而非总时长重定时：生成的几条步伐剪辑是三个
    // 周期首尾相接（见 {@link gaitCycle}），若当作一个周期处理，就会把
    // 重装阶位钉死在下面那个上限——双腿原地飞转成残影而身体在滑行。
    // 加上钳制，让极长或极短的移动既不会把步伐变成幻灯片，也不会变成
    // 双腿模糊的冲刺。
    const timeScale = THREE.MathUtils.clamp(cycles * gaitCycle(clip), 0.4, 2.9);

    for (const [key, other] of this.actions) {
      if (key !== name) other.fadeOut(0.16);
    }
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.paused = false;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.14).play();

    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = name;
    // 实际达成的步频，好让拖行的火炮按同一时钟颠簸。
    this.marchRate = Math.max(0.2, stepRate);
    this.lockRootMotion = true;
    return true;
  }

  /** 结束行军，并把棋子缓动回战斗站姿。 */
  stopMarch(fade = 0.22): void {
    if (!this.marchLoop) return;
    this.returnToStance(fade);
  }

  /**
   * 在行军、攻击或瞄准之后把身体交还给静置站姿。站姿是否*呼吸*由
   * 预设决定，但任由行军继续运行是不行的：在最低画质预设下这里过去
   * 会照样落到 {@link playIdle}，于是一枚本应纹丝不动站立的棋子，在
   * 走完第一步的那一刻就开始呼吸了。
   */
  private returnToStance(fade: number): void {
    if (this.idleWanted) {
      this.playIdle(fade);
      return;
    }
    if (this.marchLoop) {
      this.actions.get(this.marchLoop)?.fadeOut(Math.max(0.06, fade));
      this.marchLoop = null;
      this.settleTrain();
    }
    if (this.aiming) {
      this.actions.get("aim")?.fadeOut(Math.max(0.06, fade));
      this.aiming = false;
    }
    this.activeOneShot = null;
    this.idleLooping = false;
    this.lockRootMotion = true;
    this.poseFromIdle(fade);
  }

  /**
   * 冻结站姿的第一帧，让"低"画质仍然读作战士。若下方原本有动作在
   * 进行则以淡入代替硬切，行走不会在移动结束的最后一帧猛地立正。
   */
  private poseFromIdle(fade = 0): void {
    const idle = this.actions.get("idle");
    if (!idle || !this.mixer) return;
    idle.reset().play();
    if (fade > 0.01) idle.fadeIn(fade);
    idle.paused = true;
    this.mixer.update(0);
  }

  /**
   * 抬起武器并保持在目标上：一个循环的瞄准画面，由调用方在射手
   * 稳定身形期间持续运行。这副骨架从未学过瞄准时返回 false，该节拍
   * 可回退为手工驱动的前倾。
   */
  playAim(fade = 0.2): boolean {
    const action = this.actions.get("aim");
    if (!action || !this.mixer || this.slain) return false;
    for (const [key, other] of this.actions) {
      if (key !== "aim") other.fadeOut(Math.max(0.06, fade));
    }
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.paused = false;
    // 略低于真实速度：平举枪管的人是从容不迫的。
    action.setEffectiveTimeScale(0.85);
    action.setEffectiveWeight(1);
    action.fadeIn(fade).play();

    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = null;
    this.aiming = true;
    this.lockRootMotion = true;
    return true;
  }

  /**
   * 对保持中的瞄准画面重定时。瞄准剪辑带有横向扫视，这在射手搜寻
   * 目标时是对的，但在开火之后就错了——因此该节拍在射击后把它放慢
   * 到近乎停止，让火枪手保持注视目标，而不是回头继续扫视棋盘。
   *
   * @param scale 1 = 按原始制作速度，低于 1 则扫视变得迟缓。
   */
  setAimDrift(scale: number): void {
    if (!this.aiming) return;
    this.actions.get("aim")?.setEffectiveTimeScale(Math.max(0.04, scale));
  }

  /**
   * 跪落到单膝：把起身剪辑**反向**播放，于是磕到石板的那条膝盖，
   * 正是稍后角色要借力起身的那条。
   *
   * @returns 跪落所需时长；这副骨架没有对应剪辑时为 0。
   */
  playKneel(seconds: number): number {
    return this.playStanceShift(-1, seconds);
  }

  /**
   * 从单膝起身回到双脚站立。剪辑会停在最后一个站立帧上，调用方可
   * 直接交接给站姿（或直接进入行军），身体不会在中间再次下沉。
   *
   * @returns 起身所需时长；这副骨架没有对应剪辑时为 0。
   */
  playRise(seconds: number): number {
    return this.playStanceShift(1, seconds);
  }

  /**
   * 唯一能改变棋子姿态的那条剪辑，按节拍需要的方向播放。反向播放是
   * 混合器的一等特性：配合 `LoopOnce` 与负时间缩放，动作会在时间 0 处
   * 钳住，并像在远端一样正常触发 `finished`。
   *
   * @param direction 1 为从膝上起身，-1 为跪落到膝上。
   * @param seconds 动作应有的时长，不论剪辑本身多长。
   */
  private playStanceShift(direction: 1 | -1, seconds: number): number {
    const action = this.actions.get("rise");
    if (!action || !this.mixer || this.slain) return 0;
    // 只取剪辑中真正在换姿态的部分（见 RISE_SPAN）。
    const span = action.getClip().duration * RISE_SPAN;
    const target = Math.max(0.2, seconds);
    const timeScale = THREE.MathUtils.clamp(span / target, 0.35, 3.4);
    const duration = span / timeScale;

    for (const [key, other] of this.actions) {
      if (key !== "rise") other.fadeOut(0.12);
    }
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = false;
    action.time = direction > 0 ? 0 : span;
    action.setEffectiveTimeScale(direction * timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.12).play();

    this.activeOneShot = "rise";
    this.idleLooping = false;
    this.marchLoop = null;
    this.aiming = false;
    this.lockRootMotion = true;
    return duration;
  }

  /** 交叉淡变回循环的战斗站姿。 */
  playIdle(fade = 0.25): void {
    // 下方若还留着行军的循环，它会混入站姿，让双腿原地踏步不停。
    if (this.marchLoop) {
      this.actions.get(this.marchLoop)?.fadeOut(Math.max(0.06, fade));
      this.marchLoop = null;
      this.settleTrain();
    }
    // 保持中的瞄准同理：若不停止，它会把枪管重新混入抬起的姿势。
    if (this.aiming) {
      this.actions.get("aim")?.fadeOut(Math.max(0.06, fade));
      this.aiming = false;
    }
    const idle = this.actions.get("idle");
    if (!idle) return;
    this.activeOneShot = null;
    this.lockRootMotion = true;
    if (this.idleLooping && idle.isRunning()) return;
    idle.reset();
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.clampWhenFinished = false;
    idle.paused = false;
    // 让全军的相位错开，整盘棋不会整齐划一地同步呼吸。
    idle.time = Math.random() * idle.getClip().duration;
    // 王室镇住全场：比士卒更缓慢、更沉稳的呼吸。
    idle.setEffectiveTimeScale(
      this.majestic ? 0.52 + Math.random() * 0.08 : 0.9 + Math.random() * 0.2,
    );
    idle.fadeIn(fade).play();
    this.idleLooping = true;
  }

  /**
   * @param seconds 显式指定的播放时长，覆盖按阶位的默认值。
   *   开火操练必须可读——必须看得见这一枪是瞄准过的——因此火枪节拍
   *   要求的时长比挥剑更长、更慢。
   */
  private playOneShot(name: OneShot, seconds?: number): number {
    const action = this.actions.get(name);
    if (!action || !this.mixer) return 0;
    const clip = action.getClip();
    const target = seconds ?? oneShotSeconds(this.kind, name);
    // 显式要求的时长允许把剪辑放慢到远超默认时长的程度：
    // 这正是显式要求的全部意义。
    const floor = seconds !== undefined ? 0.3 : this.majestic ? 0.45 : 0.75;
    const timeScale = THREE.MathUtils.clamp(clip.duration / target, floor, this.majestic ? 1.6 : 2.6);
    const duration = clip.duration / timeScale;

    for (const [key, other] of this.actions) {
      if (key !== name) other.fadeOut(0.1);
    }
    this.marchLoop = null;
    this.aiming = false;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.paused = false;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.fadeIn(0.08).play();

    this.activeOneShot = name;
    this.idleLooping = false;
    this.lockRootMotion = name !== "death";
    return duration;
  }

  /**
   * 开始播放攻击剪辑。返回播放时长以及刀刃命中的时刻，供调用方
   * 对火花、音效和屏幕震动进行对时。
   *
   * @param options `seconds` 覆盖播放时长，`impactAt` 覆盖打击（或
   *   开火）发生在其中的比例。火器两者都需要：它们的剪辑是长长的
   *   操练，枪响远在过半之后才落下。
   */
  playAttack(options: { seconds?: number; impactAt?: number } = {}): { duration: number; impact: number } {
    const duration = this.playOneShot("attack", options.seconds);
    // 王室的蓄力更长，因此打击落在剪辑更靠后的位置。
    const at = options.impactAt ?? (this.majestic ? 0.56 : 0.42);
    return { duration, impact: duration * THREE.MathUtils.clamp(at, 0.05, 0.95) };
  }

  /**
   * 在开火后运行装填操练。返回其时长；这副骨架从未学过装填时为 0，
   * 调用方直接跳过该节拍即可。
   */
  playReload(): number {
    return this.playOneShot("reload");
  }

  /**
   * 开始播放死亡剪辑并返回其时长。棋子会被标记为已阵亡，悬停 / 选中
   * 抬升、摇曳和待机站姿随即停止干扰倒下过程——尸体保持最后一帧，
   * 直到被清理走。
   */
  playDeath(): number {
    this.slain = true;
    this.marchLoop = null;
    this.hovered = false;
    this.selected = false;
    this.alarm = 0;
    this.collider.visible = false;
    if (this.badge) {
      this.badge.visible = false;
      this.badgeOpacity = 0;
      (this.badge.material as THREE.SpriteMaterial).opacity = 0;
    }
    return this.playOneShot("death");
  }

  /**
   * 把棋子抬离地平面：接触阴影和队伍辉光是钉在地面上的圆片，
   * 身体腾空时它们必须隐藏。
   */
  setAirborne(airborne: boolean): void {
    this.glow.visible = !airborne;
    if (this.shadow) this.shadow.visible = !airborne && !this.flat;
  }

  /** 回到平静站姿（倒下的棋子被送到托盘时使用）。 */
  resetPose(): void {
    this.slain = false;
    this.setDissolve(0);
    this.strikeTilt = 0;
    this.hit = 0;
    this.aura = 0;
    this.collider.visible = true;
    this.visual.scale.set(1, 1, 1);
    if (this.badge) this.badge.visible = this.badgeWanted;
    this.setAirborne(false);
    this.runtime.position.set(0, 0, 0);
    this.runtime.rotation.set(0, 0, 0);
    this.container.scale.setScalar(1);
    this.visual.quaternion.copy(this.homeFacing);
    if (!this.mixer) return;
    for (const action of this.actions.values()) action.stop();
    this.activeOneShot = null;
    this.idleLooping = false;
    this.marchLoop = null;
    this.aiming = false;
    this.lockRootMotion = true;
    this.container.rotation.set(0, 0, 0);
    this.playIdle(0);
  }

  get object(): THREE.Object3D {
    return this.container;
  }

  /** 指针命中测试的对象——永远不是模型本身。 */
  get hitMeshes(): THREE.Mesh[] {
    return [this.collider];
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
  }

  /** 0 = 平静，1 = 国王被将军（红色脉冲）。 */
  setAlarm(value: number): void {
    this.alarm = value;
  }

  /** 打击命中瞬间，棋子全身泛起炽热的红色闪光。 */
  takeHit(): void {
    this.hit = 1;
  }

  /**
   * 落地沉降使用的垂直压扁量：0 让棋子站直，1 为完全压缩。只作用于
   * 模型本身，因此地面圆片、徽记和棋盘锚点都精确留在原处。
   */
  setSquash(amount: number): void {
    const value = THREE.MathUtils.clamp(amount, -0.6, 1) * 0.15;
    this.visual.scale.set(1 + value * 0.6, 1 - value, 1 + value * 0.6);
  }

  /** 让棋子脚下的队伍光环闪耀——它占据一个格子的那一刻。 */
  flareAura(strength = 1): void {
    this.aura = Math.max(this.aura, THREE.MathUtils.clamp(strength, 0, 1.5));
  }

  get isSlain(): boolean {
    return this.slain;
  }

  /** 该棋子是否携带有可施放火焰的法杖或权杖。 */
  get canCast(): boolean {
    return this.arms?.focus != null;
  }

  /** 该棋子是否有可供击发的枪管：手枪、火枪或野战炮。 */
  get canShoot(): boolean {
    return this.arms?.muzzle != null;
  }

  /** 该棋子身旁是否拖着一辆炮车。 */
  get hasTrain(): boolean {
    return this.arms?.train != null;
  }

  /**
   * 射击离开的世界坐标点：枪口，从当前实时姿态中读出，这样无论手臂
   * 把枪挥到哪里，火光都贴在枪口上——对炮兵来说，则是炮车被拖到的
   * 任何位置。
   */
  muzzleOrigin(): THREE.Vector3 {
    const muzzle = this.arms?.muzzle;
    if (muzzle) {
      muzzle.updateWorldMatrix(true, false);
      return muzzle.getWorldPosition(new THREE.Vector3());
    }
    return this.castOrigin();
  }

  /**
   * 让炮车沿车轮向后退去，并在发射药把炮架掀起时抬起炮口。火炮挂在
   * 模型根节点的体坐标系下，因此后坐是沿其自身 -Z 的一次推挤，外加绕
   * 车轴（其自身 X 轴）的俯仰。
   *
   * @param back 沿炮车自身射向向后退的距离，以棋子高度计
   * @param lift 0 = 平放在车轮上，1 = 炮口被满装药掀起
   */
  setTrainRecoil(back: number, lift = 0): void {
    const train = this.arms?.train;
    if (!train) return;
    const jump = Math.max(0, lift);
    train.position.z = -Math.max(0, back);
    // 满装药射击时，野战炮的车轮确实会离地。
    train.position.y = jump * 0.045;
    train.rotation.x = -jump * 0.2;
  }

  /**
   * 一辆拖行的炮车碾过石板：每次落足炮架都绕车轴颠一下，整门炮还
   * 在左右轮之间缓慢摇晃。没有这些，炮兵的火炮就会在行进班组旁边
   * 平移滑行，读作整个阶位丢了动画。
   */
  private rumbleTrain(elapsed: number): void {
    const train = this.arms?.train;
    if (!train) return;
    const jolt = Math.sin(elapsed * this.marchRate * Math.PI * 2 + this.phase);
    train.rotation.x = jolt * 0.022;
    train.rotation.z = Math.sin(elapsed * this.marchRate * Math.PI + this.phase) * 0.014;
    train.position.y = Math.abs(jolt) * 0.008;
  }

  /** 行军结束后把拖行的火炮重新放平。 */
  private settleTrain(): void {
    const train = this.arms?.train;
    if (!train) return;
    train.rotation.x = 0;
    train.rotation.z = 0;
    train.position.y = 0;
  }

  /** 拖行炮车所在的世界坐标点；没有拖挂任何东西时为 null。 */
  trainOrigin(): THREE.Vector3 | null {
    const train = this.arms?.train;
    if (!train) return null;
    train.updateWorldMatrix(true, false);
    return train.getWorldPosition(new THREE.Vector3());
  }

  /**
   * 法术发出的世界坐标点：法杖爪口中的水晶或权杖上的宝石，在请求
   * 那一刻从姿态中读出，这样无论施法手臂把道具挥到哪里，火焰都挂在
   * 道具上。
   */
  castOrigin(): THREE.Vector3 {
    const focus = this.arms?.focus;
    if (focus) {
      focus.updateWorldMatrix(true, false);
      return focus.getWorldPosition(new THREE.Vector3());
    }
    // 没有道具（未绑骨的兜底棋子）：从双手应在的位置施法。
    const height = PIECE_HEIGHT[this.kind] * 0.78;
    return this.container.position.clone().setY(this.container.position.y + height);
  }

  /** 立刻把棋子转向看向某个世界坐标点（击杀它的棋子、某个目标）。 */
  faceTowards(point: THREE.Vector3): void {
    const forward = point.clone().sub(this.container.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    this.setFacing(forward.normalize(), false);
  }

  /** 平滑地把棋子转向面对某个世界坐标点。 */
  async turnTowards(point: THREE.Vector3, tweens: TweenManager, duration = 0.22): Promise<void> {
    const forward = point.clone().sub(this.container.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) return;
    await this.turnTo(orientationCorrection(forward.normalize()), tweens, duration);
  }

  /** 战斗结束后转回静置朝向。 */
  async turnHome(tweens: TweenManager, duration = 0.28): Promise<void> {
    await this.turnTo(this.homeFacing.clone(), tweens, duration);
  }

  private async turnTo(to: THREE.Quaternion, tweens: TweenManager, duration: number): Promise<void> {
    const from = this.visual.quaternion.clone();
    if (from.angleTo(to) < 0.04) return;
    await tweens.to({
      duration,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        this.visual.quaternion.slerpQuaternions(from, to, t);
      },
    });
    this.visual.quaternion.copy(to);
  }

  /**
   * 烧蚀消散量：0 保持棋子为实体，1 使其完全飞散。身体从足底向上
   * 穿过一个带发光边缘的噪声场逐渐侵蚀，被吃掉的棋子会化作碎屑散入
   * 空气，而不是被直接关掉。
   */
  setDissolve(amount: number): void {
    const value = THREE.MathUtils.clamp(amount, 0, 1);
    if (this.dissolveAmount === value) return;
    const wasSolid = this.dissolveAmount <= 0.02;
    this.dissolveAmount = value;
    this.dissolveUniforms.uDissolve.value = value;
    // 阴影贴图对烧蚀一无所知，被烧掉一半的身体还会继续投下完整的
    // 影子。一开始消散就立刻停止投影。
    const solid = value <= 0.02;
    if (solid !== wasSolid) {
      for (const mesh of this.meshes) mesh.castShadow = solid;
    }
  }

  get dissolveLevel(): number {
    return this.dissolveAmount;
  }

  setOpacity(value: number): void {
    this.fade = value;
    for (const material of this.materials) {
      material.transparent = value < 1;
      material.opacity = value;
      material.depthWrite = value > 0.6;
    }
    if (this.arms) {
      for (const material of this.arms.materials) {
        material.transparent = value < 1;
        material.opacity = value;
        material.depthWrite = value > 0.6;
      }
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    glowMaterial.opacity = RING_REST * value;
    if (this.shadow) (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * value;
    if (this.badge) {
      (this.badge.material as THREE.SpriteMaterial).opacity = this.badgeOpacity * value;
    }
    if (this.tokenMaterial) this.tokenMaterial.opacity = this.tokenFade * value;
  }

  /**
   * 让棋子朝向 `forward`。`remember` 会把它存为静置朝向，供战斗转身
   * 结束后返回。
   */
  setFacing(forward: THREE.Vector3, remember = true): void {
    const quaternion = orientationCorrection(forward);
    this.visual.quaternion.copy(quaternion);
    if (remember) this.homeFacing.copy(quaternion);
  }

  update(delta: number, elapsed: number): void {
    this.hit = Math.max(0, this.hit - delta * 2.4);
    this.aura = Math.max(0, this.aura - delta * 1.8);

    if (this.slain) {
      this.updateSlain(delta);
      return;
    }

    const breath = Math.sin(elapsed * (this.majestic ? 0.7 : 1.15) + this.phase);
    const sway = Math.sin(elapsed * (this.majestic ? 0.42 : 0.7) + this.phase * 1.7);
    const lift = this.selected
      ? this.majestic
        ? 0.11
        : 0.16
      : this.hovered
        ? this.majestic
          ? 0.05
          : 0.075
        : 0;

    if (this.flat) {
      // 模型的任何部分都不在屏幕上：完全跳过骨骼，只让棋子在自己的
      // 筹码下方站直。
      this.runtime.position.y += (0 - this.runtime.position.y) * Math.min(1, delta * 9);
    } else if (this.mixer) {
      this.mixer.update(delta);
      if (this.rootBone && this.lockRootMotion) {
        // 让棋子钉在自己的格子上；剪辑自带步伐位移。
        this.rootBone.position.x = this.rootRest.x;
        this.rootBone.position.z = this.rootRest.z;
      }
      // 火炮去的是手臂这一帧到达的位置，而不是站姿姿态把它留下的
      // 位置：平举的枪管正是瞄准剪辑的全部意义。
      this.arms?.align();
      // 野战炮不会滑行：班组行军时，炮车按与靴子相同的时钟在石板上
      // 颠簸。
      if (this.marchLoop) this.rumbleTrain(elapsed);
      this.runtime.position.y += (lift - this.runtime.position.y) * Math.min(1, delta * 9);
      this.runtime.rotation.z = 0;
      // 在混合器之后重新施加，本帧其余时间的姿态由混合器掌管。
      this.runtime.rotation.x = this.strikeTilt;
    } else {
      // 兜底棋子保留程序化的呼吸与重心摇摆。
      const amplitude = this.majestic ? 0.45 : 1;
      this.runtime.position.y +=
        (lift + breath * 0.006 * amplitude - this.runtime.position.y) * Math.min(1, delta * 9);
      this.runtime.rotation.z = sway * 0.012 * amplitude;
      this.runtime.rotation.x = breath * 0.008 * amplitude + this.strikeTilt;
    }

    const target = this.selected ? 0.5 : this.hovered ? 0.32 : 0.06;
    const alarmPulse = this.alarm > 0 ? (Math.sin(elapsed * 7) * 0.5 + 0.5) * this.alarm : 0;
    const hitGlow = this.hit * this.hit * 2.6;
    for (const material of this.materials) {
      const value = this.baseEmissive + target * 0.9 + alarmPulse * 1.5 + hitGlow;
      material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 8);
      if (this.hit > 0.02) material.emissive.setHex(0xff3418);
      else if (this.alarm > 0) material.emissive.setHex(0xff2a1a);
      else material.emissive.setHex(this.color === "w" ? 0x2a4d94 : 0x711a12);
    }
    if (this.arms) {
      // 钢铁与宝石响应同样的高光，但保留各自的色调。
      const boost = target * 0.8 + alarmPulse * 1.2;
      this.arms.materials.forEach((material, index) => {
        const base = this.arms?.baseEmissive[index] ?? 0;
        const value = base + boost * (base > 1 ? 0.6 : 1);
        material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 8);
      });
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    const settle = this.aura * this.aura;
    const glowTarget = Math.min(
      1,
      RING_REST + (this.selected ? 0.5 : this.hovered ? 0.3 : 0) + alarmPulse * 0.4 + settle * 0.4,
    );
    glowMaterial.opacity += (glowTarget - glowMaterial.opacity) * Math.min(1, delta * 8);
    this.glow.scale.setScalar(1 + (this.selected ? 0.16 : 0) + alarmPulse * 0.25 + settle * 0.5);

    this.updateBadge(delta, elapsed, alarmPulse);
    this.updateToken(delta, alarmPulse);
  }

  /**
   * 垂死的棋子只运行骨骼和渐隐的受击闪光：没有呼吸、没有悬停抬升、
   * 没有队伍辉光——倒下必须读作倒下。
   */
  private updateSlain(delta: number): void {
    if (!this.flat) {
      this.mixer?.update(delta);
      this.arms?.align();
    }
    this.updateToken(delta, 0);
    const hitGlow = this.hit * this.hit * 3;
    for (const material of this.materials) {
      const value = this.baseEmissive + hitGlow;
      material.emissiveIntensity += (value - material.emissiveIntensity) * Math.min(1, delta * 10);
      material.emissive.setHex(this.hit > 0.02 ? 0xff3418 : this.color === "w" ? 0x2a4d94 : 0x711a12);
    }
    if (this.arms) {
      this.arms.materials.forEach((material, index) => {
        const base = this.arms?.baseEmissive[index] ?? 0;
        material.emissiveIntensity += (base - material.emissiveIntensity) * Math.min(1, delta * 10);
      });
    }
    const glowMaterial = this.glow.material as THREE.MeshBasicMaterial;
    glowMaterial.opacity = Math.max(0, glowMaterial.opacity - delta * 0.6);
  }

  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
      this.mixer = null;
    }
    this.actions.clear();
    for (const material of this.materials) material.dispose();
    this.materials = [];
    if (this.arms) {
      // 武器几何体在全军内共享；只有材质属于我们自己。
      for (const material of this.arms.materials) material.dispose();
      this.arms = null;
    }
    (this.glow.material as THREE.Material).dispose();
    if (this.shadow) (this.shadow.material as THREE.Material).dispose();
    if (this.badge) {
      (this.badge.material as THREE.Material).dispose();
      this.badge = null;
    }
    if (this.tokenMaterial) {
      this.tokenMaterial.dispose();
      this.tokenMaterial = null;
      this.token = null;
    }
    this.container.removeFromParent();
    this.container.clear();
  }
}

function applyFactionLook(
  material: THREE.MeshStandardMaterial,
  color: Faction,
  ownLivery: boolean,
): void {
  if (ownLivery && material.map) {
    // 模型就是为这支军队绘制的——羽饰、翡翠和金饰会被平涂染色毁掉，
    // 因此只调整表面响应。
    material.color.setHex(0xffffff);
    material.roughness = Math.min(0.85, material.roughness * 0.9 + 0.18);
    material.metalness = Math.max(0.08, Math.min(0.4, material.metalness));
    material.emissive = new THREE.Color(color === "w" ? 0x2a4d94 : 0x711a12);
    material.emissiveIntensity = 0.05;
    material.envMapIntensity = 1.05;
    material.needsUpdate = true;
    return;
  }
  if (color === "w") {
    material.color.setHex(0xfff2dd);
    material.roughness = 0.34;
    material.metalness = 0.1;
    material.emissive = new THREE.Color(0x2a4d94);
  } else {
    material.color.setHex(0x34363d);
    material.roughness = 0.3;
    material.metalness = 0.55;
    material.emissive = new THREE.Color(0x711a12);
  }
  material.emissiveIntensity = 0.05;
  material.envMapIntensity = 1.15;
  material.needsUpdate = true;
}

const colliderGeometries = new Map<PieceKind, THREE.BoxGeometry>();
function sharedColliderGeometry(kind: PieceKind): THREE.BoxGeometry {
  let geometry = colliderGeometries.get(kind);
  if (!geometry) {
    geometry = new THREE.BoxGeometry(0.86, PIECE_HEIGHT[kind] * 1.1, 0.86);
    colliderGeometries.set(kind, geometry);
  }
  return geometry;
}

let colliderMaterial: THREE.MeshBasicMaterial | null = null;
function sharedColliderMaterial(): THREE.MeshBasicMaterial {
  // `visible: false` 让盒体不参与任何渲染通道，同时射线检测仍能
  // 命中它。
  if (!colliderMaterial) colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
  return colliderMaterial;
}

let discGeometry: THREE.PlaneGeometry | null = null;
function sharedDiscGeometry(): THREE.PlaneGeometry {
  if (!discGeometry) discGeometry = new THREE.PlaneGeometry(0.95, 0.95);
  return discGeometry;
}

let tokenGeometry: THREE.PlaneGeometry | null = null;
function sharedTokenGeometry(): THREE.PlaneGeometry {
  if (!tokenGeometry) tokenGeometry = new THREE.PlaneGeometry(1, 1);
  return tokenGeometry;
}

const ringTextures = new Map<Faction, THREE.Texture>();
function sharedRingTexture(faction: Faction): THREE.Texture {
  let texture = ringTextures.get(faction);
  if (!texture) {
    texture = factionRingTexture(FACTION_RING_SHAPE[faction]);
    ringTextures.set(faction, texture);
  }
  return texture;
}

let shadowTexture: THREE.Texture | null = null;
function sharedShadowTexture(): THREE.Texture {
  if (!shadowTexture) shadowTexture = radialTexture("rgba(0,0,0,0.85)", "rgba(0,0,0,0)");
  return shadowTexture;
}

/** 一支军队的花名册键——白曜王国或烈日帝国。 */
export type TemplateKey = `${Faction}${PieceKind}`;

/**
 * 在棋盘已经摆好之后，告知某条剪辑刚下载完成，好让在场的棋子拿到
 * 它们的攻击 / 死亡 / 步伐。`keys` 是渲染该模型的所有花名册（一方可能
 * 借用另一方的模型）。
 */
export type ClipListener = (keys: TemplateKey[], name: ClipName, clip: THREE.AnimationClip) => void;

/**
 * 单个剪辑 URL 在被放弃之前最多被重试多少次。每个请求本身已有五层
 * 重试（见 {@link loadGltf}），因此两次尝试足以撑过任何瞬时断线——
 * 而服务器根本没有的剪辑（从未生成过的操练）不会再让之后的每场战斗
 * 都白白付出一轮四次尝试的往返，节拍才得以开始。
 */
const MAX_CLIP_ATTEMPTS = 2;

/**
 * 把每个生成的模型只加载一次，将其归一化到棋盘高度，并分发廉价的
 * 克隆体。
 *
 * 每一方征募的是一整套军队*皮肤*——一个拥有自己六尊模型、剪辑、
 * 武器与配音的完整文明。所选皮肤没有的棋子种类（或下载失败的种类）
 * 会回退到另一方的模型，再不行就回退到程序化角色，因此无论网络如何，
 * 棋盘总能摆满。
 */
export class PieceFactory {
  private templates = new Map<TemplateKey, Template>();
  private loader = new GLTFLoader();
  private loaded = false;
  /** 各方当前正在征募的是哪支军队。 */
  private skins: Record<Faction, ArmySkinId> = { ...DEFAULT_ARMY_SKINS };
  /**
   * 手头模板实际是按哪些军队构建的；尚未征募任何军队时为 null。
   */
  private mustered: Record<Faction, ArmySkinId> | null = null;
  /** 一次征募正在下载时为 true。 */
  private mustering = false;
  /**
   * 把征募串行化。两次征募同时写入 {@link templates} 正是过去把一支
   * 军队劈成两半的原因——见 {@link muster}。
   */
  private queue: Promise<void> = Promise.resolve();
  /** 各花名册的剪辑 URL，让剪辑在启动很久之后仍能取到。 */
  private clipSources = new Map<TemplateKey, PieceAnimationSet>();
  /** 进行中的剪辑下载，按 URL 去重，保证任何文件不被重复拉取。 */
  private clipJobs = new Map<string, Promise<THREE.AnimationClip | null>>();
  /** 每个剪辑 URL 的失败次数，避免永远追一个不存在的文件。 */
  private clipFailures = new Map<string, number>();
  private clipListener: ClipListener | null = null;
  private warming: Promise<void> | null = null;

  get isReady(): boolean {
    return this.loaded;
  }

  /** 注册接收器，接收棋盘摆好之后落地的剪辑。 */
  onClip(listener: ClipListener | null): void {
    this.clipListener = listener;
  }

  /** 各方正在征募的军队。 */
  getSkins(): Record<Faction, ArmySkinId> {
    return { ...this.skins };
  }

  /**
   * 记录要征募的军队。
   *
   * @returns 是否需要 {@link reload} 才能兑现这些军队。在首次征募之前，
   *   即使军队有变化答案也是否：即将运行的加载会自行读取
   *   {@link skins}，而与它赛跑的 reload 正是过去让棋盘一侧拿不到
   *   剪辑的原因。
   */
  setSkins(next: Record<Faction, ArmySkinId>): boolean {
    const changed = next.w !== this.skins.w || next.b !== this.skins.b;
    this.skins = { w: next.w, b: next.b };
    if (!changed) return false;
    return this.mustered !== null || this.mustering;
  }

  /**
   * 把模型标记为过期但不释放任何资源，好让场景能在 {@link reload}
   * 释放克隆体所依据的几何体*之前*先把棋子撤下。
   */
  markStale(): void {
    this.loaded = false;
  }

  /** 征募 {@link setSkins} 所要求的军队，除非它们已经在位。 */
  load(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    return this.enqueue(() => this.muster(onProgress));
  }

  /** 丢弃当前军队，改征募 {@link setSkins} 所要求的军队。 */
  reload(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    return this.enqueue(async () => {
      this.dropArmies();
      await this.muster(onProgress);
    });
  }

  /** 把任务排在所有已入队的征募之后运行，保证它们互不重叠。 */
  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** 释放已征募的军队，并忘掉所有以它们为键的数据。 */
  private dropArmies(): void {
    this.disposeTemplates();
    this.clipJobs.clear();
    this.clipFailures.clear();
    this.clipSources.clear();
    this.warming = null;
    this.mustered = null;
  }

  /**
   * 下载两支军队并归一化所有花名册。
   *
   * 绝不允许对同一份映射同时运行两次（见 {@link enqueue}）。外壳会先
   * 记录它记住的上次访问的军队，*然后*再加载，这过去会让换军与首次
   * 下载同时开始。两次运行都写入 `templates`，于是当双方穿同一支军队
   * 时，借用的花名册会指向*第一次*运行的模型，而被借用的花名册已被
   * 第二次运行替换。两者不再共享同一个 `clips` 对象，而由于借用的
   * 花名册自己没有剪辑 URL，那一方从此再也取不到步伐、攻击或死亡
   * 剪辑：它在棋盘上滑行，杀敌而不挥击。
   */
  private async muster(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    if (this.mustered && this.mustered.w === this.skins.w && this.mustered.b === this.skins.b) {
      // 已按恰好这些军队列队完毕。
      this.loaded = true;
      onProgress?.(1, 1);
      return;
    }
    if (this.templates.size > 0) this.dropArmies();
    this.mustering = true;
    try {
      await this.download(onProgress);
      this.mustered = { ...this.skins };
      this.loaded = true;
    } finally {
      this.mustering = false;
    }
  }

  private async download(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const kinds: PieceKind[] = ["k", "q", "b", "n", "r", "p"];
    // 先加载皮肤的那一方保留自己的彩绘纹理；当双方穿同一支军队时，
    // 另一方会被重染成制服色，两支军队绝不会无法区分。
    const shared = this.skins.w === this.skins.b;
    const primary = shared ? ARMY_SKINS[this.skins.w].native : "w";
    const factions: Faction[] = primary === "b" ? ["b", "w"] : ["w", "b"];
    const jobs: { faction: Faction; kind: PieceKind }[] = [];
    for (const faction of factions) {
      if (shared && faction !== primary) continue;
      const skin = ARMY_SKINS[this.skins[faction]];
      for (const kind of kinds) {
        // 只在这支军队确实带有模型的阶位上加载花名册。
        if (!skin.animated[kind] && !skin.still[kind]) continue;
        jobs.push({ faction, kind });
      }
    }

    // 大军的武器是生成的网格而非基础几何体，而棋子在构建的瞬间就
    // 配好武器——因此武器必须与花名册*一起*下载，而不是在它们之后，
    // 否则整盘棋在余下的对局里都会举着方块火枪。
    const armJobs = armSculptWarmJobs(
      new Set(Object.values(this.skins).map((skin) => ARMY_SKINS[skin].arsenal)),
    );

    let done = 0;
    const total = jobs.length + armJobs.length;
    await Promise.all([
      ...jobs.map(async ({ faction, kind }) => {
        try {
          this.templates.set(`${faction}${kind}`, await this.loadRoster(faction, kind));
        } catch (error) {
          console.warn(`[pieces] no sculpt for "${faction}${kind}"`, error);
        } finally {
          done += 1;
          onProgress?.(done, total);
        }
      }),
      ...armJobs.map(async (job) => {
        // 永不抛错：拿不到模型时，棋子改用基础几何体拼装的武器。
        await job();
        done += 1;
        onProgress?.(done, total);
      }),
    ]);

    // 仍缺失的部分借用对方的棋子模型。
    for (const kind of kinds) {
      for (const faction of factions) {
        const key: TemplateKey = `${faction}${kind}`;
        if (this.templates.has(key)) continue;
        const lender: TemplateKey = `${faction === "w" ? "b" : "w"}${kind}`;
        const other = this.templates.get(lender);
        const arsenal = ARMY_SKINS[this.skins[faction]].arsenal;
        if (other) {
          this.templates.set(key, { ...other, ownLivery: false, arsenal: other.arsenal });
          // 借用方也以自己的键拿到出借方的剪辑 URL。两个花名册共享
          // 同一个 `clips` 对象，所以没有任何文件被拉取两次——但一个
          // 说不出自己剪辑名字的花名册，一旦这种共享丢失就再无退路；
          // 而借用的正是与对方穿同一皮肤的整支军队。
          const lent = this.clipSources.get(lender);
          if (lent) this.clipSources.set(key, lent);
        } else {
          this.templates.set(key, this.normalize(buildProceduralFigure(kind), kind, {}, false, arsenal));
        }
      }
    }
  }

  /** 军队有绑骨模型时用绑骨模型，否则用它的静态 GLB。 */
  private async loadRoster(faction: Faction, kind: PieceKind): Promise<Template> {
    const skin: ArmySkin = ARMY_SKINS[this.skins[faction]];
    const animated = skin.animated[kind];
    const still = skin.still[kind];
    if (animated) {
      try {
        const template = await this.loadAnimated(kind, animated, skin.arsenal);
        // 记下来，留待稍后按需加载的剪辑还能按名字找到。
        this.clipSources.set(`${faction}${kind}`, animated);
        return template;
      } catch (error) {
        console.warn(`[pieces] rig failed for "${faction}${kind}", using the still sculpt`, error);
      }
    }
    if (!still) throw new Error(`no sculpt url for ${faction}${kind}`);
    const gltf = await loadGltf(this.loader, still);
    return this.normalize(gltf.scene, kind, {}, true, skin.arsenal);
  }

  /**
   * 绑骨模型 + 开局所需的剪辑。这些剪辑共享自动骨架，因此可直接绑定
   * 到绑骨场景上——无需重定向。
   */
  private async loadAnimated(kind: PieceKind, set: PieceAnimationSet, arsenal: ArsenalId): Promise<Template> {
    const rigged = await loadGltf(this.loader, set.rigged, 5);
    const clips: PieceClips = {};
    await Promise.all(
      OPENING_CLIPS.map(async (name) => {
        const url = set[name];
        if (!url) return;
        const clip = await this.fetchClip(url, name);
        if (clip) clips[name] = clip;
      }),
    );
    return this.normalize(rigged.scene, kind, clips, true, arsenal);
  }

  /** 单个剪辑 GLB——排队、重试，且绝不允许向调用方抛错。 */
  private async fetchClip(url: string, name: ClipName): Promise<THREE.AnimationClip | null> {
    try {
      const gltf = await loadGltf(this.loader, url, 5);
      const source = gltf.animations[0];
      if (!source) return null;
      const clip = source.clone();
      clip.name = name;
      return clip;
    } catch (error) {
      console.warn(`[pieces] clip "${name}" unavailable (${url})`, error);
      return null;
    }
  }

  /**
   * 把开局用不到的剪辑拉进来，一波一波来、同时只开两个下载通道，
   * 按 {@link CLIP_ORDER} 顺序：先是步伐（开局第一步在棋盘摆好后几秒内
   * 就会走出），然后是攻击与死亡，最后是开火操练。每落地一条剪辑就
   * 立刻推到已经站在棋盘上的棋子身上。
   */
  warmClips(): Promise<void> {
    if (!this.warming) this.warming = this.runWarm();
    return this.warming;
  }

  private async runWarm(): Promise<void> {
    const keys = [...this.clipSources.keys()];
    for (const name of CLIP_ORDER) {
      if (OPENING_CLIPS.includes(name)) continue;
      let next = 0;
      const lane = async (): Promise<void> => {
        while (next < keys.length) {
          const key = keys[next];
          next += 1;
          await this.requestClip(key, name);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, keys.length) }, lane));
    }
  }

  /**
   * 保证花名册在游戏需要之前拿到某条剪辑。吃子会在这里点名索取攻击
   * 与死亡剪辑，于是开局突发期间被丢弃的请求只会让战斗迟滞一瞬，
   * 而不是丢掉动画。
   *
   * @returns 该剪辑现在是否已绑定到该花名册
   */
  async ensureClip(faction: Faction, kind: PieceKind, name: ClipName): Promise<boolean> {
    return (await this.requestClip(`${faction}${kind}`, name)) !== null;
  }

  private requestClip(key: TemplateKey, name: ClipName): Promise<THREE.AnimationClip | null> {
    const template = this.templates.get(key);
    const existing = template?.clips[name];
    if (existing) return Promise.resolve(existing);
    const url = template ? this.clipUrl(template, key, name) : undefined;
    if (!template || !url) return Promise.resolve(null);

    const running = this.clipJobs.get(url);
    // 为另一个花名册启动的下载也必须落到这一个上：请求同一文件的
    // 两个花名册并不总是共享同一个 `clips` 对象。
    if (running) return running.then((clip) => (clip ? this.bindClip(url, name, clip) : null));
    if ((this.clipFailures.get(url) ?? 0) >= MAX_CLIP_ATTEMPTS) return Promise.resolve(null);

    const job = this.fetchClip(url, name).then((clip) => {
      if (!clip) {
        // 不记为永久失败：下一次吃子会再获得一次尝试，直至
        // MAX_CLIP_ATTEMPTS 次。
        this.clipJobs.delete(url);
        this.clipFailures.set(url, (this.clipFailures.get(url) ?? 0) + 1);
        return null;
      }
      return this.bindClip(url, name, clip);
    });
    this.clipJobs.set(url, job);
    return job;
  }

  /**
   * 把下载完成的剪辑绑定到**每一个**在等待该 URL 的花名册上，并把
   * 它们全部报告给监听器，这样就不会有棋子仅仅因为别的花名册先请求
   * 同一文件而拿不到步伐。
   */
  private bindClip(url: string, name: ClipName, clip: THREE.AnimationClip): THREE.AnimationClip {
    const keys: TemplateKey[] = [];
    for (const [key, entry] of this.templates) {
      // 共享同一个 `clips` 对象的花名册由单次写入填满。
      if (entry.clips[name] === clip) {
        keys.push(key);
        continue;
      }
      if (entry.clips[name] || this.clipUrl(entry, key, name) !== url) continue;
      entry.clips[name] = clip;
      keys.push(key);
    }
    if (keys.length > 0) this.clipListener?.(keys, name, clip);
    return clip;
  }

  /**
   * 花名册的剪辑 URL。没有自己模型的一方渲染的是另一支军队的模板，
   * 因此 URL 要在拥有它的那个花名册名下查找。
   */
  private clipUrl(template: Template, key: TemplateKey, name: ClipName): string | undefined {
    const own = this.clipSources.get(key)?.[name];
    if (own) return own;
    for (const shared of this.sharingKeys(template)) {
      const url = this.clipSources.get(shared)?.[name];
      if (url) return url;
    }
    return undefined;
  }

  /** 渲染此模板的所有花名册键。 */
  private sharingKeys(template: Template): TemplateKey[] {
    const keys: TemplateKey[] = [];
    for (const [key, entry] of this.templates) {
      if (entry.clips === template.clips) keys.push(key);
    }
    return keys;
  }

  private normalize(
    scene: THREE.Object3D,
    kind: PieceKind,
    clips: PieceClips,
    ownLivery: boolean,
    arsenal: ArsenalId,
  ): Template {
    const box = measureModel(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = Math.max(0.0001, size.y);
    const scale = PIECE_HEIGHT[kind] / height;

    const centre = new THREE.Vector3();
    box.getCenter(centre);
    const offset = new THREE.Vector3(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

    let skinned = false;
    scene.traverse((node) => {
      if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    });

    return { scene, scale, offset, skinned, clips, unit: height, baseY: box.min.y, ownLivery, arsenal };
  }

  create(kind: PieceKind, color: Faction, options: PieceVisualOptions): PieceView {
    const template = this.templates.get(`${color}${kind}`);
    if (!template) throw new Error(`piece template "${color}${kind}" not loaded`);

    // 蒙皮网格绝不能在实例之间共享同一副骨架。
    const model = template.skinned ? SkeletonUtils.clone(template.scene) : template.scene.clone(true);
    model.scale.setScalar(template.scale);
    model.position.copy(template.offset);

    const view = new PieceView(
      kind,
      color,
      model,
      options,
      template.clips,
      template.unit,
      template.baseY,
      template.ownLivery,
      template.arsenal,
    );
    view.setFacing(new THREE.Vector3(0, 0, color === "w" ? -1 : 1));
    return view;
  }

  dispose(): void {
    this.clipListener = null;
    this.clipJobs.clear();
    this.clipFailures.clear();
    this.clipSources.clear();
    this.mustered = null;
    this.disposeTemplates();
  }

  /**
   * 释放模型。克隆体共享其模板的几何体，因此运行此方法前所有在场
   * 棋子必须已清除（见 {@link markStale}）。
   */
  private disposeTemplates(): void {
    this.loaded = false;
    const seen = new Set<THREE.Object3D>();
    for (const template of this.templates.values()) {
      // 双方可能渲染同一个模型；只释放一次。
      if (seen.has(template.scene)) continue;
      seen.add(template.scene);
      template.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      });
    }
    this.templates.clear();
  }
}

/**
 * 仅在生成的模型下载失败时使用的、由基础几何体拼成的人形——头、
 * 躯干、手臂，加上按棋子种类区分的轮廓，保证游戏始终可玩。
 */
export function buildProceduralFigure(kind: PieceKind): THREE.Object3D {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xe8e0cf, roughness: 0.5, metalness: 0.1 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.12, 20), stone);
  base.position.y = 0.06;
  group.add(base);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.44, 6, 14), stone);
  body.position.y = 0.48;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 14), stone);
  head.position.y = 0.88;
  group.add(head);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 4, 8), stone);
    arm.position.set(side * 0.23, 0.55, 0);
    arm.rotation.z = side * 0.24;
    group.add(arm);
  }

  if (kind === "k" || kind === "q") {
    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.11, kind === "k" ? 0.16 : 0.1, 8, 1, true),
      stone,
    );
    crown.position.y = kind === "k" ? 1.03 : 0.99;
    group.add(crown);
  }
  if (kind === "b") {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 12), stone);
    hood.position.y = 0.94;
    group.add(hood);
  }
  if (kind === "r") {
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 8), stone);
    helm.position.y = 1;
    group.add(helm);
  }
  if (kind === "n") {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 8), stone);
    plume.position.set(0, 1.04, -0.02);
    group.add(plume);
  }
  return group;
}
