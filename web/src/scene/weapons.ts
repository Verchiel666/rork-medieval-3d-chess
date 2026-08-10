/**
 * 生成的战士们手中的武器。
 *
 * Meshy 棋子被刻意做成空手（手持道具会破坏自动绑定），所以每一枚棋子
 * 都会在手骨上挂一件武器。两个来源供给那只拳头：
 *
 *  - **基础几何体**，在此为每件武器按"棋子高度 = 1"设计一次并缓存。这是
 *    中世纪阵营和太阳帝国武器的正确答案——它们的原型无人可考——也是其他
 *    一切的兜底方案。
 *  - 实物的**生成雕塑**，用于法兰西军团——查尔维尔火枪和 An XI 胸甲骑兵
 *    剑是有据可查的实物，而盒子和圆柱拼出的版本读作玩具。见
 *    `scene/armoury.ts`，它把每个下载的网格装进与基础几何体相同的本地
 *    坐标系，所以下游的一切（握把、枪口、姿势驱动的持握）都不因替换而
 *    改变。
 *
 * 无论哪种方式，每个实例都按棋子自身高度缩放道具，并抵消骨骼累积的
 * 缩放/旋转，让武器在任何姿势下都稳坐拳中。
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { ArsenalId } from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";
import { armSculpt, hasArmSculpt, instanceArmSculpt, warmArmSculpt } from "./armoury";

type WeaponRole =
  | "steel"
  | "gold"
  | "wood"
  | "leather"
  | "cloth"
  | "gem"
  /** 火山玻璃——太阳帝国的锋刃。 */
  | "obsidian"
  /** 抛光翡翠与绿松石镶嵌。 */
  | "jade"
  /** 染色的格查尔鸟与金刚鹦鹉羽毛。 */
  | "feather"
  /** 雕刻的玄武岩锤头。 */
  | "stone";

interface Part {
  geometry: THREE.BufferGeometry;
  role: WeaponRole;
}

export type WeaponId =
  | "greatsword"
  | "scepter"
  | "crystalStaff"
  | "warhammer"
  | "longsword"
  | "spear"
  | "roundShield"
  | "heaterShield"
  | "towerShield"
  // 太阳帝国
  | "royalMacuahuitl"
  | "macuahuitl"
  | "tepoztopilli"
  | "serpentStaff"
  | "sunScepter"
  | "stoneMaul"
  | "chimalli"
  | "greatChimalli"
  // 法兰西军团
  | "imperialSabre"
  | "marengoSword"
  | "marksmanRifle"
  | "cavalrySabre"
  | "musketBayonet"
  | "officerPistol"
  | "fieldCannon";

interface WeaponSpec {
  build: () => Part[];
  /** 从道具自身原点到拳头的距离，以棋子高度计。 */
  grip: number;
  /**
   * 静置方向，以"身体"轴表示：x = 持握侧远离脊柱，y = 向上，z = 棋子
   * 正前方。挂载时按左右手镜像。
   */
  aim: THREE.Vector3;
  /** 从腕关节的偏移，坐标轴与 `aim` 相同，以棋子高度计。 */
  offset: THREE.Vector3;
  /** 盾牌的正面（+Z）沿 `aim` 定向；杆状武器的长度（+Y）沿 `aim` 定向。 */
  shield?: boolean;
  /**
   * 弯刃武器：绕自身长度的滚转是肉眼可见的，所以它必须跟随拳头而不是
   * 一次写死（见 {@link EDGED_FLIP}）。
   *
   * 只值得设在带*弧度*的剑刃上。直剑滚转半圈看起来一模一样；弯刀滚转
   * 半圈就成了一把镰刀。
   */
  edged?: boolean;
  /** 盾牌的半高，用于让盾沿不蹭到地面。 */
  half?: number;
  /**
   * 道具自身设计坐标系中功能端的高度——法杖爪中的水晶、权杖上的宝石。
   * 施法者的火焰正是从这一点发出，从实时姿势中读出。
   */
  focus?: number;
  /**
   * 道具自身设计坐标系中的枪口。枪械的火焰、烟雾和弹丸正是从这一点
   * 发出，从实时姿势中读出——所以无论手臂把枪抡到哪里，弹丸都从枪管
   * 离开。
   */
  muzzle?: THREE.Vector3;
  /**
   * 姿势驱动的持握，用于不能保持固定静置角度的道具。
   *
   * 枪械的全部意义在于枪管随手臂指向任何方向，所以固定的身体空间角度
   * 会让它在瞄准动画里依然竖直立着：
   *  - `"longArm"` —— 指向目标方向，由两只拳头提供倾斜和俯仰
   *    （见 {@link LONG_ARM_CANT}）。
   *  - `"sidearm"` —— 轴线跟随前臂，向棋子正前方抬起，让垂下的手臂读作
   *    低持的手枪，而不是脱手掉落。
   *
   * 每帧从实时骨骼重新求解——见 {@link AttachedArms.align}。
   */
  hold?: "longArm" | "sidearm";
  /**
   * 完全不手持：拖在棋子身边（炮兵的火炮）。拖曳道具以身体轴设计——
   * 前方 +Z、上方 +Y、轮子在 ±X——并挂在雕塑根部而不是手骨上，这样炮组
   * 人员的手臂可以挥动而不会拖着炮架一起转。
   */
  towed?: boolean;
  /** 拖曳道具的停靠位置，以棋子高度计：+x 是持握侧。 */
  park?: THREE.Vector3;
  /**
   * 拖曳道具相对拖拽它的棋子的尺寸，1 = 设计尺寸。
   *
   * 炮架是有真实尺寸的真实物体，它必须看起来相称的参照物是*站在旁边的
   * 炮手*。一门真正的格里博瓦尔 6 磅炮的轮子约有人高的五分之四，炮身比
   * 人还长；在旧的 0.85 下，这门炮的轮子只有卫兵身高的三分之一，整个
   * 炮兵读作一名军官推着玩具。
   */
  bulk?: number;
  /**
   * 拖曳道具的横向压缩，只施加在它自己的 X 轴（轮轴）上。
   *
   * 火炮不能简单地整体放大到看着合适：一格棋盘是 {@link TILE} 宽，均匀
   * 放大的炮架会把轮子压到相邻棋子的格子上。轮轴是唯一可以牺牲而不被
   * 眼睛察觉的轴——轮子立在 YZ 平面里，收窄轮距只会让轮胎变薄，永远不
   * 会把圆轮变成椭圆。所以火炮是从轮距里省出它的高度和长度。
   */
  track?: number;
}

// ------------------------------------------------------------------ 几何体

/**
 * 扁平菱形截面剑身。
 *
 * `base` 是无刃根部的起点——永远在剑柄*上方*，否则剑身会向下穿过握把
 * 长出来，护手最终落在剑身中段。
 */
function blade(
  length: number,
  width: number,
  thickness: number,
  taper: number,
  base: number,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.5 * taper, 0.5, length, 4, 1);
  geometry.rotateY(Math.PI / 4);
  geometry.scale(width, 1, thickness);
  geometry.translate(0, base + length / 2, 0);
  return geometry;
}

/** 叶形矛头：渐细的尖下带一段变宽的肩部。 */
function leafHead(length: number, width: number, thickness: number, base: number): THREE.BufferGeometry {
  const shoulder = new THREE.CylinderGeometry(0.5, 0.14, length * 0.34, 4, 1);
  shoulder.rotateY(Math.PI / 4);
  shoulder.scale(width, 1, thickness);
  shoulder.translate(0, base + length * 0.17, 0);
  const point = new THREE.CylinderGeometry(0.02, 0.5, length * 0.66, 4, 1);
  point.rotateY(Math.PI / 4);
  point.scale(width, 1, thickness);
  point.translate(0, base + length * 0.34 + length * 0.33, 0);
  const merged = mergeGeometries([shoulder.toNonIndexed(), point.toNonIndexed()], false);
  shoulder.dispose();
  point.dispose();
  return merged ?? new THREE.BufferGeometry();
}

function shaft(length: number, radius: number, topRadius = radius * 0.9): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(topRadius, radius, length, 10, 1);
  geometry.translate(0, length / 2, 0);
  return geometry;
}

function box(w: number, h: number, d: number, y: number, x = 0, z = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function ball(radius: number, y: number, x = 0, z = 0): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, 14, 10);
  geometry.translate(x, y, z);
  return geometry;
}

function ring(radius: number, tube: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 18);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

/**
 * 嵌在马夸维特或矛头边缘的一颗黑曜石齿，尖端背向杆身。
 */
function tooth(size: number, y: number, x: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(size * 0.5, size, 3);
  geometry.rotateZ(x > 0 ? -Math.PI / 2 : Math.PI / 2);
  geometry.translate(x + Math.sign(x) * size * 0.5, y, 0);
  return geometry;
}

/** 从 `base` 起、沿长 `length` 的剑身两缘各一排齿。 */
function toothedEdges(count: number, base: number, length: number, size: number, half: number): THREE.BufferGeometry[] {
  const teeth: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = base + ((i + 0.5) / count) * length;
    teeth.push(tooth(size, y, half));
    teeth.push(tooth(size, y, -half));
  }
  return teeth;
}

/** 从高 `y` 处半径 `radius` 的环上垂下的羽毛簇。 */
function plumes(count: number, radius: number, y: number, length: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const geometry = new THREE.BoxGeometry(0.022, length * (1 - Math.abs(t) * 0.35), 0.009);
    geometry.rotateZ(t * 0.22);
    geometry.translate(t * radius, y - length * 0.5, 0.004);
    out.push(geometry);
  }
  return out;
}

