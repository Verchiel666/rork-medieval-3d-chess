/**
 * 弹丸命中时留下的东西。
 *
 * 在此之前，一枪远端击杀的表现和一记剑砍是同一套暖色精灵爆发：
 * 一道闪光、一团烟雾、几个发光点。这读起来像*魔法*，不像冲击——
 * 没有任何元素说明一块铅丸刚刚以每秒三百米的速度穿过了躯体。
 * 这个模块就是答案，而且它刻意用几何体而不是公告板来构建，
 * 因为这一刻的全部意义在于：有东西**碎掉了**。
 *
 * 四件事在同一帧触发，按眼睛读取的顺序排列：
 *
 * 1. **冲击环**——一个垂直于弹道、在命中表面骤然展开的光盘。
 *    它是唯一不物理的部分，存在的意义是告诉眼睛弹丸*从哪里*钻进身体。
 * 2. **火花**——真正拉伸的几何体，而不是点：每颗火花是一片沿自身速度
 *    取向的薄片，飞出一道会转弯的亮痕。它们以锥形*向后*喷向射手——
 *    真实的崩落碎屑就是这样——在生命周期里从白炽冷到橙再到暗红，
 *    幸存下来的还会贴着石板地面乱窜。
 * 3. **碎片**——受害者材质崩下来的渣：王国雕像上是大理石屑，太阳帝国
 *    黑曜石上是玻璃质的黑色薄片，胸甲上是钢质崩屑，大军团军服上是
 *    羊毛和镀金饰带。它们绕自己的轴翻滚，在棋盘上弹一两下，然后落定。
 * 4. **尘雾**——调用方通过特效系统叠在上层的细雾；本模块只负责
 *    报告该用什么颜色。
 *
 * 所有这些都跑在调用方的补间时钟上，装在两个实例化绘制调用里
 * （火花一个、碎片一个），所以一整轮交火对帧循环没有任何
 * 永久开销，也不占用对象池。
 */

import * as THREE from "three";

