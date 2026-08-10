/**
 * 让大厅适配正在游戏的屏幕。
 *
 * 引擎里每个相机镜头都是对着宽屏桌面窗口设计的，而透视相机的 `fov`
 * 是*垂直*视角。所以视口越窄，画面里能容纳的棋盘宽度越少——竖握的手机
 * （宽高比 ≈ 0.46）上，46° 镜头只能看到不到一半的纵列，而答案永远不是
 * "直接拉远"：柱廊立在半径 12.5 处，镜头拖过它，大厅自己的柱子就会挡在
 * 玩家和棋盘之间。这就是"地图盖住棋盘"那个 bug。
 *
 * 修法是求解取景而不是手工取景：算出让整个棋盘装进窄轴的距离和镜头，
 * 然后把多出来的距离换成*高度*而不是地面距离，让相机从柱廊上方爬过去，
 * 而不是退进柱廊里。
 */

import * as THREE from "three";

import { TILE } from "./board";

/**
 * 相机在地面平面上离棋盘中心多远之内，柱廊（半径 12.5 的柱子，每根
 * 0.62–0.72 粗）还不会切入棋盘。超出这个距离的部分都得用高度来换。
 */
export const HALL_INNER_RADIUS = 11;

/**
 * 取景必须容纳的球体半径：八条纵列，外加站在最外横排上的棋子和它们
 * 头顶盾牌的余量。
 */
export const BOARD_REACH = TILE * 4 + 0.45;

/** 无论屏幕多窄，引擎会张到的最宽镜头。 */
export const MAX_LENS_FOV = 78;

/** 手机上相机允许的最陡角度——竖屏，再是横屏。 */
const HANDHELD_PORTRAIT_PHI = 0.82;
const HANDHELD_LANDSCAPE_PHI = 1.02;

export interface ViewportProfile {
  width: number;
  height: number;
  /** 绘制表面的 width / height。 */
  aspect: number;
  /** 手大小屏幕上的粗糙指针：手机，或小号平板。 */
  handheld: boolean;
  /** 高大于宽。 */
  portrait: boolean;
}

export interface Framing {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** 垂直视场角，单位为度。 */
  fov: number;
  /** 取景最终定下的离 `target` 的距离。 */
  radius: number;
}

export interface FramingOptions {
  /** 设计镜头时用的焦段——取景永远不会收得更紧。 */
  fov: number;
  /** 这次取景允许张到的最宽镜头。 */
  maxFov: number;
  /** 必须保持在画面内的球体半径。 */
  reach?: number;
  /** 相机最多能被送多远。 */
  maxDistance?: number;
}

export interface OrbitLimits {
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  rotateSpeed: number;
  /** 一次按压最多移动多少像素仍算作对格子的点按。 */
  tapSlop: number;
}

/**
 * 引擎正在绘制到的目标。`handheld` 是真实的能力检测——小屏幕上的粗糙
 * 指针——而不是 user-agent 猜测，所以桌面模式下的手机和狭窄的桌面窗口
 * 都会被如实处理。
 */
export function readViewport(width: number, height: number): ViewportProfile {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const coarse =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  const shortest = Math.min(safeWidth, safeHeight);
  return {
    width: safeWidth,
    height: safeHeight,
    aspect: safeWidth / safeHeight,
    // 任一方向握持的手机，或者窄到玩法与手机一致的窗口。
    handheld: coarse ? shortest <= 820 : safeWidth <= 620,
    portrait: safeWidth < safeHeight,
  };
}

/** 能在*两个*轴上把 `reach` 装进 `distance` 处的垂直 fov（度）。 */
export function fitFov(reach: number, distance: number, aspect: number): number {
  const half = reach / Math.max(0.001, distance);
  const forHeight = Math.atan(half);
  const forWidth = Math.atan(half / Math.max(0.05, aspect));
  return THREE.MathUtils.radToDeg(Math.max(forHeight, forWidth) * 2);
}