/** 围绕躺在其正面平面内的太阳圆盘扇形展开的三角形光芒。 */
function sunRays(count: number, radius: number, y: number, length: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const geometry = new THREE.ConeGeometry(0.016, length, 4);
    geometry.rotateZ(-angle);
    geometry.translate(
      Math.sin(angle) * (radius + length * 0.4),
      y + Math.cos(angle) * (radius + length * 0.4),
      0,
    );
    out.push(geometry);
  }
  return out;
}

/** 圆形羽毛流苏奇马利盾，只用封闭实体构建。 */
function chimalliParts(radius: number, fringe: number): Part[] {
  const board = new THREE.CylinderGeometry(radius, radius, 0.018, 30);
  board.rotateX(Math.PI / 2);
  const dome = new THREE.ConeGeometry(radius, 0.04, 30);
  dome.rotateX(Math.PI / 2);
  dome.translate(0, 0, 0.028);
  const rim = new THREE.TorusGeometry(radius * 1.02, 0.012, 8, 28);
  const inlay = new THREE.TorusGeometry(radius * 0.66, 0.013, 8, 26);
  inlay.translate(0, 0, 0.018);
  const boss = new THREE.SphereGeometry(radius * 0.2, 14, 10);
  boss.translate(0, 0, 0.042);
  const bars: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI;
    const bar = new THREE.BoxGeometry(radius * 1.25, 0.022, 0.01);
    bar.rotateZ(angle);
    bar.translate(0, 0, 0.022);
    bars.push(bar);
  }
  const fringeParts: THREE.BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i += 1) {
    const t = (i / (count - 1)) * 2 - 1;
    const feather = new THREE.BoxGeometry(0.026, fringe * (1 - Math.abs(t) * 0.4), 0.01);
    feather.rotateZ(t * 0.18);
    feather.translate(t * radius * 0.82, -radius - fringe * 0.4, 0.004);
    fringeParts.push(feather);
  }
  return [
    { geometry: board, role: "wood" },
    { geometry: dome, role: "wood" },
    { geometry: rim, role: "gold" },
    { geometry: inlay, role: "jade" },
    { geometry: boss, role: "gold" },
    ...bars.map((geometry) => ({ geometry, role: "jade" as const })),
    ...fringeParts.map((geometry) => ({ geometry, role: "feather" as const })),
  ];
}

/**
 * 马夸维特：两缘嵌着黑曜石刃的扁平硬木桨。
 * `size` 缩放整件武器，`royal` 加上皇帝的羽毛穗。
 */
function macuahuitlParts(size: number, royal: boolean): Part[] {
  const grip = 0.16 * size;
  const paddle = 0.44 * size;
  const halfWidth = 0.046 * size;
  const parts: Part[] = [
    { geometry: shaft(grip, 0.019 * size, 0.017 * size), role: "wood" },
    { geometry: ball(0.03 * size, -0.014 * size), role: "obsidian" },
    { geometry: ring(0.023 * size, 0.008 * size, grip * 0.45), role: "leather" },
    { geometry: box(halfWidth * 2, paddle, 0.026 * size, grip + paddle / 2), role: "wood" },
    { geometry: box(halfWidth * 2.05, 0.026 * size, 0.03 * size, grip + 0.03 * size), role: "jade" },
    { geometry: box(halfWidth * 1.5, 0.024 * size, 0.03 * size, grip + paddle - 0.03 * size), role: "gold" },
    ...toothedEdges(6, grip + 0.05 * size, paddle - 0.09 * size, 0.058 * size, halfWidth).map(
      (geometry) => ({ geometry, role: "obsidian" as const }),
    ),
    { geometry: spike(0.038 * size, 0.075 * size, grip + paddle), role: "obsidian" },
  ];
  if (royal) {
    parts.push(
      ...plumes(5, 0.05 * size, grip * 0.3, 0.17 * size).map((geometry) => ({
        geometry,
        role: "feather" as const,
      })),
    );
  }
  return parts;
}

/**
 * 弯刀剑身：沿弧线铺排的一串短渐细段，让剑刃像骑兵弯刀那样向前扫。
 * 段与段之间略微重叠，接缝在游戏尺度下不会显示为缺口。
 *
 * @param curve 从无刃根部到剑尖的总扫掠角，弧度制
 */
function curvedBlade(
  length: number,
  width: number,
  thickness: number,
  base: number,
  curve: number,
  segments = 5,
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const step = length / segments;
  let x = 0;
  let y = base;
  for (let i = 0; i < segments; i += 1) {
    const angle = curve * (i / segments);
    const top = 1 - (i + 1) / (segments + 1.4);
    const bottom = 1 - i / (segments + 1.4);
    const segment = new THREE.CylinderGeometry(0.5 * top, 0.5 * bottom, step * 1.1, 4, 1);
    segment.rotateY(Math.PI / 4);
    segment.scale(width, 1, thickness);
    segment.translate(0, step / 2, 0);
    segment.rotateZ(-angle);
    segment.translate(x, y, 0);
    parts.push(segment);
    x += Math.sin(angle) * step;
    y += Math.cos(angle) * step;
  }
  return parts;
}

/** 护指弓：立在剑身所在平面内的半圆环。 */
function knuckleBow(radius: number, tube: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 6, 14, Math.PI);
  geometry.rotateZ(-Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

/** 展翅雄鹰：一个身体球加两翼后掠的翅膀，用于帝国剑柄端饰。 */
function eagleParts(size: number, y: number, role: WeaponRole): Part[] {
  const body = new THREE.SphereGeometry(size * 0.42, 12, 9);
  body.scale(0.8, 1.15, 0.8);
  body.translate(0, y, 0);
  const head = new THREE.SphereGeometry(size * 0.2, 10, 8);
  head.translate(0, y + size * 0.5, size * 0.1);
  const parts: Part[] = [
    { geometry: body, role },
    { geometry: head, role },
  ];
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(size * 1.05, size * 0.5, size * 0.11);
    wing.translate(side * size * 0.62, 0, 0);
    wing.rotateZ(side * -0.42);
    wing.translate(0, y + size * 0.22, 0);
    parts.push({ geometry: wing, role });
  }
  return parts;
}

/** 沿身体前轴（+Z）躺放的圆柱——枪管和轮轴。 */
function tube(
  length: number,
  radius: number,
  frontRadius = radius,
  z = 0,
  y = 0,
  x = 0,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(frontRadius, radius, length, 14, 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z + length / 2);
  return geometry;
}

/**
 * 一个炮轮：轮毂上带轮箍的轮圈，立在火炮滚动的平面内（轮轴沿 ±X）。
 * 轮辐是实心方块——真正的辐条轮在游戏尺度下糊成一团，三角形开销还要
 * 贵上十倍。
 */
function gunWheel(radius: number, x: number, y: number, z: number): Part[] {
  const parts: Part[] = [];
  const rim = new THREE.TorusGeometry(radius, radius * 0.11, 8, 20);
  rim.rotateY(Math.PI / 2);
  rim.translate(x, y, z);
  parts.push({ geometry: rim, role: "steel" });
  const felloe = new THREE.TorusGeometry(radius * 0.88, radius * 0.075, 6, 18);
  felloe.rotateY(Math.PI / 2);
  felloe.translate(x, y, z);
  parts.push({ geometry: felloe, role: "wood" });
  const hub = new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, radius * 0.36, 10);
  hub.rotateZ(Math.PI / 2);
  hub.translate(x, y, z);
  parts.push({ geometry: hub, role: "wood" });
  const cap = new THREE.SphereGeometry(radius * 0.13, 10, 8);
  cap.translate(x + Math.sign(x) * radius * 0.2, y, z);
  parts.push({ geometry: cap, role: "gold" });
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI;
    const spoke = new THREE.BoxGeometry(radius * 0.13, radius * 1.72, radius * 0.1);
    spoke.rotateX(Math.PI / 2);
    spoke.rotateX(angle);
    spoke.translate(x, y, z);
    parts.push({ geometry: spoke, role: "wood" });
  }
  return parts;
}

function spike(radius: number, height: number, y: number, tilt = 0): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, height, 10);
  geometry.translate(0, height / 2, 0);
  if (tilt !== 0) geometry.rotateX(tilt);
  geometry.translate(0, y, 0);
  return geometry;
}

/** 正面法线为 +Z、上方为 +Y 的挤压成形盾板。 */
function shieldPlate(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geometry.center();
  return geometry;
}

function heaterShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  const hw = width / 2;
  shape.moveTo(-hw, height * 0.5);
  shape.lineTo(hw, height * 0.5);
  shape.quadraticCurveTo(hw, -height * 0.1, 0, -height * 0.5);
  shape.quadraticCurveTo(-hw, -height * 0.1, -hw, height * 0.5);
  return shape;
}

function towerShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hh = height / 2;
  shape.moveTo(-hw, hh * 0.72);
  shape.quadraticCurveTo(0, hh * 1.06, hw, hh * 0.72);
  shape.lineTo(hw, -hh * 0.62);
  shape.quadraticCurveTo(0, -hh * 1.05, -hw, -hh * 0.62);
  shape.closePath();
  return shape;
}

// ------------------------------------------------------------------- 武器