import type { SpellLight } from "./spells";
import { shockwaveTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";

/** 弹丸抵达时碰到的东西。 */
export type ImpactBody =
  /** 王国雕凿大理石：浅色碎屑、明亮尘雾、底下铁板溅出的火花。 */
  | "marble"
  /** 太阳帝国黑曜石与翡翠：玻璃质黑色薄片，硬而亮的碎裂。 */
  | "obsidian"
  /** 胸甲或头盔：钢质崩屑加一蓬火花，几乎没有尘雾。 */
  | "plate"
  /** 拿氏羊毛、皮革与镀金饰带：深色碎布条、尘雾、火花很少。 */
  | "uniform"
  /** 大厅地面——是跳弹而不是击杀。 */
  | "flagstone";

interface BodyRecipe {
  /** 碎片颜色，每片随机从中抽取。 */
  fragments: number[];
  fragmentRoughness: number;
  fragmentMetalness: number;
  /** 威力为 1 时抛出的碎片数。 */
  fragmentCount: number;
  /** 威力为 1 时的碎片尺寸（世界单位）。 */
  fragmentSize: number;
  /** 碎片被拉伸成薄片的程度（1 = 接近方块）。 */
  fragmentSliver: number;
  /** 碎片在石板上的活泼程度。0 = 落地即死。 */
  bounce: number;
  /** 威力为 1 时抛出的火花数。 */
  sparkCount: number;
  /** 火花飞出时的速度，米/秒。 */
  sparkSpeed: number;
  sparkLife: number;
  /** 第一帧的炽热颜色，以及它冷却到的颜色。 */
  sparkHot: number;
  sparkCool: number;
  /** 冲击环及其投出光的颜色。 */
  ring: number;
  /** 调用方应叠在上层的细雾颜色。 */
  dust: number;
  /** 崩落锥张开的角度（弧度）。越紧 = 弹孔越干净。 */
  spread: number;
}

/**
 * 每种材质一套配方。数值按硬度排序：黑曜石抛出最多碎片、
 * 散布最宽，因为它是*碎裂*；羊毛抛出最少、最慢，因为它吸能。
 */
const BODIES: Record<ImpactBody, BodyRecipe> = {
  marble: {
    fragments: [0xe8e2d4, 0xd6cfbe, 0xc2baa6, 0x9d9482],
    fragmentRoughness: 0.82,
    fragmentMetalness: 0.05,
    fragmentCount: 16,
    fragmentSize: 0.06,
    fragmentSliver: 2.1,
    bounce: 0.38,
    sparkCount: 14,
    sparkSpeed: 7,
    sparkLife: 0.42,
    sparkHot: 0xfff3d2,
    sparkCool: 0xff5a1c,
    ring: 0xffe6bd,
    dust: 0xd8d0be,
    spread: 1.05,
  },
  obsidian: {
    // 火山玻璃：近黑色，带一点翡翠斑和炽热的青铜边。
    fragments: [0x1b1a20, 0x2b2933, 0x123d33, 0x8c6a2f],
    fragmentRoughness: 0.24,
    fragmentMetalness: 0.32,
    fragmentCount: 22,
    fragmentSize: 0.052,
    // 玻璃不成块崩、而是成片剥：又长又薄、刀刃般的薄片。
    fragmentSliver: 3.4,
    bounce: 0.52,
    sparkCount: 18,
    sparkSpeed: 8.4,
    sparkLife: 0.36,
    sparkHot: 0xfffaf0,
    sparkCool: 0x59f0c0,
    ring: 0xa8ffe0,
    dust: 0x4a4a52,
    spread: 1.25,
  },
  plate: {
    fragments: [0x8f959d, 0x6a707a, 0x4a4f57, 0xb9a06a],
    fragmentRoughness: 0.34,
    fragmentMetalness: 0.85,
    fragmentCount: 11,
    fragmentSize: 0.045,
    fragmentSliver: 2.6,
    bounce: 0.6,
    // 钢碰钢是这块棋盘上最亮的事。
    sparkCount: 30,
    sparkSpeed: 10.5,
    sparkLife: 0.5,
    sparkHot: 0xffffff,
    sparkCool: 0xff3c08,
    ring: 0xfff0d0,
    dust: 0x77736c,
    spread: 0.82,
  },
  uniform: {
    // 藏青羊毛、本色皮革、镀金饰带，还有军帽牌上的黄铜。
    fragments: [0x1d2a4a, 0x2b3a5e, 0x6b4a2c, 0xb08a3c, 0x8e1f22],
    fragmentRoughness: 0.78,
    fragmentMetalness: 0.18,
    fragmentCount: 14,
    fragmentSize: 0.05,
    fragmentSliver: 2.8,
    // 布料和皮革掉在哪就躺在哪。
    bounce: 0.16,
    sparkCount: 7,
    sparkSpeed: 6,
    sparkLife: 0.3,
    sparkHot: 0xffe9b6,
    sparkCool: 0xff4a10,
    ring: 0xffd79a,
    dust: 0x6d6355,
    spread: 1.4,
  },
  flagstone: {
    fragments: [0x9a917f, 0x7d7466, 0x5d564b],
    fragmentRoughness: 0.9,
    fragmentMetalness: 0.04,
    fragmentCount: 13,
    fragmentSize: 0.055,
    fragmentSliver: 1.9,
    bounce: 0.44,
    sparkCount: 22,
    sparkSpeed: 9,
    sparkLife: 0.55,
    sparkHot: 0xfff6dd,
    sparkCool: 0xff4708,
    ring: 0xffca8a,
    dust: 0xa79d8a,
    spread: 1.5,
  },
};

/** 调用方为自己的烟雾该用的雾色，盖在命中点上。 */
export function impactDust(body: ImpactBody): number {
  return BODIES[body].dust;
}

// ------------------------------------------------------------------ 模具

const FORWARD = new THREE.Vector3(0, 0, 1);

let chipGeometry: THREE.BufferGeometry | null = null;
let sliverGeometry: THREE.BufferGeometry | null = null;
let ringGeometry: THREE.PlaneGeometry | null = null;
let ringMap: THREE.CanvasTexture | null = null;

/**
 * 一块崩开的碎片：压瘪的四面体。一块在镜头前翻滚半秒的碎片
 * 能展示的只有四个面，而不规则的轮廓正是让一片残骸
 * 看起来不像撒了一把骰子的关键。
 */
function sharedChipGeometry(): THREE.BufferGeometry {
  if (!chipGeometry) {
    const chip = new THREE.TetrahedronGeometry(0.5, 0);
    const position = chip.getAttribute("position") as THREE.BufferAttribute;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      // 刻意压得失真，这样没有两个面会以同样角度接住火把光。
      vertex.set(vertex.x * 1.15, vertex.y * 0.72, vertex.z * 0.94);
      position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    chip.computeVertexNormals();
    chipGeometry = chip;
  }
  return chipGeometry;
}

/**
 * 一颗火花的躯体：沿 +Z 方向一单位长的四棱薄片，这样它可以
 * 指向自己的速度方向、并按飞行快慢缩放。用四个面而不是一个
 * 平面，意味着它侧对镜头时也永远不会消失。
 */
function sharedSliverGeometry(): THREE.BufferGeometry {
  if (!sliverGeometry) {
    const sliver = new THREE.CylinderGeometry(0.5, 0.16, 1, 4, 1, false);
    sliver.rotateX(Math.PI / 2);
    sliverGeometry = sliver;
  }
  return sliverGeometry;
}

function sharedRingGeometry(): THREE.PlaneGeometry {
  if (!ringGeometry) ringGeometry = new THREE.PlaneGeometry(1, 1);
  return ringGeometry;
}

function sharedRingMap(): THREE.CanvasTexture {
  if (!ringMap) ringMap = shockwaveTexture();
  return ringMap;
}

/** 释放共享模具与贴图（场景拆除时调用）。 */
export function disposeShatterAssets(): void {
  chipGeometry?.dispose();
  sliverGeometry?.dispose();
  ringGeometry?.dispose();
  ringMap?.dispose();
  chipGeometry = null;
  sliverGeometry = null;
  ringGeometry = null;
  ringMap = null;
}

// ------------------------------------------------------------------ 散布

/**
 * 围绕 `axis` 的锥体内取一个方向。对余弦而不是角度采样，
 * 让散布在锥顶上均匀分布、而不是挤在轴线上——这正是
 * 崩落碎屑和烟花的区别。
 */
function inCone(axis: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
  const cosLimit = Math.cos(Math.min(Math.PI, spread));
  const z = cosLimit + Math.random() * (1 - cosLimit);
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = Math.random() * Math.PI * 2;
  out.set(Math.cos(phi) * radius, Math.sin(phi) * radius, z);
  return out.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(FORWARD, axis));
}

