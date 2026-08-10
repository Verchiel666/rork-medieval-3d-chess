/** 画质预设。每一档都真正改变开销，而不只是换个标签。 */

export type QualityPreset = "low" | "medium" | "high" | "ultra";

export interface QualitySettings {
  postFx: boolean;
  bloom: boolean;
  ssao: boolean;
  /** 景深只在电影化时刻才会启用。 */
  dof: boolean;
  grade: boolean;
  smaa: boolean;
  msaaSamples: number;
  shadows: boolean;
  shadowMapSize: number;
  contactShadows: boolean;
  lightShafts: boolean;
  dustCount: number;
  emberCount: number;
  maxPixelRatio: number;
  captureParticles: number;
  /**
   * 每个棋子保持的常态战备姿态——三十二副骨骼每帧都在
   * 呼吸起伏，这才是骨骼动画中真正有开销的部分。关闭时，
   * 棋子改为停在姿态的第一帧。
   *
   * 这刻意*不是*整个动画的总开关：棋子横跨棋盘的步伐、
   * 它的攻击和它的死亡都只有一两个混合器跑一两秒，在
   * 所有预设下都会运行。把走路循环也捆进这个开关，正是
   * 当年手机上棋子变成滑动雕像的原因——移动端默认落在
   * `low`，整排棋子看起来就像丢了动画。
   */
  idleAnimations: boolean;
  /** 每支远方军队列队的实例化剪影士兵数。 */
  troopCount: number;
  /** 城墙外点燃的营火堆数（每一堆都是一盏真实的点光源）。 */
  campfires: number;
  ashCount: number;
  smokeCount: number;
  /** 攻城器械、军旗、战场残骸与盘旋的乌鸦。 */
  battleProps: boolean;
}

export const QUALITY_SETTINGS: Record<QualityPreset, QualitySettings> = {
  low: {
    postFx: false,
    bloom: false,
    ssao: false,
    dof: false,
    grade: false,
    smaa: false,
    msaaSamples: 0,
    shadows: false,
    shadowMapSize: 512,
    contactShadows: true,
    lightShafts: false,
    dustCount: 0,
    emberCount: 0,
    maxPixelRatio: 1,
    captureParticles: 18,
    idleAnimations: false,
    troopCount: 60,
    campfires: 0,
    ashCount: 0,
    smokeCount: 24,
    battleProps: false,
  },
  medium: {
    postFx: true,
    bloom: true,
    ssao: false,
    dof: false,
    grade: true,
    smaa: true,
    msaaSamples: 0,
    shadows: true,
    shadowMapSize: 1024,
    contactShadows: true,
    lightShafts: true,
    dustCount: 220,
    emberCount: 60,
    maxPixelRatio: 1.5,
    captureParticles: 34,
    idleAnimations: true,
    troopCount: 140,
    campfires: 2,
    ashCount: 70,
    smokeCount: 45,
    battleProps: true,
  },
  high: {
    postFx: true,
    bloom: true,
    ssao: false,
    dof: true,
    grade: true,
    smaa: true,
    msaaSamples: 4,
    shadows: true,
    shadowMapSize: 2048,
    contactShadows: true,
    lightShafts: true,
    dustCount: 520,
    emberCount: 120,
    maxPixelRatio: 2,
    captureParticles: 60,
    idleAnimations: true,
    troopCount: 240,
    campfires: 3,
    ashCount: 130,
    smokeCount: 65,
    battleProps: true,
  },
  ultra: {
    postFx: true,
    bloom: true,
    ssao: true,
    dof: true,
    grade: true,
    smaa: true,
    msaaSamples: 4,
    shadows: true,
    shadowMapSize: 4096,
    contactShadows: true,
    lightShafts: true,
    dustCount: 900,
    emberCount: 190,
    maxPixelRatio: 2,
    captureParticles: 90,
    idleAnimations: true,
    troopCount: 320,
    campfires: 4,
    ashCount: 220,
    smokeCount: 90,
    battleProps: true,
  },
};

export const QUALITY_ORDER: QualityPreset[] = ["low", "medium", "high", "ultra"];

/**
 * 首次运行时根据 GPU 字符串、核心数和内存做的猜测。引擎随后
 * 会实测几秒钟的真实帧时长，必要时再降档。
 *
 * `navigator.deviceMemory` 仅 Chromium 支持：Safari 和每一部
 * iPhone 都什么都不报告。把未知默认成 4 GiB 再要求 6，会让
 * *每一台* iOS 设备在第一帧就落到 `low`——这正是手机最终
 * 落在那个关掉了步伐动画的预设上的原因。
 */
export function detectQualityPreset(): QualityPreset {
  if (typeof window === "undefined") return "high";
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  // 没有报告并不等于设备弱小：只在已知时才判断内存。
  const memory = reported ?? Number.POSITIVE_INFINITY;

  let renderer = "";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    }
  } catch {
    renderer = "";
  }

  const weakGpu = /(swiftshader|llvmpipe|software|mali-4|adreno \(tm\) [345]|intel.*hd graphics [2-4])/.test(renderer);
  const strongGpu = /(rtx|radeon rx|apple m[1-9]|geforce gtx 1[06-9]|arc a)/.test(renderer);

  if (weakGpu || cores <= 2 || memory <= 2) return "low";
  // 现如今的手机跑 `medium` 很从容，跑不动时下面的帧率
  // 看门狗会把它降回去。
  if (isTouch) return cores >= 4 && memory >= 3 ? "medium" : "low";
  if (strongGpu && cores >= 8 && memory >= 8) return "ultra";
  if (cores >= 6 && memory >= 4) return "high";
  return "medium";
}