/**
 * 每把*出鞘*的拿破仑军刀的静置携带角，以身体轴表示。
 *
 * 过去静置在 `(-0.05, 1, 0.14)`：笔直向上，微微倾向脊柱。对于真人手中
 * 的真剑，这两半都是错的。笔直向上意味着剑身盖住整个躯干，而拳头大约
 * 在身高一半处，任何长于半身的东西都会探过头顶；内倾又让它走上剪影的
 * *正中*。一把 0.72 长的弯刀这样携带时，在 x = 0.219 处越过头高——恰好
 * 是两角帽的边缘——所以从棋盘相机看，皇帝自己的剑正横在他脸上。它读作
 * 模型坏了，其实只是一个姿势。
 *
 * 改为向外斜出（≈27°）再略向前（≈15°），剑身离开拳头时背向身体：它让过
 * 肩膀，最高只到下颌而不是帽顶之上，落在格子的空旷半边呈一道斜线——
 * 没有砍人时，出鞘的弯刀本来就是这样拿的。
 */
const BLADE_AT_REST = new THREE.Vector3(0.5, 1, 0.28);

const WEAPONS: Record<WeaponId, WeaponSpec> = {
  /** 国王：仪式双手大剑，剑身向上如军旗般持握。 */
  greatsword: {
    grip: 0.12,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.22, 0.019, 0.017), role: "leather" },
      { geometry: ball(0.033, -0.014), role: "gold" },
      { geometry: ring(0.026, 0.008, 0.205), role: "gold" },
      { geometry: box(0.25, 0.026, 0.036, 0.234), role: "gold" },
      { geometry: ball(0.024, 0.234, 0.125), role: "gold" },
      { geometry: ball(0.024, 0.234, -0.125), role: "gold" },
      { geometry: ball(0.021, 0.234, 0, 0.026), role: "gem" },
      { geometry: box(0.05, 0.05, 0.03, 0.262), role: "gold" },
      { geometry: blade(0.5, 0.086, 0.021, 0.16, 0.28), role: "steel" },
    ],
  },
  /** 王后：顶端镶着阵营色水晶的金权杖。 */
  scepter: {
    grip: 0.16,
    focus: 0.56,
    aim: new THREE.Vector3(-0.04, 1, 0.1),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.5, 0.016, 0.014), role: "gold" },
      { geometry: ball(0.026, 0.0), role: "gold" },
      { geometry: ring(0.024, 0.007, 0.14), role: "gold" },
      { geometry: ring(0.024, 0.007, 0.32), role: "gold" },
      { geometry: ring(0.036, 0.009, 0.5), role: "gold" },
      { geometry: ball(0.045, 0.552), role: "gem" },
      { geometry: spike(0.018, 0.06, 0.585), role: "gold" },
    ],
  },
  /** 主教：高阶教士法杖，金爪中悬着一枚水晶。 */
  crystalStaff: {
    grip: 0.34,
    focus: 0.775,
    aim: new THREE.Vector3(-0.03, 1, 0.07),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.7, 0.015, 0.013), role: "wood" },
      { geometry: ring(0.019, 0.008, 0.3), role: "leather" },
      { geometry: ring(0.019, 0.008, 0.37), role: "leather" },
      { geometry: ring(0.021, 0.008, 0.685), role: "gold" },
      { geometry: spike(0.028, 0.08, 0.69), role: "gold" },
      { geometry: ball(0.042, 0.775), role: "gem" },
      { geometry: ring(0.048, 0.007, 0.775), role: "gold" },
      { geometry: spike(0.011, 0.028, -0.028, Math.PI), role: "steel" },
    ],
  },
  /** 战车：攻城战锤，重得足以撑起抡锤动画。 */
  warhammer: {
    grip: 0.16,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.46, 0.019, 0.017), role: "wood" },
      { geometry: shaft(0.15, 0.021), role: "leather" },
      { geometry: box(0.13, 0.12, 0.19, 0.52), role: "steel" },
      { geometry: box(0.145, 0.026, 0.2, 0.575), role: "gold" },
      { geometry: box(0.145, 0.026, 0.2, 0.465), role: "gold" },
      { geometry: spike(0.035, 0.1, 0.58), role: "steel" },
    ],
  },
  /** 骑士：带翼形护手的佩剑。 */
  longsword: {
    grip: 0.075,
    aim: new THREE.Vector3(-0.07, 1, 0.18),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.14, 0.017, 0.015), role: "leather" },
      { geometry: ball(0.026, -0.012), role: "gold" },
      { geometry: box(0.19, 0.023, 0.03, 0.153), role: "gold" },
      { geometry: ball(0.019, 0.153, 0.095), role: "gold" },
      { geometry: ball(0.019, 0.153, -0.095), role: "gold" },
      { geometry: box(0.042, 0.04, 0.026, 0.18), role: "gold" },
      { geometry: blade(0.42, 0.072, 0.019, 0.2, 0.196), role: "steel" },
    ],
  },
  /** 兵：梣木长矛，钢制叶形矛头，布条缠绑。 */
  spear: {
    grip: 0.3,
    aim: new THREE.Vector3(-0.03, 1, 0.06),
    offset: new THREE.Vector3(0.018, 0, 0.028),
    build: () => [
      { geometry: shaft(0.68, 0.013, 0.011), role: "wood" },
      { geometry: ring(0.017, 0.007, 0.26), role: "cloth" },
      { geometry: ring(0.017, 0.007, 0.32), role: "cloth" },
      { geometry: shaft(0.045, 0.019, 0.016).translate(0, 0.655, 0), role: "steel" },
      { geometry: leafHead(0.19, 0.062, 0.016, 0.695), role: "steel" },
      { geometry: spike(0.013, 0.038, -0.036, Math.PI), role: "steel" },
    ],
  },
  /**
   * 兵的副手：圆顶圆盾。
   *
   * 只用封闭实体构建——棋子一背对相机，开口的球壳就读作一个光秃秃的
   * 圆环（背面会被剔除）。
   */
  roundShield: {
    grip: 0,
    shield: true,
    half: 0.155,
    aim: new THREE.Vector3(0.36, 0.05, 1),
    offset: new THREE.Vector3(0.045, 0.015, 0.055),
    build: () => {
      const board = new THREE.CylinderGeometry(0.142, 0.142, 0.018, 30);
      board.rotateX(Math.PI / 2);
      const dome = new THREE.ConeGeometry(0.142, 0.055, 30);
      dome.rotateX(Math.PI / 2);
      dome.translate(0, 0, 0.036);
      const rim = new THREE.TorusGeometry(0.145, 0.012, 8, 28);
      const boss = new THREE.SphereGeometry(0.032, 14, 10);
      boss.translate(0, 0, 0.055);
      const rivets: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i += 1) {
        const angle = (i / 8) * Math.PI * 2;
        const rivet = new THREE.SphereGeometry(0.0105, 8, 6);
        rivet.translate(Math.cos(angle) * 0.118, Math.sin(angle) * 0.118, 0.019);
        rivets.push(rivet);
      }
      return [
        { geometry: board, role: "cloth" },
        { geometry: dome, role: "cloth" },
        { geometry: rim, role: "steel" },
        { geometry: boss, role: "steel" },
        ...rivets.map((geometry) => ({ geometry, role: "steel" as const })),
      ];
    },
  },
  /** 骑士的副手：金属包边、青铜盾心的熨斗盾。 */
  heaterShield: {
    grip: 0,
    shield: true,
    half: 0.17,
    aim: new THREE.Vector3(0.4, 0.04, 1),
    offset: new THREE.Vector3(0.05, 0.02, 0.055),
    build: () => {
      const plate = shieldPlate(heaterShape(0.24, 0.32), 0.022, 0.008);
      const rim = shieldPlate(heaterShape(0.268, 0.352), 0.012, 0.006);
      rim.translate(0, 0, -0.012);
      const boss = new THREE.SphereGeometry(0.028, 12, 10);
      boss.translate(0, 0, 0.024);
      const band = box(0.19, 0.022, 0.016, 0.052, 0, 0.018);
      return [
        { geometry: plate, role: "cloth" },
        { geometry: rim, role: "steel" },
        { geometry: band, role: "steel" },
        { geometry: boss, role: "gold" },
      ];
    },
  },
  /** 战车的副手：城门卫士塔盾。 */
  towerShield: {
    grip: 0,
    shield: true,
    half: 0.23,
    aim: new THREE.Vector3(0.34, 0.03, 1),
    offset: new THREE.Vector3(0.055, 0.02, 0.06),
    build: () => {
      const plate = shieldPlate(towerShape(0.3, 0.46), 0.026, 0.01);
      const rim = shieldPlate(towerShape(0.328, 0.494), 0.014, 0.007);
      rim.translate(0, 0, -0.014);
      const bandTop = box(0.28, 0.028, 0.018, 0.13, 0, 0.02);
      const bandLow = box(0.28, 0.028, 0.018, -0.13, 0, 0.02);
      const boss = new THREE.SphereGeometry(0.036, 12, 10);
      boss.translate(0, 0, 0.028);
      return [
        { geometry: plate, role: "cloth" },
        { geometry: rim, role: "steel" },
        { geometry: bandTop, role: "steel" },
        { geometry: bandLow, role: "steel" },
        { geometry: boss, role: "gold" },
      ];
    },
  },

  // ------------------------------------------------------------ 太阳帝国

  /** 皇帝： oversized 仪式马夸维特，垂着羽毛穗。 */
  royalMacuahuitl: {
    grip: 0.1,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => macuahuitlParts(1.2, true),
  },
  /** 美洲虎战士：标准的黑曜石齿战棍。 */
  macuahuitl: {
    grip: 0.085,
    aim: new THREE.Vector3(-0.07, 1, 0.18),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => macuahuitlParts(0.94, false),
  },
  /** 步兵战士：黑曜石刃突刺矛。 */
  tepoztopilli: {
    grip: 0.3,
    aim: new THREE.Vector3(-0.03, 1, 0.06),
    offset: new THREE.Vector3(0.018, 0, 0.028),
    build: () => [
      { geometry: shaft(0.64, 0.013, 0.011), role: "wood" },
      { geometry: ring(0.017, 0.007, 0.26), role: "feather" },
      { geometry: ring(0.017, 0.007, 0.33), role: "jade" },
      { geometry: box(0.072, 0.2, 0.016, 0.735), role: "wood" },
      ...toothedEdges(4, 0.65, 0.16, 0.05, 0.036).map((geometry) => ({
        geometry,
        role: "obsidian" as const,
      })),
      { geometry: spike(0.032, 0.075, 0.833), role: "obsidian" },
      { geometry: spike(0.013, 0.036, -0.034, Math.PI), role: "obsidian" },
      ...plumes(3, 0.026, 0.6, 0.1).map((geometry) => ({ geometry, role: "feather" as const })),
    ],
  },
  /** 蛇祭司：羽蛇法杖，顶端是翡翠骷髅球。 */
  serpentStaff: {
    grip: 0.34,
    focus: 0.712,
    aim: new THREE.Vector3(-0.03, 1, 0.07),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.66, 0.015, 0.013), role: "wood" },
      { geometry: ring(0.019, 0.008, 0.27), role: "feather" },
      { geometry: ring(0.019, 0.008, 0.35), role: "jade" },
      { geometry: ring(0.026, 0.009, 0.645), role: "gold" },
      { geometry: ball(0.048, 0.712), role: "jade" },
      { geometry: box(0.052, 0.042, 0.09, 0.706, 0, 0.058), role: "jade" },
      { geometry: box(0.046, 0.016, 0.072, 0.681, 0, 0.05), role: "gold" },
      { geometry: ball(0.013, 0.73, 0.032, 0.028), role: "gem" },
      { geometry: ball(0.013, 0.73, -0.032, 0.028), role: "gem" },
      { geometry: ring(0.058, 0.013, 0.685), role: "feather" },
      { geometry: spike(0.022, 0.11, 0.752), role: "feather" },
      { geometry: spike(0.011, 0.03, -0.03, Math.PI), role: "obsidian" },
    ],
  },
  /** 女祭司王后：翡翠箍杆上高举的金色太阳圆盘。 */
  sunScepter: {
    grip: 0.16,
    focus: 0.54,
    aim: new THREE.Vector3(-0.04, 1, 0.1),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => {
      const disc = new THREE.CylinderGeometry(0.072, 0.072, 0.018, 22);
      disc.rotateX(Math.PI / 2);
      disc.translate(0, 0.54, 0);
      return [
        { geometry: shaft(0.46, 0.016, 0.014), role: "gold" },
        { geometry: ball(0.026, 0.0), role: "obsidian" },
        { geometry: ring(0.024, 0.007, 0.13), role: "jade" },
        { geometry: ring(0.024, 0.007, 0.31), role: "jade" },
        { geometry: disc, role: "gold" },
        ...sunRays(10, 0.072, 0.54, 0.05).map((geometry) => ({ geometry, role: "gold" as const })),
        { geometry: ball(0.03, 0.54, 0, 0.016), role: "jade" },
        { geometry: ball(0.03, 0.54, 0, -0.016), role: "jade" },
        ...plumes(5, 0.05, 0.45, 0.16).map((geometry) => ({ geometry, role: "feather" as const })),
      ];
    },
  },
  /** 神庙守卫：嵌黑曜石刃面的玄武岩重锤。 */
  stoneMaul: {
    grip: 0.16,
    aim: new THREE.Vector3(-0.05, 1, 0.14),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.44, 0.02, 0.018), role: "wood" },
      { geometry: shaft(0.15, 0.022), role: "leather" },
      { geometry: ring(0.03, 0.009, 0.42), role: "gold" },
      { geometry: box(0.13, 0.16, 0.18, 0.52), role: "stone" },
      { geometry: box(0.032, 0.17, 0.19, 0.52, 0.079), role: "obsidian" },
      { geometry: box(0.032, 0.17, 0.19, 0.52, -0.079), role: "obsidian" },
      { geometry: box(0.15, 0.024, 0.2, 0.44), role: "jade" },
      { geometry: spike(0.04, 0.1, 0.6), role: "obsidian" },
    ],
  },
  /** 帝国线列部队携带的羽毛流苏奇马利盾。 */
  chimalli: {
    grip: 0,
    shield: true,
    half: 0.2,
    aim: new THREE.Vector3(0.36, 0.05, 1),
    offset: new THREE.Vector3(0.045, 0.015, 0.055),
    build: () => chimalliParts(0.14, 0.11),
  },
  /** 守卫的大奇马利盾，宽得足以封住神庙台阶。 */
  greatChimalli: {
    grip: 0,
    shield: true,
    half: 0.29,
    aim: new THREE.Vector3(0.34, 0.03, 1),
    offset: new THREE.Vector3(0.055, 0.02, 0.06),
    build: () => chimalliParts(0.185, 0.16),
  },

  // ----------------------------------------------------------- 法兰西军团

  /**
   * 拿破仑：皇帝的礼服弯刀——鎏金护指弓剑柄下一段微弯的剑身，出鞘后
   * 放低、远离身体持握。
   *
   * 剑身从 0.5 缩短而剑柄保持不动，因为缩短的军刀就是这样：无论剑身
   * 如何，剑柄都是一只手的大小。总长 0.536，与替换它的雕塑一致
   * （见 `ARM_SCULPTS`）。
   */
  imperialSabre: {
    grip: 0.095,
    edged: true,
    aim: BLADE_AT_REST.clone(),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      { geometry: shaft(0.16, 0.016, 0.014), role: "leather" },
      { geometry: ball(0.03, -0.012), role: "gold" },
      { geometry: ring(0.023, 0.008, 0.152), role: "gold" },
      { geometry: knuckleBow(0.062, 0.009, 0.09), role: "gold" },
      { geometry: box(0.13, 0.022, 0.03, 0.176), role: "gold" },
      { geometry: ball(0.019, 0.176, 0.066), role: "gold" },
      { geometry: box(0.05, 0.038, 0.028, 0.2), role: "gold" },
      ...curvedBlade(0.32, 0.075, 0.02, 0.216, 0.34).map((geometry) => ({
        geometry,
        role: "steel" as const,
      })),
    ],
  },
  /**
   * 马伦戈之剑：帝国统帅的礼赠佩剑，以它随军的战场命名。它的一切都
   * 是馈赠而非制式装备——金丝缠绑的象牙握柄、月桂纹护指弓、护手上镶着
   * 的璀璨宝石、鹰首剑首——而它的剑身是帝国宫廷中最直的一把。它佩在
   * 副手：她的右手是用来开枪的。
   */
  marengoSword: {
    grip: 0.09,
    edged: true,
    aim: BLADE_AT_REST.clone(),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => [
      // 金丝缠线下的象牙握柄。
      { geometry: shaft(0.15, 0.017, 0.015), role: "stone" },
      { geometry: ring(0.02, 0.005, 0.036), role: "gold" },
      { geometry: ring(0.02, 0.005, 0.075), role: "gold" },
      { geometry: ring(0.02, 0.005, 0.114), role: "gold" },
      // 鹰首剑首——从上方一眼认出主人的唯一纹样。
      ...eagleParts(0.05, -0.03, "gold"),
      // 月桂纹护手：箍环、护指弓、剑格和一颗镶嵌宝石。
      { geometry: ring(0.024, 0.009, 0.146), role: "gold" },
      { geometry: knuckleBow(0.058, 0.008, 0.086), role: "gold" },
      { geometry: box(0.115, 0.02, 0.028, 0.168), role: "gold" },
      { geometry: ball(0.017, 0.168, 0.058), role: "gold" },
      { geometry: ball(0.017, 0.168, -0.042), role: "gold" },
      { geometry: ball(0.013, 0.176, 0, 0.026), role: "gem" },
      { geometry: box(0.046, 0.034, 0.026, 0.192), role: "gold" },
      // 几乎不弯的宫廷剑身——名为弯刀，线条是直剑。
      ...curvedBlade(0.37, 0.07, 0.019, 0.208, 0.22, 6).map((geometry) => ({
        geometry,
        role: "steel" as const,
      })),
    ],
  },
  /**
   * 帝国的神枪手：一杆线膛长枪——全枪托、烤蓝枪管比线列火枪长一半、
   * 黄铜配件、枪托上的贴腮板，而且完全没有刺刀。它身上没有任何仪式性
   * 的东西：它是棋盘上最长的枪管，也是这里唯一带瞄具的武器，这正是从
   * 俯视相机辨认这个兵种的全部要点。
   */
  marksmanRifle: {
    grip: 0.26,
    // 枪口，藏在黄铜枪口帽里。
    muzzle: new THREE.Vector3(0, 0.835, 0),
    // 双手持握：枪管轴线从姿势读出，`aim` 只是骨骼一直没到来的棋子的
    // 兜底。
    hold: "longArm",
    aim: new THREE.Vector3(-0.03, 1, 0.06),
    offset: new THREE.Vector3(0.014, -0.005, 0.02),
    build: () => [
      // 全胡桃木枪托，枪托底在贴地端，颈部在枪机下方。
      { geometry: box(0.032, 0.34, 0.058, 0.175), role: "wood" },
      { geometry: box(0.036, 0.055, 0.08, 0.026), role: "wood" },
      { geometry: box(0.04, 0.026, 0.084, 0.005), role: "gold" },
      // 贴腮板：剪影里区分"线膛枪"和"火枪"的部分。
      { geometry: box(0.015, 0.055, 0.05, 0.11, 0.022), role: "wood" },
      // 枪机、击锤和扳机护圈。
      { geometry: box(0.031, 0.082, 0.052, 0.27), role: "gold" },
      { geometry: box(0.014, 0.038, 0.02, 0.318, 0, -0.024), role: "steel" },
      { geometry: box(0.014, 0.016, 0.034, 0.238, 0, 0.026), role: "gold" },
      { geometry: ring(0.019, 0.007, 0.216), role: "leather" },
      // 枪管、枪管下槽里的通条，以及黄铜箍。
      { geometry: shaft(0.5, 0.0125, 0.011).translate(0, 0.335, 0), role: "steel" },
      { geometry: shaft(0.42, 0.005).translate(0, 0.35, 0).translate(0, 0, 0.02), role: "wood" },
      { geometry: ring(0.017, 0.006, 0.42), role: "gold" },
      { geometry: ring(0.017, 0.006, 0.58), role: "gold" },
      { geometry: ring(0.017, 0.006, 0.74), role: "gold" },
      // 前后瞄具——辨认这个兵种所靠的细节。
      { geometry: box(0.024, 0.016, 0.018, 0.362), role: "steel" },
      { geometry: box(0.009, 0.018, 0.014, 0.8), role: "steel" },
      { geometry: ring(0.016, 0.005, 0.825), role: "gold" },
      // 背带：从枪托背带环斜挂到中部枪箍的皮条。
      { geometry: box(0.012, 0.4, 0.011, 0.4, 0, -0.03), role: "leather" },
      { geometry: ring(0.015, 0.005, 0.19), role: "leather" },
    ],
  },
  /**
   * 胸甲骑兵：重型直背骑兵弯刀，黄铜碗形护手。
   *
   * An XI 全长 111cm，配 1.75m 的骑兵，所以 0.63 是真实长度并保持不变——
   * 只有携带姿势被斜出了他自己的剪影。
   */
  cavalrySabre: {
    grip: 0.08,
    edged: true,
    aim: BLADE_AT_REST.clone(),
    offset: new THREE.Vector3(0.02, 0, 0.03),
    build: () => {
      const bowl = new THREE.SphereGeometry(0.058, 14, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
      bowl.scale(1, 0.6, 1);
      bowl.translate(0, 0.158, 0.012);
      const bowlFace = new THREE.CylinderGeometry(0.058, 0.058, 0.008, 16);
      bowlFace.translate(0, 0.157, 0.012);
      return [
        { geometry: shaft(0.14, 0.017, 0.015), role: "leather" },
        { geometry: ring(0.019, 0.006, 0.04), role: "gold" },
        { geometry: ring(0.019, 0.006, 0.1), role: "gold" },
        { geometry: ball(0.026, -0.01), role: "gold" },
        { geometry: bowl, role: "gold" },
        { geometry: bowlFace, role: "gold" },
        { geometry: box(0.044, 0.03, 0.028, 0.178), role: "gold" },
        ...curvedBlade(0.44, 0.08, 0.021, 0.192, 0.52).map((geometry) => ({
          geometry,
          role: "steel" as const,
        })),
      ];
    },
  },
  /**
   * 线列步兵：上着刺刀的查尔维尔火枪——棋盘上最长的剪影，也是从上方
   * 辨认兵种的全部身份。
   */
  musketBayonet: {
    grip: 0.26,
    // 火焰从枪口离开，在刺刀座下方。
    muzzle: new THREE.Vector3(0, 0.665, 0),
    hold: "longArm",
    aim: new THREE.Vector3(-0.03, 1, 0.06),
    offset: new THREE.Vector3(0.014, -0.005, 0.02),
    build: () => [
      { geometry: box(0.032, 0.3, 0.056, 0.15), role: "wood" },
      { geometry: box(0.036, 0.05, 0.075, 0.022), role: "wood" },
      { geometry: box(0.038, 0.026, 0.078, 0.005), role: "steel" },
      { geometry: box(0.03, 0.075, 0.05, 0.235), role: "gold" },
      { geometry: shaft(0.4, 0.012, 0.013).translate(0, 0.29, 0), role: "steel" },
      { geometry: ring(0.017, 0.006, 0.36), role: "gold" },
      { geometry: ring(0.017, 0.006, 0.52), role: "gold" },
      { geometry: box(0.024, 0.06, 0.03, 0.66), role: "steel" },
      { geometry: blade(0.17, 0.028, 0.014, 0.14, 0.69), role: "steel" },
    ],
  },
  /**
   * 拿破仑的副手：鎏金件装裱的燧发军官手枪，平端在胯侧而不是竖持——
   * 皇帝在任何人近到能被砍之前就已决定一场战斗。
   */
  officerPistol: {
    grip: 0.055,
    muzzle: new THREE.Vector3(0, 0.262, 0),
    // 单手持握，所以枪管延续前臂而不是脊柱。
    hold: "sidearm",
    // 枪管向前并微微上扬：手臂读作平端，而不是扛在肩上。
    aim: new THREE.Vector3(-0.2, 0.46, 0.87),
    offset: new THREE.Vector3(0.022, 0.004, 0.022),
    build: () => [
      { geometry: box(0.028, 0.1, 0.052, 0.05), role: "wood" },
      { geometry: box(0.032, 0.022, 0.058, 0.008), role: "gold" },
      { geometry: box(0.03, 0.056, 0.078, 0.12), role: "wood" },
      { geometry: box(0.034, 0.03, 0.05, 0.126, 0, -0.026), role: "steel" },
      { geometry: box(0.014, 0.032, 0.016, 0.148, 0, -0.03), role: "gold" },
      { geometry: box(0.014, 0.014, 0.03, 0.098, 0, 0.018), role: "gold" },
      { geometry: shaft(0.14, 0.0135, 0.0115).translate(0, 0.12, 0), role: "steel" },
      { geometry: shaft(0.115, 0.0045).translate(0, 0.13, 0).translate(0, 0, 0.019), role: "wood" },
      { geometry: ring(0.0165, 0.0045, 0.255), role: "gold" },
      { geometry: ball(0.008, 0.155, 0, 0.03), role: "gem" },
    ],
  },
  /**
   * 炮兵的火炮：一门轻型格里博瓦尔野战炮，拖在炮兵卫兵身旁，炮口朝前，
   * 无需掉头即可瞄准目标。以身体轴设计（前方 +Z，上方 +Y），拖曳而非
   * 手持——见 {@link WeaponSpec.towed}。
   */
  fieldCannon: {
    grip: 0,
    towed: true,
    // 尺寸对着拖它的卫兵而不是它设计时参照的雕塑来定：1.22 让轮子大约
    // 到他身高的一半，炮尾到炮口的行程略小于一格，这是仍读作战车兵种
    // 武器的最小炮。轮距为此付出了代价（见 {@link WeaponSpec.track}）。
    bulk: 1.22,
    track: 0.8,
    // 炮架如今长了一半，所以停靠位置向格子内收拢摆正：旧的 (0.42, -0.1)
    // 停靠位是围绕只有三分之二大小的炮定的。
    park: new THREE.Vector3(0.2, 0, -0.04),
    muzzle: new THREE.Vector3(0, 0.28, 0.36),
    aim: new THREE.Vector3(0, 1, 0),
    offset: new THREE.Vector3(0, 0, 0),
    build: () => {
      const parts: Part[] = [
        // 炮管：尾部是炮尾，前端是膨起的炮口。
        { geometry: tube(0.44, 0.05, 0.042, -0.08, 0.27), role: "gold" },
        { geometry: ball(0.05, 0.27, 0, -0.095), role: "gold" },
        { geometry: ball(0.026, 0.27, 0, -0.14), role: "gold" },
        { geometry: tube(0.035, 0.058, 0.058, 0.33, 0.27), role: "gold" },
        { geometry: tube(0.02, 0.056, 0.056, 0.02, 0.27), role: "steel" },
        // 炮耳：炮管架在炮架侧板之间的转轴。
        { geometry: box(0.19, 0.024, 0.024, 0.27, 0, 0.12), role: "steel" },
        // 炮架侧板，以及垂到身后地面的炮尾架。
        { geometry: box(0.028, 0.14, 0.38, 0.2, 0.075, 0.02), role: "wood" },
        { geometry: box(0.028, 0.14, 0.38, 0.2, -0.075, 0.02), role: "wood" },
        { geometry: box(0.18, 0.03, 0.16, 0.145, 0, 0.06), role: "wood" },
        { geometry: box(0.155, 0.05, 0.2, 0.07, 0, -0.2), role: "wood" },
        { geometry: box(0.13, 0.028, 0.06, 0.045, 0, -0.3), role: "gold" },
        // 炮尾架末端的牵引环——拖炮时挂的地方。
        { geometry: ring(0.028, 0.008, 0).rotateX(Math.PI / 2).translate(0, 0.05, -0.34), role: "steel" },
        // 轮轴，以及炮尾下方的高低螺杆。
        { geometry: box(0.4, 0.028, 0.028, 0.2, 0, 0.02), role: "wood" },
        { geometry: shaft(0.07, 0.011).translate(0, 0.19, 0).translate(0, 0, -0.09), role: "steel" },
        ...gunWheel(0.19, 0.215, 0.19, 0.02),
        ...gunWheel(0.19, -0.215, 0.19, 0.02),
      ];
      // 炮尾架上的帝国鹰徽，从上方即可读出这是法军的炮。
      for (const part of eagleParts(0.07, 0, "gold")) {
        part.geometry.translate(0, 0.098, -0.21);
        parts.push(part);
      }
      return parts;
    },
  },
};