/** 受害者身上翻滚的一枚碎片。 */
interface Fragment {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  quaternion: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  scale: THREE.Vector3;
  life: number;
  maxLife: number;
  /** 停止移动后置位，此后不再参与积分。 */
  resting: boolean;
}

/** 一颗火花：几何体沿它的飞行方向拉伸。 */
interface Spark {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  thickness: number;
  life: number;
  maxLife: number;
  /** 各自的闪烁相位——火花不是平滑淡出，而是明灭摇曳。 */
  flicker: number;
}

export interface ShatterOptions {
  /** 弹丸击中了什么，这决定了残骸的一切。 */
  body: ImpactBody;
  /** 弹丸抵达瞬间飞行方向上的单位向量。 */
  along: THREE.Vector3;
  /**
   * 命中的力度。1 是打进人体的火枪弹；手枪大约 0.6，
   * 六磅实心弹超过 2。数量、速度、尺寸一起随它缩放，
   * 这样各档威力才能保持诚实的排序。
   */
  power: number;
  /** 棋盘表面高度，碎片和火花要在它上面弹跳。 */
  floor: number;
  /**
   * 弹丸穿透了身体而不是留在体内，因此除了入口还有出口：
   * 顺着弹丸原方向再喷一锥更宽、更慢的残骸。
   */
  through?: boolean;
  /** 实例数的硬上限，来自图形预设。 */
  budget: number;
  /** 从场景光源池借来的一个槽位，传 null 则无光照运行。 */
  light?: SpellLight | null;
}