/** 在此宽高比下让 `reach` 装进 `fov` 镜头的距离。 */
export function fitDistance(reach: number, fov: number, aspect: number): number {
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const halfWidth = halfHeight * aspect;
  return reach / Math.max(0.05, Math.min(halfHeight, halfWidth));
}

/**
 * 视口允许的最宽镜头。竖握的手机需要最多，因为棋盘宽度必须装进它的
 * 窄轴；普通桌面窗口永远用不到这些，保持它设计时的镜头。
 */
export function lensCeiling(view: ViewportProfile, base: number): number {
  if (view.handheld) return Math.max(base, view.portrait ? 68 : 58);
  return Math.max(base, view.aspect < 1 ? 62 : 52);
}

/**
 * 离棋盘 `radius` 远的相机仍站在柱廊内侧时允许的最陡极角（从正上方
 * 量起）。
 */
export function groundedPhi(radius: number): number {
  return Math.asin(THREE.MathUtils.clamp(HALL_INNER_RADIUS / Math.max(0.001, radius), 0, 1));
}

/**
 * 按屏幕上实际的视口重新求解一个设计好的镜头。
 *
 * 方位角永远不动——镜头从棋盘哪一侧看，就继续从那一侧看。只有距离、
 * 高度和镜头会被求解。
 */
export function frameShot(
  position: THREE.Vector3,
  target: THREE.Vector3,
  view: ViewportProfile,
  options: FramingOptions,
): Framing {
  const reach = options.reach ?? BOARD_REACH;
  const maxFov = Math.max(options.fov, options.maxFov);
  const spherical = new THREE.Spherical().setFromVector3(position.clone().sub(target));
  const authored = spherical.radius;

  // 这个镜头要退多远才能让整个棋盘装进窄轴。宽窗口下它比设计镜头还短，
  // 所以什么都不动，桌面取景和过去一模一样。
  const needed = fitDistance(reach, maxFov, view.aspect);
  spherical.radius = Math.min(Math.max(authored, needed), options.maxDistance ?? 21);

  // 手机从更高处看棋盘：近处横排不再挡住远处横排，点按落在手指覆盖的
  // 格子上。
  if (view.handheld) {
    spherical.phi = Math.min(spherical.phi, view.portrait ? HANDHELD_PORTRAIT_PHI : HANDHELD_LANDSCAPE_PHI);
  }
  // 无论什么角度，多出来的距离都换成高度：越过柱子之后，大厅自己就会
  // 变成挡在棋盘前的东西。
  spherical.phi = Math.min(spherical.phi, groundedPhi(spherical.radius));
  spherical.makeSafe();

  return {
    position: new THREE.Vector3().setFromSpherical(spherical).add(target),
    target: target.clone(),
    fov: THREE.MathUtils.clamp(fitFov(reach, spherical.radius, view.aspect), options.fov, MAX_LENS_FOV),
    radius: spherical.radius,
  };
}

/**
 * 视口的轨道限制。`fitted` 是当前取景定下的半径，这样手机——取景位置
 * 更远——仍然可以越过自己的取景再拉远一点，而不是被钉死在限制上。
 */
export function orbitLimits(view: ViewportProfile, fitted: number): OrbitLimits {
  const handheld = view.handheld;
  return {
    // 双指缩放绝不能把相机埋进前排棋子里。
    minDistance: handheld ? 5.8 : 4.5,
    maxDistance: Math.max(handheld ? 19 : 17, fitted * 1.25),
    minPolarAngle: 0.12,
    // 手机永远不给贴地视角：在眼睛高度棋盘是一条线，满屏都是大厅。
    maxPolarAngle: handheld ? Math.PI / 2 - 0.36 : Math.PI / 2 - 0.08,
    rotateSpeed: handheld ? 0.4 : 0.55,
    tapSlop: handheld ? 16 : 8,
  };
}