interface Loadout {
  /**
   * 右手武器。武器就是它所拖拽之物的棋子省略此项：炮兵伺候一门野战炮，
   * 所以双手空着。
   */
  main?: WeaponId;
  off?: WeaponId;
  /** 拖行而非手持——炮兵的火炮。 */
  train?: WeaponId;
}

/** 按武器家族和棋子种类分配的右手武器与副手盾牌。 */
const LOADOUT: Record<ArsenalId, Record<PieceKind, Loadout>> = {
  kingdom: {
    k: { main: "greatsword" },
    q: { main: "scepter" },
    b: { main: "crystalStaff" },
    n: { main: "longsword", off: "heaterShield" },
    r: { main: "warhammer", off: "towerShield" },
    p: { main: "spear", off: "roundShield" },
  },
  sun: {
    k: { main: "royalMacuahuitl" },
    q: { main: "sunScepter" },
    b: { main: "serpentStaff" },
    n: { main: "macuahuitl", off: "chimalli" },
    r: { main: "stoneMaul", off: "greatChimalli" },
    p: { main: "tepoztopilli", off: "chimalli" },
  },
  // 除了炮兵的防盾外没有任何盾牌：法兰西军团以弯刀、火枪和火炮作战，
  // 一面盾牌会读作中世纪。
  empire: {
    // 手枪在射击手，礼服弯刀佩在副手：皇帝的动画是右手拔枪射击，弯刀
    // 若放右手，就会让他举着剑瞄准、而枪被遗忘在胯侧。
    k: { main: "officerPistol", off: "imperialSabre" },
    // 统帅以皇帝为榜样：射击手持燧发枪，马伦戈之剑佩在另一侧。没有
    // 法杖，没有法术。
    q: { main: "officerPistol", off: "marengoSword" },
    // 元帅是全军的神枪手：一杆线膛长枪，压根没有权杖。他的整场战斗
    // 都是单膝跪地、远距离打完的。
    b: { main: "marksmanRifle" },
    n: { main: "cavalrySabre" },
    // 两只拳头都不拿东西：火炮就是武器，像抡锤一样握着推弹杆只会让
    // 炮组读作站在自家火炮旁边的莽汉。
    r: { train: "fieldCannon" },
    p: { main: "musketBayonet" },
  },
};