/**
 * 在弹丸抵达的那一帧把躯体崩开，并驱动残骸动画
 * 直到最后一块碎片停下。
 *
 * 残骸散尽时兑现（resolve），所以调用方可以用 `void` 发射它、
 * 直接接死亡节拍——碎裂刻意比顿帧活得更久，
 * 躯体倒下时它还在缓缓落定。
 */
export async function spawnImpactShatter(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: ShatterOptions,
): Promise<void> {
  const recipe = BODIES[options.body];
  const power = Math.max(0.2, options.power);
  const budget = Math.max(6, options.budget);

  // 所有东西都从弹丸打出的洞口向后喷出——崩屑是从被击中的
  // 那一面崩落的，而不是从背面。
  const back = options.along.clone().negate().normalize();
  const group = new THREE.Group();
  group.name = `shatter_${options.body}`;
  scene.add(group);

  // ---- 冲击环：弹丸钻进身体的位置 --------------------------------------
  const ringMaterial = new THREE.MeshBasicMaterial({
    map: sharedRingMap(),
    color: recipe.ring,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(sharedRingGeometry(), ringMaterial);
  ring.quaternion.setFromUnitVectors(FORWARD, back);
  ring.position.copy(at).addScaledVector(back, 0.02);
  ring.renderOrder = 9;
  ring.frustumCulled = false;
  const ringSize = 0.3 + power * 0.42;
  ring.scale.setScalar(ringSize * 0.25);
  group.add(ring);

  // ---- 火花 ------------------------------------------------------------
  const sparkWanted = Math.round(recipe.sparkCount * (0.55 + power * 0.55));
  const sparkTotal = Math.min(sparkWanted, Math.round(budget * 0.6));
  const sparks: Spark[] = [];
  const scratch = new THREE.Vector3();
  for (let i = 0; i < sparkTotal; i += 1) {
    const direction = inCone(back, recipe.spread, scratch.clone());
    const speed = recipe.sparkSpeed * (0.35 + Math.random() * 0.95) * (0.7 + power * 0.4);
    sparks.push({
      position: at.clone().addScaledVector(direction, 0.02 + Math.random() * 0.04),
      velocity: direction.multiplyScalar(speed),
      thickness: (0.006 + Math.random() * 0.009) * (0.8 + power * 0.3),
      life: 0,
      // 总有一小撮火花活得比别的久、贴着石板乱窜；
      // 而均匀分布的寿命会让整蓬火花像拉闸一样整齐熄灭。
      maxLife: recipe.sparkLife * (Math.random() > 0.82 ? 1.7 + Math.random() : 0.4 + Math.random() * 0.7),
      flicker: Math.random() * Math.PI * 2,
    });
  }

  const sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 1,
  });
  const sparkMesh =
    sparks.length > 0 ? new THREE.InstancedMesh(sharedSliverGeometry(), sparkMaterial, sparks.length) : null;
  if (sparkMesh) {
    sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    sparkMesh.frustumCulled = false;
    sparkMesh.renderOrder = 8;
    // 逐实例颜色是让每颗火花按自己的时钟冷却的唯一办法；
    // 在叠加混合下，把颜色压向黑色也正是它死去的方式。
    sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sparks.length * 3), 3);
    sparkMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(sparkMesh);
  }

  // ---- 碎片 ------------------------------------------------------------
  const fragmentWanted = Math.round(recipe.fragmentCount * (0.5 + power * 0.6));
  const fragmentTotal = Math.min(fragmentWanted, Math.round(budget * 0.45));
  const fragments: Fragment[] = [];
  for (let i = 0; i < fragmentTotal; i += 1) {
    // 入口崩屑又紧又快；有出口时，出口那侧抛出更多质量、
    // 速度更慢、角度更宽。
    const exit = options.through === true && Math.random() > 0.55;
    const axis = exit ? options.along : back;
    const direction = inCone(axis, recipe.spread * (exit ? 1.5 : 1), new THREE.Vector3());
    const speed = (exit ? 2.1 : 3.4) * (0.3 + Math.random() * 1.1) * (0.65 + power * 0.5);
    const bulk = recipe.fragmentSize * (0.45 + Math.random() * 0.95) * (0.7 + power * 0.45);
    fragments.push({
      position: at.clone().addScaledVector(direction, 0.03),
      velocity: direction.multiplyScalar(speed).addScaledVector(new THREE.Vector3(0, 1, 0), 0.6 + Math.random()),
      quaternion: new THREE.Quaternion().random(),
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spin: (Math.random() > 0.5 ? 1 : -1) * (7 + Math.random() * 16),
      scale: new THREE.Vector3(bulk, bulk * (0.4 + Math.random() * 0.4), bulk * recipe.fragmentSliver * (0.6 + Math.random() * 0.7)),
      life: 0,
      maxLife: 1.1 + Math.random() * 0.9,
      resting: false,
    });
  }

  const fragmentMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: recipe.fragmentRoughness,
    metalness: recipe.fragmentMetalness,
    // 一片穿过昏暗大厅的碎片，着色需要一个下限兜底，
    // 否则它读起来像画面里的破洞而不是残骸。
    emissive: new THREE.Color(0x14161a),
    emissiveIntensity: 1,
  });
  const fragmentMesh =
    fragments.length > 0
      ? new THREE.InstancedMesh(sharedChipGeometry(), fragmentMaterial, fragments.length)
      : null;
  if (fragmentMesh) {
    fragmentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fragmentMesh.frustumCulled = false;
    fragmentMesh.castShadow = false;
    const colours = new Float32Array(fragments.length * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < fragments.length; i += 1) {
      tint.setHex(recipe.fragments[Math.floor(Math.random() * recipe.fragments.length)]);
      // 加一点明度抖动，让同材质的一打碎片
      // 读起来仍然是一打不同的碎块。
      tint.multiplyScalar(0.78 + Math.random() * 0.44);
      colours[i * 3] = tint.r;
      colours[i * 3 + 1] = tint.g;
      colours[i * 3 + 2] = tint.b;
    }
    fragmentMesh.instanceColor = new THREE.InstancedBufferAttribute(colours, 3);
    group.add(fragmentMesh);
  }

  // ---- 运动中的残骸 -----------------------------------------------------
  const life = Math.max(
    0.45,
    ...sparks.map((spark) => spark.maxLife),
    ...fragments.map((fragment) => fragment.maxLife),
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const hot = new THREE.Color(recipe.sparkHot);
  const cool = new THREE.Color(recipe.sparkCool);
  const spin = new THREE.Quaternion();
  let last = 0;

  try {
    await tweens.to({
      duration: life,
      easing: Ease.linear,
      onUpdate: (t) => {
        const delta = Math.max(0, Math.min(0.05, (t - last) * life));
        last = t;

        // 冲击环几乎还没开始就结束了——它是一次判读，不是一个特效。
        const ringLife = Math.min(1, t * life / 0.18);
        ringMaterial.opacity = Math.pow(1 - ringLife, 1.7);
        ring.scale.setScalar(ringSize * (0.25 + ringLife * 1.15));

        if (sparkMesh) {
          const attribute = sparkMesh.instanceColor as THREE.InstancedBufferAttribute;
          for (let i = 0; i < sparks.length; i += 1) {
            const spark = sparks[i];
            spark.life += delta;
            const age = Math.min(1, spark.life / spark.maxLife);
            if (age >= 1) {
              // 叠加混合下的黑色不可见，无需再挪动实例列表。
              matrix.makeScale(0, 0, 0);
              sparkMesh.setMatrixAt(i, matrix);
              attribute.setXYZ(i, 0, 0, 0);
              continue;
            }
            // 火花又小又烫：在空气里减速很猛，下坠很快。
            spark.velocity.multiplyScalar(Math.max(0, 1 - delta * 3.2));
            spark.velocity.y -= 11 * delta;
            spark.position.addScaledVector(spark.velocity, delta);
            if (spark.position.y < options.floor) {
              // 贴着石板乱窜：保住前冲，丢掉升力。
              spark.position.y = options.floor + 0.002;
              spark.velocity.y = Math.abs(spark.velocity.y) * 0.32;
              spark.velocity.x *= 0.7;
              spark.velocity.z *= 0.7;
            }
            const speed = spark.velocity.length();
            if (speed < 1e-4) {
              matrix.makeScale(0, 0, 0);
              sparkMesh.setMatrixAt(i, matrix);
              attribute.setXYZ(i, 0, 0, 0);
              continue;
            }
            scratch.copy(spark.velocity).divideScalar(speed);
            quaternion.setFromUnitVectors(FORWARD, scratch);
            // 亮痕*就是*运动本身：长度跟随速度，快时拖出
            // 一条长线，力竭后缩成一个点。
            const length = Math.min(0.42, 0.012 + speed * 0.02);
            scale.set(spark.thickness, spark.thickness, length);
            matrix.compose(spark.position, quaternion, scale);
            sparkMesh.setMatrixAt(i, matrix);

            // 从白炽到暗红，冷却中明灭摇曳。
            colour.copy(hot).lerp(cool, Math.pow(age, 0.55));
            const gutter = 0.72 + 0.28 * Math.sin(spark.flicker + spark.life * 47);
            colour.multiplyScalar(Math.pow(1 - age, 1.35) * gutter * 2.2);
            attribute.setXYZ(i, colour.r, colour.g, colour.b);
          }
          sparkMesh.instanceMatrix.needsUpdate = true;
          attribute.needsUpdate = true;
        }

        if (fragmentMesh) {
          for (let i = 0; i < fragments.length; i += 1) {
            const fragment = fragments[i];
            fragment.life += delta;
            const age = Math.min(1, fragment.life / fragment.maxLife);
            if (!fragment.resting) {
              fragment.velocity.multiplyScalar(Math.max(0, 1 - delta * 0.9));
              fragment.velocity.y -= 15 * delta;
              fragment.position.addScaledVector(fragment.velocity, delta);
              spin.setFromAxisAngle(fragment.axis, fragment.spin * delta);
              fragment.quaternion.premultiply(spin);
              if (fragment.position.y < options.floor + fragment.scale.y * 0.5) {
                fragment.position.y = options.floor + fragment.scale.y * 0.5;
                if (Math.abs(fragment.velocity.y) < 0.45) {
                  // 让它躺在石板上静止，而不是不停抖动。
                  fragment.resting = true;
                  fragment.velocity.set(0, 0, 0);
                } else {
                  fragment.velocity.y = Math.abs(fragment.velocity.y) * recipe.bounce;
                  // 切线方向加摩擦，翻滚也一并被削掉。
                  fragment.velocity.x *= 0.62;
                  fragment.velocity.z *= 0.62;
                  fragment.spin *= 0.55;
                }
              }
            }
            // 全程保持原尺寸，在寿命最后四分之一沉下去，
            // 这样棋盘上永远不会留下一地残渣。
            const shrink = age < 0.72 ? 1 : Math.pow(1 - (age - 0.72) / 0.28, 0.8);
            scale.copy(fragment.scale).multiplyScalar(shrink);
            matrix.compose(fragment.position, fragment.quaternion, scale);
            fragmentMesh.setMatrixAt(i, matrix);
          }
          fragmentMesh.instanceMatrix.needsUpdate = true;
        }

        // 弹孔本身也会短暂投光：第一帧最亮，
        // 五分之一秒内熄灭，和所有真实的火花雨一样。
        options.light?.set(at, Math.pow(1 - ringLife, 2) * 14 * power);
      },
    });
  } finally {
    options.light?.release();
    ringMaterial.dispose();
    sparkMaterial.dispose();
    fragmentMaterial.dispose();
    sparkMesh?.dispose();
    fragmentMesh?.dispose();
    group.removeFromParent();
    group.clear();
  }
}