// ------------------------------------------------------------------ 材质

const PALETTE: Record<Faction, Record<WeaponRole, { color: number; roughness: number; metalness: number; emissive: number; emissiveIntensity: number }>> = {
  w: {
    steel: { color: 0xd8dee8, roughness: 0.21, metalness: 0.98, emissive: 0x101821, emissiveIntensity: 0.2 },
    gold: { color: 0xe0ab48, roughness: 0.28, metalness: 1, emissive: 0x2a1a04, emissiveIntensity: 0.25 },
    wood: { color: 0x8a6440, roughness: 0.82, metalness: 0.05, emissive: 0x000000, emissiveIntensity: 0 },
    leather: { color: 0x2f4a86, roughness: 0.72, metalness: 0.1, emissive: 0x081226, emissiveIntensity: 0.2 },
    cloth: { color: 0x2b4f9c, roughness: 0.78, metalness: 0.08, emissive: 0x0a1738, emissiveIntensity: 0.3 },
    gem: { color: 0xbcd8ff, roughness: 0.08, metalness: 0.05, emissive: 0x6ea8ff, emissiveIntensity: 2.4 },
    obsidian: { color: 0x23262e, roughness: 0.14, metalness: 0.4, emissive: 0x0a0f1a, emissiveIntensity: 0.2 },
    jade: { color: 0x4f9e86, roughness: 0.32, metalness: 0.12, emissive: 0x0d2a24, emissiveIntensity: 0.35 },
    feather: { color: 0xc4d3f0, roughness: 0.86, metalness: 0.02, emissive: 0x101c34, emissiveIntensity: 0.3 },
    stone: { color: 0x9d9482, roughness: 0.92, metalness: 0.03, emissive: 0x000000, emissiveIntensity: 0 },
  },
  b: {
    steel: { color: 0x5a5e66, roughness: 0.3, metalness: 0.96, emissive: 0x140807, emissiveIntensity: 0.2 },
    gold: { color: 0xb0742c, roughness: 0.34, metalness: 1, emissive: 0x2a1204, emissiveIntensity: 0.25 },
    wood: { color: 0x4a3323, roughness: 0.85, metalness: 0.05, emissive: 0x000000, emissiveIntensity: 0 },
    leather: { color: 0x5f1d17, roughness: 0.76, metalness: 0.1, emissive: 0x230605, emissiveIntensity: 0.2 },
    cloth: { color: 0x82201a, roughness: 0.8, metalness: 0.08, emissive: 0x2e0705, emissiveIntensity: 0.3 },
    gem: { color: 0xffc0a4, roughness: 0.08, metalness: 0.05, emissive: 0xff5a3c, emissiveIntensity: 2.4 },
    // 火山玻璃：近黑、极光滑，在火光下泛起条条流光。
    obsidian: { color: 0x0e1015, roughness: 0.08, metalness: 0.42, emissive: 0x1d0705, emissiveIntensity: 0.3 },
    jade: { color: 0x2fb8a2, roughness: 0.3, metalness: 0.14, emissive: 0x0a4a41, emissiveIntensity: 0.55 },
    feather: { color: 0xd8452c, roughness: 0.88, metalness: 0.02, emissive: 0x3d0a04, emissiveIntensity: 0.4 },
    stone: { color: 0x6d6558, roughness: 0.94, metalness: 0.03, emissive: 0x150605, emissiveIntensity: 0.15 },
  },
};

function makeMaterial(role: WeaponRole, color: Faction): THREE.MeshStandardMaterial {
  const spec = PALETTE[color][role];
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    emissive: new THREE.Color(spec.emissive),
    // 棋子背对相机时，盾面绝不能消失。
    side: role === "cloth" || role === "feather" ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.emissiveIntensity = spec.emissiveIntensity;
  material.envMapIntensity = role === "gem" ? 0.6 : 1.3;
  return material;
}

// ------------------------------------------------------------------- 缓存

const geometryCache = new Map<WeaponId, Map<WeaponRole, THREE.BufferGeometry>>();

/** 把一件武器的各部件按材质角色合并为一个几何体，只做一次。 */
function weaponGeometries(id: WeaponId): Map<WeaponRole, THREE.BufferGeometry> {
  const cached = geometryCache.get(id);
  if (cached) return cached;

  const byRole = new Map<WeaponRole, THREE.BufferGeometry[]>();
  for (const part of WEAPONS[id].build()) {
    const list = byRole.get(part.role) ?? [];
    list.push(part.geometry);
    byRole.set(part.role, list);
  }

  const merged = new Map<WeaponRole, THREE.BufferGeometry>();
  for (const [role, list] of byRole) {
    // mergeGeometries 拒绝索引/非索引混合的输入（挤压体是非索引的，基础
    // 几何体是索引的），所以先全部摊平。
    const flat = list.map((geometry) => {
      const plain = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      plain.deleteAttribute("uv");
      plain.deleteAttribute("uv1");
      geometry.dispose();
      return plain;
    });
    let result = flat[0];
    if (flat.length > 1) {
      const combined = mergeGeometries(flat, false);
      if (combined) {
        for (const entry of flat) entry.dispose();
        result = combined;
      }
    }
    merged.set(role, result);
  }

  geometryCache.set(id, merged);
  return merged;
}

// ------------------------------------------------------------------ 挂载

const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** 雕塑本地坐标系的前方，与生成器的朝向判定一致（+Z）。 */
const LOCAL_FRONT = new THREE.Vector3(0, 0, 1);

/**
 * 绕道具自身长度转半圈，用于需要它的剑刃。
 *
 * {@link restOrientation} 投影*身体的*前方来求滚转，而身体的前方不随
 * 左右手镜像——所以无论哪只拳头持握，道具自己的 +X 都落在身体的 +X 上
 * （实测：双手在身体轴下分别为 (0.90, ∓0.45, 0)）。+X 是棋子的左侧，
 * 所以左手剑的道具 +X 背向脊柱，右手剑的道具 +X 横过胸膛。
 *
 * 这之所以要紧，是因为弯刀按剑腹朝 +X 装配（见 `fitArmSculpt`），在静置
 * 斜持下，剑腹*向外*弯会把剑尖兜回内侧：在皇帝的骨骼上，他的礼服弯刀
 * 静置时剑尖在 1.70 身高的棋子上到了外 0.80、高 1.68——切线卷回他自己
 * 两角帽的帽顶上方，那是镰刀的剪影而不是出鞘的弯刀。反过来弯，剑尖就
 * 继续向外（0.85）远离他。
 *
 * 所以 {@link WeaponSpec.edged} 的剑刃在 +X 是外侧的那只拳头里滚转半圈，
 * 剑腹永远横过身体向外弯。
 */
const EDGED_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/** 把道具自身坐标轴摆到身体空间中静置方向的旋转。 */
function restOrientation(direction: THREE.Vector3, isShield: boolean): THREE.Quaternion {
  const aim = direction.clone().normalize();
  const matrix = new THREE.Matrix4();
  if (isShield) {
    const z = aim;
    const y = WORLD_UP.clone().sub(z.clone().multiplyScalar(WORLD_UP.dot(z))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    matrix.makeBasis(x, y, z);
  } else {
    const y = aim;
    const z = LOCAL_FRONT.clone().sub(y.clone().multiplyScalar(LOCAL_FRONT.dot(y))).normalize();
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    matrix.makeBasis(x, y, z);
  }
  return new THREE.Quaternion().setFromRotationMatrix(matrix);
}

/**
 * *手持枪械*的旋转，其枪管轴线在身体轴中为 `direction`。
 *
 * 滚转参照是枪管自身绕棋子横轴俯仰四分之一圈，这是唯一在挥动两端都
 * 读得对的规则：竖持时扳机护圈朝向棋子正前方，平端瞄准时朝向地面，
 * 中间没有翻转。若改为投影身体前方（如 {@link restOrientation} 那样），
 * 枪一指到棋子注视的方向就会立刻塌掉。
 */
function gunOrientation(direction: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = axisY.copy(direction).normalize();
  const reference = axisRef.set(y.x, -y.z, y.y);
  const z = axisZ.copy(reference).addScaledVector(y, -reference.dot(y));
  if (z.lengthSq() < 1e-6) {
    // 枪管恰好横过身体：回退到雕塑的前方。
    z.copy(LOCAL_FRONT).addScaledVector(y, -LOCAL_FRONT.dot(y));
    if (z.lengthSq() < 1e-6) z.copy(LOCAL_FRONT);
  }
  z.normalize();
  const x = axisX.crossVectors(y, z).normalize();
  return out.setFromRotationMatrix(basisMatrix.makeBasis(x, y, z));
}

/**
 * 长枪的枪管继承双拳横向张开的多少。
 *
 * 枪管*过去*直接取两只拳头之间的连线，假设是抵肩动画会把辅助手伸到
 * 前护木上。在实际开枪的骨骼上测量，这个假设不成立：法兰西军团的瞄准
 * 镜头是射箭动画，其中双拳并排横在**胸前**——拳间连线沿棋子横轴跑了
 * 0.90–1.00，沿前轴几乎什么都没有。这本身已经够糟（火枪横躺在人身上
 * 而不是指向任何方向），但被当作枪管*方向*的残余量每个循环还要变好几
 * 次号：线列步兵的瞄准动画一次扫描中前方分量读作 −0.24、−0.23、+0.27、
 * +0.54、+0.40、−0.22、+0.02、−0.28，而它的开火动画在设计好的击发帧
 * 上是 −0.26。于是火枪在指向目标和指回主人肩后之间来回摆动，那一枪是
 * 从反过来的半圈里打出去的。
 *
 * 因此双拳只用来读*倾斜和俯仰*，枪管一律指向目标方向——射手已经转身
 * 面向他要射击的东西（`PieceView.faceTowards`），所以他自己的前方就是
 * 枪口该在的地方。这正是 `sidearm` 持握一直通过前向偏置拥有的保证，
 * 也是长枪过去缺的那一条。
 *
 * 取 0.4 时，平端的火枪大约横过身体 20°——枪托抵着射击肩，枪口朝
 * 辅助手方向越过——这正是从棋盘相机看一杆抵肩长枪的样子。再高就回到
 * 横躺胸前的样子。
 */
const LONG_ARM_CANT = 0.4;

/** 双拳高度差有多少转化为枪管俯仰。 */
const LONG_ARM_PITCH = 0.8;

/**
 * 姿势可以要求的俯仰上限，双向。一个把一只拳头甩高的动画（装填、死亡
 * 时身体下坠）绝不能把枪管立起来。
 */
const LONG_ARM_PITCH_LIMIT = 0.6;

const axisX = new THREE.Vector3();
const axisY = new THREE.Vector3();
const axisZ = new THREE.Vector3();
const axisRef = new THREE.Vector3();
const basisMatrix = new THREE.Matrix4();
const boneLocal = new THREE.Matrix4();
const rootWorldInverse = new THREE.Matrix4();
const fistPosition = new THREE.Vector3();
const fistQuaternion = new THREE.Quaternion();
const fistScale = new THREE.Vector3();
const partnerPosition = new THREE.Vector3();
const barrelAxis = new THREE.Vector3();
const handLine = new THREE.Vector3();
const propRotation = new THREE.Quaternion();
const boneInverse = new THREE.Quaternion();

/** 角度每帧都从实时姿势重新求解的手持道具。 */
interface HeldRig {
  mode: "longArm" | "sidearm";
  /** 道具所挂的手——扣扳机的那只拳头。 */
  bone: THREE.Bone;
  /** 另一只拳头（`longArm`）或枪管跟随的前臂（`sidearm`）。 */
  partner: THREE.Bone | null;
  group: THREE.Group;
  /** 腕部偏移，身体轴，已按持握侧镜像。 */
  offset: THREE.Vector3;
  /** 姿势给不出可用信息时回退的身体轴角度。 */
  fallback: THREE.Vector3;
}

function findBone(root: THREE.Object3D, pattern: RegExp): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((node) => {
    if (found) return;
    const bone = node as THREE.Bone;
    if (bone.isBone && pattern.test(bone.name)) found = bone;
  });
  return found;
}

const RIGHT_HAND = /^(mixamorig)?(right ?hand|hand[_.]?r|r[_.]?hand)$/i;
const LEFT_HAND = /^(mixamorig)?(left ?hand|hand[_.]?l|l[_.]?hand)$/i;

/** 腕骨所挂的骨骼（它的前臂），链条顶端则为 null。 */
function boneParent(bone: THREE.Bone): THREE.Bone | null {
  const parent = bone.parent as THREE.Bone | null;
  return parent?.isBone ? parent : null;
}

/**
 * 按骨骼当前姿态重新求解每个姿势驱动的道具。
 *
 * 骨骼世界矩阵按上一帧留下的状态读取，这在枪管上造成一帧的延迟，在
 * 60fps 下不可见——而每帧强制对三十二副骨骼再跑一遍世界矩阵则不然。
 */
function alignHeld(root: THREE.Object3D, held: HeldRig[], unit: number): void {
  rootWorldInverse.copy(root.matrixWorld).invert();
  for (const rig of held) {
    boneLocal.multiplyMatrices(rootWorldInverse, rig.bone.matrixWorld);
    boneLocal.decompose(fistPosition, fistQuaternion, fistScale);
    const boneScale = Math.max(1e-6, (fistScale.x + fistScale.y + fistScale.z) / 3);

    let solved = false;
    if (rig.partner) {
      boneLocal.multiplyMatrices(rootWorldInverse, rig.partner.matrixWorld);
      partnerPosition.setFromMatrixPosition(boneLocal);
      if (rig.mode === "longArm") {
        // 指向目标方向，倾斜和俯仰由两只拳头的持法给出——绝不由它们
        // *瞄准*，因为在这支军队开火用的动画里，双拳并不跨在枪管两侧
        // （见 {@link LONG_ARM_CANT}）。
        handLine.copy(partnerPosition).sub(fistPosition);
        if (handLine.lengthSq() > (0.06 * unit) ** 2) {
          handLine.normalize();
          barrelAxis.set(
            handLine.x * LONG_ARM_CANT,
            THREE.MathUtils.clamp(handLine.y, -LONG_ARM_PITCH_LIMIT, LONG_ARM_PITCH_LIMIT) *
              LONG_ARM_PITCH,
            1,
          );
          solved = true;
        }
      } else {
        // 前臂穿过手腕，向棋子正前方抬起：垂放的手臂于是低持手枪，而不是
        // 让它垂在自己靴面上。
        barrelAxis.copy(fistPosition).sub(partnerPosition);
        if (barrelAxis.lengthSq() > (0.02 * unit) ** 2) {
          barrelAxis.normalize().addScaledVector(LOCAL_FRONT, 0.5).addScaledVector(WORLD_UP, 0.3);
          solved = true;
        }
      }
    }
    if (!solved) barrelAxis.copy(rig.fallback);

    gunOrientation(barrelAxis, propRotation);
    boneInverse.copy(fistQuaternion).invert();
    rig.group.scale.setScalar(unit / boneScale);
    rig.group.quaternion.copy(boneInverse).multiply(propRotation);
    rig.group.position
      .copy(rig.offset)
      .multiplyScalar(unit)
      .applyQuaternion(boneInverse)
      .divideScalar(boneScale);
  }
}

export interface AttachedArms {
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
  /** 每种材质设计时的自发光强度，用于高亮混合。 */
  baseEmissive: number[];
  /**
   * 挂在主武器顶端的空标记，施法者的火焰在此汇聚。没有功能端的武器为
   * null（剑没有可施法的点）。
   */
  focus: THREE.Object3D | null;
  /**
   * 挂在棋子枪械枪口处的空标记——皇帝拳中的手枪、火枪的枪口、野战炮的
   * 炮口。不带枪的棋子为 null。
   */
  muzzle: THREE.Object3D | null;
  /**
   * 拖曳道具自己的组（炮架），开火时战斗系统可以让它向后坐。除炮兵外
   * 的所有棋子为 null。
   */
  train: THREE.Object3D | null;
  /**
   * 按本帧骨骼姿态重新求解每个姿势驱动道具的角度
   * （见 {@link WeaponSpec.hold}）。开销很小，对只带刀剑的棋子是空操作；
   * 在混合器之后立即调用。
   */
  align: () => void;
}

/**
 * 构建并挂载棋子的武器。
 *
 * @param root    （已摆好姿势的）雕塑根——骨骼矩阵必须是最新的
 * @param unit    棋子在根节点自身单位下的身高
 * @param baseY   根节点自身单位下的脚底线，让道具不蹭地面
 * @param arsenal 用哪支军队的武器家族构建
 */
export function attachWeapons(
  root: THREE.Object3D,
  kind: PieceKind,
  color: Faction,
  unit: number,
  baseY = 0,
  arsenal: ArsenalId = "kingdom",
): AttachedArms {
  const arms: AttachedArms = {
    meshes: [],
    materials: [],
    baseEmissive: [],
    focus: null,
    muzzle: null,
    train: null,
    align: () => undefined,
  };
  const loadout = LOADOUT[arsenal][kind];
  /** 角度每帧都按实时姿势重新求解的道具。 */
  const held: HeldRig[] = [];

  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();

  /**
   * 在 `parent` 下添加道具本体：军队有生成雕塑且已就位时用雕塑，否则
   * 用按棋子制服配色的基础几何体。
   *
   * 无论哪种方式，几何体和纹理由全军共享；只有材质属于这枚棋子，因为
   * 选中高亮、淡入淡出和消散都要写进材质里。
   */
  const dress = (id: WeaponId, parent: THREE.Object3D): void => {
    const sculpted = instanceArmSculpt(id, color);
    if (sculpted) {
      parent.add(sculpted.group);
      arms.meshes.push(...sculpted.meshes);
      arms.materials.push(...sculpted.materials);
      for (const material of sculpted.materials) arms.baseEmissive.push(material.emissiveIntensity);
      return;
    }
    for (const [role, geometry] of weaponGeometries(id)) {
      const material = makeMaterial(role, color);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = role !== "gem";
      mesh.frustumCulled = false;
      parent.add(mesh);
      arms.meshes.push(mesh);
      arms.materials.push(material);
      arms.baseEmissive.push(material.emissiveIntensity);
    }
  };

  /**
   * 把拖曳道具停放在棋子身旁。它以身体坐标系挂在雕塑根节点下，所以会
   * 随棋子移动、转向，但不受骨骼影响——炮车绝不能因炮兵蹲下而跟着蹲。
   */
  const haul = (id: WeaponId): void => {
    const spec = WEAPONS[id];
    const park = spec.park ?? new THREE.Vector3(0.4, 0, -0.1);
    // 火炮保持自身尺寸，停放距离按炮身长度而非棋子身高计算
    // （见 {@link WeaponSpec.bulk}）。
    const size = unit * (spec.bulk ?? 1);
    // 只沿炮自身的轮轴方向压扁，这样轮子保持圆形，而炮车保留所需的高度
    // 与长度（见 {@link WeaponSpec.track}）。缩放在分组自身的旋转内部应用，
    // 所以这里的 X 是炮的 X，而非棋盘的 X。
    const track = spec.track ?? 1;
    const group = new THREE.Group();
    group.name = `train_${id}`;
    group.scale.set(size * track, size, size);
    group.position.set(park.x * size, baseY + park.y * size, park.z * size);
    // 拖行时带一点斜角，让火炮看起来像是被拖着走，而不是整齐停在炮位
    // 线上。角度保持很小：偏航用长度换宽度，这么长的炮车每偏一度都会在
    // 相邻格子上探出一截。
    group.rotation.y = -0.07;
    root.add(group);

    const inner = new THREE.Group();
    group.add(inner);
    arms.train = inner;

    if (spec.muzzle) {
      const muzzle = new THREE.Object3D();
      muzzle.name = `muzzle_${id}`;
      muzzle.position.copy(spec.muzzle);
      inner.add(muzzle);
      arms.muzzle = muzzle;
    }
    dress(id, inner);
  };

  const mount = (id: WeaponId, hand: "right" | "left"): void => {
    const spec = WEAPONS[id];
    // 落地的雕塑会覆盖那两个关于武器自身比例、而非持握方式的数值：生成的
    // 查尔维尔火枪与基础几何体形状不同，其握点与枪口在枪身上的位置也不同。
    // 其余一切——静置角度、手腕偏移、姿态驱动的持握——都属于*装备方案*，
    // 不随雕塑替换而改变。
    const sculpt = armSculpt(id);
    const gripLength = sculpt?.grip ?? spec.grip;
    const muzzleAt = sculpt
      ? sculpt.muzzle === null
        ? null
        : new THREE.Vector3(0, sculpt.muzzle, 0)
      : (spec.muzzle ?? null);
    const bone = findBone(root, hand === "right" ? RIGHT_HAND : LEFT_HAND);
    const otherHand = spec.hold ? findBone(root, hand === "right" ? LEFT_HAND : RIGHT_HAND) : null;

    // 从姿态中读出拳头位置：它在脊柱的哪一侧（骨骼可能是镜像的），以及
    // 高出脚底多少。
    let lateral = hand === "right" ? -1 : 1;
    let handHeight = 0.52;
    let boneScale = 1;
    const inverse = new THREE.Quaternion();

    if (bone) {
      const local = new THREE.Matrix4().multiplyMatrices(rootInverse, bone.matrixWorld);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      local.decompose(position, quaternion, scale);
      boneScale = Math.max(1e-6, (scale.x + scale.y + scale.z) / 3);
      inverse.copy(quaternion).invert();
      if (Math.abs(position.x) > 0.03 * unit) lateral = position.x > 0 ? 1 : -1;
      handHeight = THREE.MathUtils.clamp((position.y - baseY) / unit, 0.15, 0.95);
    }

    const aim = new THREE.Vector3(spec.aim.x * lateral, spec.aim.y, spec.aim.z);
    const offset = new THREE.Vector3(spec.offset.x * lateral, spec.offset.y, spec.offset.z);

    // 防止枪托尖刺和盾沿沉入棋盘：战斗姿态会下蹲，使拳头远低于站立姿态。
    // 手持火枪豁免于此——它从不触地；若为了离地而让枪身沿拳头上滑，就会
    // 变成蹲姿射手倒提枪托底板的怪样子。
    let grip = gripLength;
    if (spec.shield) {
      const bottom = handHeight + offset.y - (spec.half ?? 0.18);
      if (bottom < 0.07) offset.y += 0.07 - bottom;
    } else if (!spec.hold) {
      grip = Math.min(gripLength, Math.max(0.03, handHeight + offset.y - 0.07));
    }

    const rest = restOrientation(aim, spec.shield === true);
    // 弯刀的刀腹朝身体外侧弯而非内侧，这样刀尖会扫向远离棋子的方向，
    // 而不是勾回自己的头顶。
    if (spec.edged === true && lateral > 0) rest.multiply(EDGED_FLIP);
    const group = new THREE.Group();
    group.name = `weapon_${id}`;

    if (bone) {
      group.scale.setScalar(unit / boneScale);
      group.quaternion.copy(inverse.clone().multiply(rest));
      group.position.copy(
        offset.multiplyScalar(unit).applyQuaternion(inverse).divideScalar(boneScale),
      );
      bone.add(group);
    } else {
      // 静态 / 程序化兜底棋子：把武器直接挂在身体上。
      group.scale.setScalar(unit);
      group.quaternion.copy(rest);
      group.position.set(lateral * 0.24 * unit, 0.52 * unit, 0.05 * unit);
      root.add(group);
    }

    if (spec.hold && bone) {
      held.push({
        mode: spec.hold,
        bone,
        // 长兵器由另一只拳头引导；单手短兵器由自身前臂引导。
        partner: spec.hold === "longArm" ? otherHand : boneParent(bone),
        group,
        offset: new THREE.Vector3(spec.offset.x * lateral, spec.offset.y, spec.offset.z),
        fallback: aim.clone(),
      });
    }

    const inner = new THREE.Group();
    inner.position.y = -grip;
    group.add(inner);

    // 施法点跟随道具移动，所以无论这一帧手臂如何挥动，法术总是从水晶
    // 本体发出。
    if (hand === "right" && spec.focus !== undefined) {
      const focus = new THREE.Object3D();
      focus.name = `focus_${id}`;
      focus.position.y = spec.focus;
      inner.add(focus);
      arms.focus = focus;
    }

    // 枪口同理：火光、硝烟与弹丸都从枪炮本体射出，无论开火的手臂把它
    // 挥到了哪里。拖曳火炮优先于手持火枪——炮兵阵地开火用的是大炮，
    // 而非手枪。
    if (muzzleAt && !arms.muzzle) {
      const muzzle = new THREE.Object3D();
      muzzle.name = `muzzle_${id}`;
      muzzle.position.copy(muzzleAt);
      inner.add(muzzle);
      arms.muzzle = muzzle;
    }

    dress(id, inner);
  };

  if (loadout.main) mount(loadout.main, "right");
  if (loadout.off) mount(loadout.off, "left");
  if (loadout.train) haul(loadout.train);

  if (held.length > 0) {
    arms.align = () => alignHeld(root, held, unit);
    // 立即求解一次，避免棋子哪怕一帧以兜底猜测的角度持枪示人。
    arms.align();
  }
  return arms;
}

/**
 * 这些军队所需的雕塑，以任务形式供集结队列与棋子本体一同排队加载。
 *
 * 棋子在创建的那一刻就完成武装，只能用当时手上已有的东西——所以在棋盘
 * 立起来之后才姗姗来迟的雕塑，就是这局游戏永远见不到的一把火枪。因此
 * 集结流程会*等待*这些雕塑，与骨骼同处一个下载窗口（见
 * `scene/gltfQueue.ts`）；没有雕塑武器的军队则完全不添加任何任务。
 */
export function armSculptWarmJobs(arsenals: Iterable<ArsenalId>): (() => Promise<void>)[] {
  const wanted = new Set<WeaponId>();
  for (const arsenal of arsenals) {
    for (const loadout of Object.values(LOADOUT[arsenal])) {
      for (const id of [loadout.main, loadout.off, loadout.train]) {
        if (id && hasArmSculpt(id)) wanted.add(id);
      }
    }
  }
  return [...wanted].map((id) => () => warmArmSculpt(id));
}
