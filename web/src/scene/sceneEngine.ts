import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { ARMY_SKINS, SHOT_MODELS, type ArmySkinId, type ArsenalId, type GunVoice } from "../assets/generated";
import type { GameController } from "../core/gameController";
import { PIECE_LABEL, type Faction, type GameSnapshot, type MoveEvent, type PieceKind, type SquareId } from "../core/types";
import { audio, type FootstepTimbre } from "../audio/audioManager";
import type { ArenaTheme } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { Battlefield } from "./battlefield";
import { JungleOverlay } from "./jungle";
import { BOARD_TOP, BoardView, type HighlightKind, TILE, squareToWorld, worldToSquare } from "./board";
import { CastleHall, buildEnvironmentMap } from "./environment";
import { describeGpu, probeGpu, reflectionProbeWorks, type GpuReport } from "./diagnostics";
import { CheckAlarm } from "./alarm";
import { EffectsSystem, ShakeSystem } from "./effects";
import {
  FACTION_ACCENT,
  PieceFactory,
  PieceView,
  type ClipName,
  type MarchClip,
  type TemplateKey,
} from "./pieces";
import { PLAQUE_ASPECT, promotionPlaqueTexture } from "./rankBadges";
import { PostFX } from "./postfx";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";
import { AMMUNITION, type AmmoKind } from "./ammunition";
import { disposeShatterAssets, impactDust, spawnImpactShatter, type ImpactBody } from "./shatter";
import {
  GUN_LOOK,
  disposeGunAssets,
  flyShot,
  primeShotModel,
  spawnMuzzleFlash,
  spawnPowderCloud,
} from "./gunfire";
import { SPELL_LOOK, SpellLightPool, SpellOrb } from "./spells";
import {
  disposeStrikeAssets,
  spawnConquestClaim,
  spawnGroundWave,
  spawnPillar,
  spawnSlash,
} from "./strikes";
import { Ease, type Easing, TweenManager, wait } from "./tween";
import {
  HALL_INNER_RADIUS,
  frameShot,
  lensCeiling,
  orbitLimits,
  readViewport,
  type Framing,
  type OrbitLimits,
  type ViewportProfile,
} from "./viewport";

export type CameraPreset = "white" | "black" | "top" | "cinematic";

/**
 * 电脑对电脑演示模式下镜头的行为方式。
 *
 * - `still` 保持一个取景不动，绝不自行移动。
 * - `orbit` 绕棋盘缓慢漂移（旧行为）。
 * - `follow` 让正在移动的棋子——以及它走入的战斗——
 *   始终处于画面中心，并在击杀时拉近镜头。
 */
export type ShowcaseCamera = "still" | "orbit" | "follow";

export interface SceneCallbacks {
  onLoadProgress: (ratio: number) => void;
  onReady: () => void;
  onPromotionOpen: (open: boolean) => void;
  onQualityAdjusted: (preset: QualityPreset) => void;
  onFps: (fps: number) => void;
  onContextLost: () => void;
  onCameraFlipped?: (flipped: boolean) => void;
  onTacticalView?: (active: boolean) => void;
  /**
   * 当引擎不得不舍弃部分渲染管线才能在屏幕上出图时触发。
   * 一旦完全退回安全渲染模式，`safe` 为 true，
   * 此时 UI 可以把该选择持久化，供下次访问使用。
   */
  onRenderFallback?: (message: string, safe: boolean) => void;
}

interface CameraShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const CAMERA_SHOTS: Record<CameraPreset, CameraShot> = {
  white: { position: new THREE.Vector3(0, 6.4, 8.6), target: new THREE.Vector3(0, 0.35, 0) },
  black: { position: new THREE.Vector3(0, 6.4, -8.6), target: new THREE.Vector3(0, 0.35, 0) },
  top: { position: new THREE.Vector3(0, 12.4, 0.35), target: new THREE.Vector3(0, 0.2, 0) },
  cinematic: { position: new THREE.Vector3(9.6, 3.6, 6.8), target: new THREE.Vector3(-0.4, 0.5, -0.4) },
};

/**
 * 演示模式取景：比电影镜头更高更远，
 * 让整个棋盘一览无余，没有棋子会被地面的雾霭遮住。
 * 这是静态演示在整场对局中保持的机位。
 */
const SHOWCASE_SHOT: CameraShot = {
  position: new THREE.Vector3(7.1, 6.5, 8.2),
  target: new THREE.Vector3(0, 0.35, 0),
};

/** 跟随镜头在走子间隙注视的位置。 */
const BOARD_FOCUS = new THREE.Vector3(0, 0.45, 0);

/**
 * 跟随骨骼向动作方向倾斜的程度，取从棋盘中心到被跟随棋子距离的分数。
 *
 * 完全追逐（1）会把棋子放在画面正中央，但也会把视线横向拖出
 * 整整一个棋盘宽——每次近侧走子都会直撞大厅墙壁。
 * 适度倾斜能让整个局势保持在画面内，骨骼也始终处于开阔空间中。
 */
const FOLLOW_LEAN = 0.72;

/**
 * 当大厅在动作后方没有多余空间时，跟随骨骼在开始爬升之前
 * 愿意放弃的距离比例。向前一步对画面的代价远小于
 * 向俯视角度爬升。
 */
const FOLLOW_GIVE = 0.18;

/** 跟随骨骼的眼睛与大厅墙壁之间保持的间隙。 */
const FOLLOW_WALL_MARGIN = 0.4;

/**
 * 平面战术地图：高悬于棋盘正上方，用窄焦镜头拍摄，
 * 让格子呈现为网格而非渐远的透视。
 */
const TACTICAL_SHOT: CameraShot = {
  position: new THREE.Vector3(0, 22, 0.55),
  target: new THREE.Vector3(0, 0, 0),
};
const TACTICAL_FOV = 28;
const DEFAULT_FOV = 46;

/**
 * 一个格子的四个角，沿其周界以半个瓦片为步长走一圈的 `(x, z)` 序列。
 * 顺序很重要：绕向决定了四次边相交检测能构成点在四边形内的测试。
 */
const FOOTPRINT_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * 上述镜头机位所针对的创作视口。每个取景都会针对实际绘制的表面
 * 重新求解（`scene/viewport.ts`）——一部竖持的手机
 * 需要不同的距离、仰角和镜头才能看到同一个棋盘。
 */
const AUTHORED_VIEW: ViewportProfile = {
  width: 1440,
  height: 900,
  aspect: 1.6,
  handheld: false,
  portrait: false,
};

/**
 * 兵可以升变为什么，以及选择它的按键。排列顺序就是布局顺序——
 * 最好的排最前，这样最常用的选择就是视线最先落在的最左边那个。
 */
const PROMOTION_CHOICES: readonly { kind: PieceKind; key: string }[] = [
  { kind: "q", key: "Q" },
  { kind: "r", key: "R" },
  { kind: "b", key: "B" },
  { kind: "n", key: "N" },
];

/** 候选棋子的缩放比例，以及底座之间的世界间距。 */
const PROMOTION_SLOT_SCALE = 0.92;
const PROMOTION_SPACING = 1.5;
const PROMOTION_ROW_GAP = 2;
/** 一个槽位内容（底座、棋子、铭牌）的世界单位高度。 */
const PROMOTION_SLOT_HEIGHT = 1.75;
/** 一个槽位的最宽处——是铭牌，而不是棋子。 */
const PROMOTION_SLOT_WIDTH = 1.3;
/** 整个选择器求解后占据视口短轴的比例。 */
const PROMOTION_FILL = 0.84;
/** 幕布挂在候选棋子身后多远的位置。 */
const PROMOTION_SCRIM_DEPTH = 1.8;

/** 一个候选项：它的底座、旋转的棋子和铭牌。 */
interface PromotionSlot {
  kind: PieceKind;
  /** 每帧由布局求解定位。 */
  group: THREE.Group;
  /** 只承载棋子，这样待机动画旋转时不会晃动铭牌。 */
  spin: THREE.Group;
  view: PieceView;
  plaque: THREE.Sprite;
  pedestal: THREE.Mesh;
  /** 静止时为 0，指针悬停时为 1；经过平滑处理，驱动抬升和辉光。 */
  attention: number;
}

/**
 * 黑屏看门狗对帧进行采样的时间点，以自首帧起的秒数计。
 * 第一次检查足够晚，此时大厅已就位，开场动画也已离开起始帧。
 */
const DARK_FRAME_CHECKS = [2, 3.4, 4.8, 6.2, 8];

/**
 * 各棋子倒下时的喊声：宫廷和大型棋子死得更响、更低沉，
 * 步卒则更轻、更尖。
 */
const CRY_WEIGHT: Record<PieceKind, { volume: number; rate: number }> = {
  k: { volume: 1.1, rate: 0.94 },
  q: { volume: 1.05, rate: 0.98 },
  r: { volume: 1, rate: 0.92 },
  b: { volume: 0.92, rate: 1 },
  n: { volume: 0.95, rate: 1.01 },
  p: { volume: 0.85, rate: 1.05 },
};

/**
 * 棋身燃尽时留下的微粒颜色：白曜王国是冰冷的
 * 魂光，太阳帝国是跃动的余烬。
 */
const EMBER_COLOR: Record<Faction, number> = {
  w: 0xbcd8ff,
  b: 0xff8a3c,
};

/**
 * 各棋子压在棋盘上的分量——驱动棋子被拿起或放下时
 * 木击声的音高、余响和响度。
 */
const WOOD_WEIGHT: Record<PieceKind, number> = {
  k: 1,
  q: 0.88,
  r: 0.82,
  b: 0.52,
  n: 0.58,
  p: 0.3,
};

/** 一个棋子如何凭自己的双腿横越棋盘。 */
interface Gait {
  /** 每行进一格落下的脚步数——即步幅长度。 */
  stepsPerTile: number;
  /** 每秒脚步数——行军的步频。 */
  cadence: number;
  /** 靴子踏在石面上的音色。 */
  timbre: FootstepTimbre;
  /** 一次脚步的响度。 */
  volume: number;
}

/**
 * 十二个棋子的走法各不相同。步卒迈着短促的拖步；
 * 塔楼卫士身披全甲缓步而行；王则以一种棋盘上
 * 无人能催促的从容步调横越棋盘。
 */
const GAITS: Record<PieceKind, Gait> = {
  k: { stepsPerTile: 1.55, cadence: 1.85, timbre: "regal", volume: 1 },
  q: { stepsPerTile: 1.7, cadence: 2.1, timbre: "regal", volume: 0.88 },
  r: { stepsPerTile: 1.5, cadence: 1.95, timbre: "plate", volume: 1.12 },
  b: { stepsPerTile: 1.9, cadence: 2.45, timbre: "leather", volume: 0.78 },
  n: { stepsPerTile: 2, cadence: 2.9, timbre: "plate", volume: 0.95 },
  p: { stepsPerTile: 2, cadence: 2.7, timbre: "scuff", volume: 0.72 },
};

/**
 * 从不触碰所杀之物的两个棋子：女巫王后与持杖法师。
 * 两者都在原地开战，沿直线掷出火球，只有等格上的躯体
 * 燃尽后才走上那个格子。在 Grande Armée 的军械下，同样
 * 这两个棋子保持距离，但以火药取代火焰（见 {@link attackStyle}）。
 */
const RANGED_KINDS: PieceKind[] = ["q", "b"];

/**
 * 计入所在军队的军械后，一个棋子如何开战。
 *
 * - `melee`——走近并挥击（见 {@link STRIKES}）。
 * - `spell`——原地聚火并掷出（见 {@link SPELLS}）。
 * - `gun`——端平枪管射击（见 {@link GUNS}）。
 *
 * Grande Armée 是唯一以火药作战的军队：皇帝与他的指挥官
 * 用燧发枪了结对手，元帅单膝跪地用线膛枪射击，线列步兵
 * 以火枪齐射作战，炮兵则用它拖曳的野战炮。只有胸甲骑兵
 * 仍然挥刀冲锋——这正是骑兵的本分。这支军队中无人施法。
 */
type AttackStyle = "melee" | "spell" | "gun";

const GUNPOWDER_KINDS: PieceKind[] = ["k", "q", "b", "r", "p"];

function attackStyle(kind: PieceKind, arsenal: ArsenalId): AttackStyle {
  if (arsenal === "empire" && GUNPOWDER_KINDS.includes(kind)) return "gun";
  return RANGED_KINDS.includes(kind) ? "spell" : "melee";
}

/**
 * 一个棋子的一击如何编排。近身击杀的形态从不改变——
 * 冲锋、对峙、挥击、崩解——但它的分量会变，且随棋子
 * 等级递增：步卒一刺而过，骑手冲锋中挥砍，塔楼卫士
 * 把地板砸得变形，而王在挥击前先召下光柱。
 */
interface StrikeProfile {
  /** 节拍期间保持的镜头推近度数。 */
  zoom: number;
  /** 冲入对峙时的行军速度倍率。 */
  charge: number;
  /** 抵达与挥击之间的屏息停顿。 */
  wind: number;
  /** 缩放闪光、火花、棋盘震动与镜头冲击。 */
  power: number;
  /** 挥击破空的响度；0 表示蓄力无声。 */
  swing: number;
  /** 0 = 轻刃，1 = 被拖拽挥舞的攻城武器。 */
  heft: number;
  /** 刀刃划过之处留下的钢铁弧光。 */
  slash: { size: number; color: number } | null;
  /** 沿石面滚出的冲击波，用于砸及地面的一击。 */
  wave: { radius: number; color: number } | null;
  /** 在挥击前落在死囚身上的光柱。 */
  pillar: { radius: number; color: number } | null;
  /** 沿冲锋路径扬起的尘土。 */
  wake: boolean;
  /** 击打一拍后的二次震颤；0 表示大厅保持平静。 */
  aftershock: number;
  /** 接触帧的顿帧，发生在躯体开始倒下之前。 */
  hold: number;
}

/**
 * 六种击打，按棋子的价值排序。步卒的那一行是
 * 原始节拍，刻意保持不动——它之上的所有节拍都以它为基准衡量。
 */
const STRIKES: Record<PieceKind, StrikeProfile> = {
  p: {
    zoom: 5.5,
    charge: 1.35,
    wind: 0.1,
    power: 1,
    swing: 0,
    heft: 0,
    slash: null,
    wave: null,
    pillar: null,
    wake: false,
    aftershock: 0,
    hold: 0,
  },
  // 骑手到来得比对手能应对的更快，在掠过的途中挥砍。
  n: {
    zoom: 7.2,
    charge: 1.75,
    wind: 0.04,
    power: 1.35,
    swing: 0.7,
    heft: 0.3,
    slash: { size: 1.7, color: 0xfff3d8 },
    wave: null,
    pillar: null,
    wake: true,
    aftershock: 0.12,
    hold: 0.05,
  },
  // 法师永远只在远距作战；这只是安全兜底，不是一个节拍。
  b: {
    zoom: 6,
    charge: 1.4,
    wind: 0.12,
    power: 1.15,
    swing: 0.45,
    heft: 0.15,
    slash: { size: 1.2, color: 0xd8e6ff },
    wave: null,
    pillar: null,
    wake: false,
    aftershock: 0,
    hold: 0.03,
  },
  // 板甲与战锤：进场缓慢，石面承受了这一击的大部分力道。
  r: {
    zoom: 8.6,
    charge: 1.1,
    wind: 0.24,
    power: 1.8,
    swing: 1,
    heft: 0.95,
    slash: null,
    wave: { radius: 3.2, color: 0xffa257 },
    pillar: null,
    wake: false,
    aftershock: 0.3,
    hold: 0.09,
  },
  // 永远不会触发——女巫在自己所在的格子上烧死猎物。
  q: {
    zoom: 8,
    charge: 1.3,
    wind: 0.16,
    power: 1.6,
    swing: 0.6,
    heft: 0.35,
    slash: { size: 1.5, color: 0xffe0b0 },
    wave: null,
    pillar: null,
    wake: false,
    aftershock: 0.14,
    hold: 0.06,
  },
  // 一场处决，而非战斗：光柱落下，钟声响起，然后是金光。
  k: {
    zoom: 11,
    charge: 1.2,
    wind: 0.3,
    power: 2.25,
    swing: 1,
    heft: 0.7,
    slash: { size: 2, color: 0xffdf9a },
    wave: { radius: 3.7, color: 0xffcf7a },
    pillar: { radius: 0.6, color: 0xffe3a8 },
    wake: false,
    aftershock: 0.34,
    hold: 0.13,
  },
};

/**
 * 一次吃子的声势大小，由被吃的是什么决定——而非吃子的是谁。
 *
 * 这是棋盘上唯一属于*受害者*的权重：一个兵兑子和一个后倒下
 * 是同一套编排，在格子易手的那一刻，唯一能区分它们的
 * 是这次宣告被允许发出多大的声光。按棋子的实际价值排序，
 * 这样耳朵不看托盘就能听出交换。
 */
const CONQUEST_WEIGHT: Record<PieceKind, number> = {
  p: 0.16,
  n: 0.42,
  b: 0.46,
  r: 0.64,
  q: 0.88,
  k: 1,
};

/** 施法者掷出多少火焰，以及落地时的效果。 */
interface SpellProfile {
  /** 节拍期间保持的镜头推近度数。 */
  zoom: number;
  /** 在施法剪辑之上叠加的蓄力秒数。 */
  gather: number;
  /** 杖首凝聚的火球大小。 */
  orb: number;
  /** 沿直线射出的电光数。 */
  bolts: number;
  /** 缩放远端的爆炸。 */
  blast: number;
  /** 在格子上滚开的火环半径；0 表示无。 */
  ring: number;
}

/** 法师：一记干净掷出的电光。 */
const MAGE_SPELL: SpellProfile = { zoom: 4.5, gather: 0, orb: 0.42, bolts: 1, blast: 1, ring: 0 };

/**
 * 女巫：更长、更重的凝聚，三连齐射——前两发在躯体上
 * 炸开，随后一记致命电光连同格子一起吞没。
 */
const QUEEN_SPELL: SpellProfile = { zoom: 7.5, gather: 0.28, orb: 0.66, bolts: 3, blast: 1.75, ring: 3.4 };

function spellProfile(kind: PieceKind): SpellProfile {
  return kind === "q" ? QUEEN_SPELL : MAGE_SPELL;
}

/**
 * 一根枪管的表现。一切都按口径缩放：燧发手枪是一声脆响
 * 加一缕烟，火枪能把人击倒，而野战炮会把它架着的格子
 * 重新摆布一遍。
 */
interface GunProfile {
  /** 节拍期间保持的镜头推近度数。 */
  zoom: number;
  /** 端平枪管与开火之间的屏息停顿。 */
  aim: number;
  /** 这一级棋子击发的是哪一段录音枪管（见 `GUN_AUDIO_URLS`）。 */
  voice: GunVoice;
  /**
   * 击发延时：从扳机脱开到主装药点燃的秒数。
   *
   * 真实存在，而且听得见。燧发枪从阻铁释放到弹丸开始运动需要
   * 40–70ms——阻铁、燧石击砧、药池闪光、然后是枪管——
   * 而在火门上点燃的野战炮耗时更长。引擎把射击的机械半段
   * 提前这么远播放，好让耳朵能听见扳机被扣动，再听见枪回应它。
   */
  lock: number;
  /**
   * 射击操练被允许占用的秒数，以及弹丸出膛所处的那一段比例。
   *
   * 火器剪辑是操练而不是挥砍：手臂抬起，枪管端平，头低向
   * 瞄具，然后击锤才落下。以剑客的间距播放时，整个过程在
   * 三分之一秒内结束，那一枪看起来像从站姿里凭空出现的
   * 一道闪光——这正是它过去看起来的样子。所以每根枪管
   * 都命名自己的可读时长和自己的点火时刻。
   */
  drill: { seconds: number; impact: number };
  /** 0 = 手枪击发机构，0.5 = 火枪，1 = 野战炮——驱动整个混音。 */
  calibre: number;
  /**
   * 枪口焰的宽度，以弹丸*渲染*直径的倍数表示
   * （`ball` × 弹药的 `gauge`），而不是绝对尺寸。
   *
   * 这必须是一个比值，而不是世界单位数。弹丸按可辨认的口径
   * 绘制——真实口径的 1.7–2.6 倍——而当枪口焰独立制作时
   * 两者会逐渐脱节：一颗雕刻出来的米涅弹从一道只有三个
   * 弹丸直径宽的火焰里射出，于是抛射物比把它发射出去的
   * 装药还亮。把火焰绑到决定弹丸尺寸的同一个数上，
   * 更大的弹丸自然得到更大的枪口焰。
   *
   * 真实的黑火药大约喷出 4–8 倍口径的火焰；燃烧干净的
   * 线膛枪管位于该范围的下限，野战炮位于上限。
   */
  flare: number;
  /**
   * 这根枪管里压入的是哪种弹丸（见 `scene/ammunition.ts`）。
   * 它决定横越棋盘之物的形态、它飞的是直线还是会飘移，
   * 以及它抵达时是冷弹还是仍带余辉。
   */
  ammo: AmmoKind;
  /** 以世界单位计的口径——弹丸按它缩放。 */
  ball: number;
  /**
   * 弹丸横越一格所花的秒数。
   *
   * 这里没有任何东西是枪口初速：真实的弹丸横越这个大厅的
   * 八个格子大约只要百分之一秒，也就是一帧，所以那一枪
   * 根本看不见。这些是电影速度——慢到能在弹丸出膛时
   * 接住它并跟随它进入躯体，又快到仍读作子弹而不是
   * 掷出的石块。枪管之间的顺序保持真实：线膛枪最快，
   * 野战炮最慢。
   */
  speed: number;
  /** 悬挂在枪管前方烟团中的烟缕数。 */
  smoke: number;
  /**
   * 火药烟的颜色，null 表示取军队的制服色调。线膛枪管
   * 发射小份量、紧包布的装药，几乎完全燃烧，所以它的烟
   * 是淡灰白，而滑膛枪的是煤烟色。
   */
  smokeTint: number | null;
  /** 烟团看起来的浓度。1 = 一次火枪齐射；低于它则薄而透。 */
  smokeDensity: number;
  /** 细粒火药：更淡、更丝缕状的烟缕，快速升起又迅速散开。 */
  fineSmoke: boolean;
  /**
   * 从击锤落下到烟团最后一缕消散的秒数。
   *
   * 火药烟是枪产生的最慢的东西——枪口焰只有三帧，弹丸
   * 只有半秒，但烟云在两者之后仍久久飘荡在格子上空。
   * 这个值过去从 calibre 推导出来，然后对线膛枪管*缩短*，
   * 结果射手的枪几乎在躯体倒下之前就把空气荡清了。现在
   * 按枪管逐一定义，每一根的烟都比自己的那一枪活得久。
   */
  smokeHang: number;
  /**
   * 击发后枪管继续渗烟的秒数，以及渗出的烟缕数。与烟团
   * 不同——烟团只生成一次、留在击发处的空气中——这是
   * 从*活的*枪口发出的，所以它会跟随枪管随士兵放低武器
   * 而移动。0 表示无。
   */
  boreSmoke: { seconds: number; wisps: number };
  /** 缩放远端的命中：闪光、火花、格子震动与镜头冲击。 */
  blast: number;
  /** 躯体被枪击掀退的距离，以格子计。 */
  kick: number;
  /** 拖曳式火炮在轮子上后退的距离，以棋子身高计。 */
  recoil: number;
  /** 弹丸落点处沿石面滚出的冲击波；null 表示无。 */
  wave: { radius: number; color: number } | null;
  /** 弹丸抵达帧上的顿帧。 */
  hold: number;
  /** 击发一拍后的二次震颤；0 表示大厅保持平静。 */
  aftershock: number;
  /**
   * 这一枪是站姿还是单膝跪姿射出，以及——对跪姿射手而言——
   * 落到石面上要花多长时间。
   *
   * 这不是装饰：它决定*枪从哪种姿势击发*。站姿枪手播放他的
   * 射击操练，因为这类剪辑每一个都以站姿起、以站姿收，
   * 操练与周围的站姿自然吻合。跪姿枪手没有这样的剪辑——
   * 生成器里那段看似跪姿的素材实测是一个站-蹲-站循环，
   * 其点火帧落在人直立时（见 `assets/generated.ts` 中的
   * 射手注释）——所以他在扳机、枪响与后坐的全过程中
   * 保持跪姿瞄准，跪着完成装填，只有等躯体被清走才起身。
   * 一枪一个姿势：没有人在击杀中途上下起伏。
   */
  stance: { kneel: false } | { kneel: true; drop: number };
}

/**
 * Grande Armée 的枪管，按它们的价值排序。
 *
 * 手枪刻意是棋盘上最安静的击杀——皇帝不需要喧闹——
 * 而野战炮是整个大厅里最响的东西，比王冠的审判还要响。
 */
const GUNS: Record<PieceKind, GunProfile> = {
  // 军官的燧发枪：举枪、击发、了结。烟团小得不值一提。
  k: {
    zoom: 7,
    aim: 0.34,
    voice: "pistol",
    // 一支调校精良的决斗击发机构：大厅里最快的点火。
    lock: 0.042,
    // 快速拔枪讲求的就是快，但手枪仍必须被看见抬起来
    // 并指向目标之后才能击发。
    drill: { seconds: 1.15, impact: 0.5 },
    calibre: 0.06,
    flare: 4.4,
    ammo: "pistolBall",
    ball: 0.055,
    speed: 0.1,
    smoke: 5,
    smokeTint: null,
    smokeDensity: 0.85,
    fineSmoke: false,
    smokeHang: 1.7,
    boreSmoke: { seconds: 0.7, wisps: 3 },
    blast: 1.1,
    kick: 0.05,
    recoil: 0,
    wave: null,
    hold: 0.06,
    aftershock: 0,
    // 站定原地处决：皇帝不会为了枪杀一个人而下跪。
    stance: { kneel: false },
  },
  // Charleville 火枪：上肩、一声脆响和一团白烟。
  p: {
    zoom: 5.5,
    aim: 0.3,
    voice: "musket",
    // 制式火枪枪机，粗装药：比军官的手枪慢。
    lock: 0.058,
    // 火枪从肩上放下、端平、击发：枪声落在全程过半之后。
    drill: { seconds: 1.3, impact: 0.56 },
    calibre: 0.44,
    flare: 4.7,
    // .69 口径软铅弹——棋盘上最粗的轻武器弹丸，
    // 也是偏离瞄准线最厉害的一颗。
    ammo: "musketBall",
    ball: 0.078,
    speed: 0.108,
    smoke: 8,
    smokeTint: null,
    smokeDensity: 1,
    fineSmoke: false,
    smokeHang: 2.5,
    boreSmoke: { seconds: 1, wisps: 4 },
    blast: 1,
    kick: 0.07,
    recoil: 0,
    wave: null,
    hold: 0.05,
    aftershock: 0,
    // 线列站姿肩并肩开火——这就是线列的本义。
    stance: { kneel: false },
  },
  // 野战炮：炮组让开，炮身后座，石面嗡嗡作响。
  r: {
    zoom: 10,
    aim: 0.42,
    voice: "cannon",
    // 根本不是枪机：一根火绳凑到火门上，引药着起，
    // 然后是主装药。从下令到轰鸣之间最漫长的等待。
    lock: 0.12,
    // 炮组走到炮架旁拉住拉火绳——不慌不忙。
    drill: { seconds: 1.25, impact: 0.52 },
    calibre: 1,
    // 大厅里最重的装药，伴随着最宽的一片火焰。
    flare: 6,
    // 实心铁弹，刚从砂模里出来，还带着炮膛的热度。
    ammo: "roundShot",
    // 棋盘上唯一重到光凭自身就值得目送的弹丸。
    ball: 0.17,
    speed: 0.125,
    smoke: 14,
    smokeTint: null,
    smokeDensity: 1.15,
    fineSmoke: false,
    smokeHang: 3.8,
    boreSmoke: { seconds: 1.6, wisps: 6 },
    blast: 2.1,
    kick: 0.04,
    recoil: 0.19,
    wave: { radius: 3.6, color: 0xffb271 },
    hold: 0.12,
    aftershock: 0.32,
    // 炮组站着伺候火炮；只有装填才跪下。
    stance: { kneel: false },
  },
  // 线膛长枪，单膝跪姿击发：棋盘上最漫长的屏息，
  // 弹道最平、速度最快的弹丸。火焰和烟都比线列的火枪少——
  // 神射手是干净利落的一声脆响，不是齐射。它的装药小且包布紧实，
  // 燃烧干净：这根枪管喷出的烟团是淡灰白色，
  // 薄得能透过它看见目标，一拍之间便散去。
  b: {
    // 像大厅里其他每一枪一样取景。这里曾经是棋盘上最狠的
    // 镜头推近，配着一幅盖住界面的全屏瞄准画面；两者都已去掉。
    // 现在这一枪从与线列步兵齐射相同的距离观看——
    // 画面中跪着的人才是看点，而不是裹着他的镜头特效。
    zoom: 5.5,
    // 他跪下之后、扣扳机之前的屏息——跪落到膝上如今是
    // 独立的一拍（见 `stance.drop`），所以这里不再需要覆盖它。
    aim: 0.55,
    voice: "rifle",
    // 神射手的配枪，手工装配、精细装药——击发很快，
    // 因为慢的枪机会在他本该命中的距离上把子弹甩偏。
    lock: 0.038,
    // 仍是棋盘上从举枪到击锤落下之间最久的等待。
    // 这些数字不再重排任何剪辑的时长——跪姿射击是从
    // 保持瞄准中击发而非从操练中击发（见 `stance`）——
    // 所以它们现在纯粹是*节拍*：击发前 1.02 秒的据枪瞄准。
    drill: { seconds: 1.7, impact: 0.6 },
    calibre: 0.5,
    // 小份量、紧包布的装药几乎完全燃烧：棋盘上任何枪管中
    // 火焰最小的一支，与它淡灰白的烟相称。
    flare: 4.9,
    // 全军唯一背后有膛线的弹丸：锥形、高速自旋，
    // 在棋盘上每颗球弹都会飘移的地方笔直到底。
    ammo: "minieBullet",
    ball: 0.05,
    // 大厅里弹道最平、最快的一发，线膛枪本该如此。
    speed: 0.082,
    // 神射手的招牌。线膛装药产生的烟远少于线列的火枪，
    // 所以答案绝不是把它做得*更浓*——而是做得更多、更薄，
    // 让它在空气里悬得足够久，久到能看着它散开。
    // 淡灰白色，薄得能透过它读出棋盘，而脆响过后
    // 枪管还在他手中继续冒烟一拍半。
    smoke: 12,
    smokeTint: 0xdfe4ea,
    smokeDensity: 0.74,
    fineSmoke: true,
    smokeHang: 3.2,
    boreSmoke: { seconds: 1.5, wisps: 6 },
    blast: 1.2,
    kick: 0.06,
    recoil: 0,
    wave: null,
    hold: 0.08,
    aftershock: 0,
    // 棋盘上唯一贴地而战的人。0.85s 是带着武器
    // 单膝跪下实际需要的时间——起身剪辑倒放正好覆盖它，
    // 所以是膝盖扎稳，而不是身体下沉。
    stance: { kneel: true, drop: 0.85 },
  },
  // 指挥官的燧发枪：皇帝本人的武器，多握一拍。
  // 她全站姿击发，左手仍握着马伦戈剑，所以操练从容，
  // 枪声也比他的更饱满一分——这是在执行命令，而非赢得决斗。
  q: {
    zoom: 7.5,
    aim: 0.4,
    voice: "pistol",
    lock: 0.046,
    drill: { seconds: 1.35, impact: 0.54 },
    calibre: 0.12,
    flare: 4.6,
    ammo: "pistolBall",
    ball: 0.058,
    speed: 0.096,
    smoke: 6,
    smokeTint: null,
    smokeDensity: 0.9,
    fineSmoke: false,
    smokeHang: 1.9,
    boreSmoke: { seconds: 0.8, wisps: 3 },
    blast: 1.25,
    kick: 0.055,
    recoil: 0,
    wave: null,
    hold: 0.07,
    aftershock: 0,
    // 全站姿，剑仍握在左手。
    stance: { kneel: false },
  },
  n: {
    zoom: 6,
    aim: 0.16,
    voice: "musket",
    // 卡宾枪枪机，在马背上操作：快，且略显粗糙。
    lock: 0.052,
    drill: { seconds: 1.1, impact: 0.5 },
    calibre: 0.4,
    flare: 4.6,
    // 骑兵卡宾枪：与线列同款的弹丸，配更短的枪管。
    ammo: "musketBall",
    ball: 0.072,
    speed: 0.106,
    smoke: 6,
    smokeTint: null,
    smokeDensity: 1,
    fineSmoke: false,
    smokeHang: 2.1,
    boreSmoke: { seconds: 0.8, wisps: 4 },
    blast: 1,
    kick: 0.06,
    recoil: 0,
    wave: null,
    hold: 0.05,
    aftershock: 0,
    // 骑兵不下跪；他几乎不停下脚步。
    stance: { kneel: false },
  },
};

/**
 * 给定枪管的火焰绘制的世界单位宽度。
 *
 * 一次射击尺寸的唯一事实来源：弹丸的渲染直径
 * （口径 × 来自 `ammunition.ts` 的可辨识系数）乘以枪管
 * 自己的 {@link GunProfile.flare}。枪口处的一切——枪口焰、
 * 火星雨、弹丸离膛多远生成——都按这一个数字缩放，
 * 所以修改弹丸口径永远不会把它的枪口焰落下。
 */
function muzzleFlare(gun: GunProfile): number {
  return gun.ball * AMMUNITION[gun.ammo].gauge * gun.flare;
}

/**
 * 弹丸拖尾中的脊线采样数，由粒子预算读出。
 *
 * 拖尾是每帧重建的几何体，所以它的开销就是采样数，
 * 仅此而已。即使最低档也仍画出可读的拖尾——路径的形状
 * 由少数几个环承载；其余只是飘移弹丸所飞曲线上的平滑度。
 */
function trailRings(budget: number): number {
  if (budget >= 60) return 26;
  if (budget >= 34) return 20;
  return 12;
}

/**
 * 大厅自身的空气流动，以世界单位每秒计。
 *
 * 几乎只是一缕呼吸——每秒几厘米——但正是它让火药烟团
 * 从一团在原地变暗的云变成*被带离格子*的云。棋盘上每根
 * 枪管共享它，所以两军的烟朝同一个方向飘，棋盘读起来像一个房间。
 */
const HALL_DRAFT = new THREE.Vector3(0.075, 0.012, -0.045);

/**
 * 行军距离曲线：短暂起步，长段匀速，再短暂收步。
 * 步伐时钟以固定步频运转，所以一条全程缓动的曲线
 * （滑动棋子所用的那种）会让双脚在走子的两端明显打滑。
 *
 * @param ramp 加速所占的行程比例，减速同样占此比例
 */
function strideEasing(ramp: number): Easing {
  const r = Math.min(0.4, Math.max(0.02, ramp));
  // 归一化之前，起步加速 + 匀速巡航 + 收步减速所覆盖的距离。
  const span = 1 - r;
  return (t: number): number => {
    if (t <= r) return t * t * 0.5 / r / span;
    if (t >= 1 - r) {
      const rest = 1 - t;
      return (span - rest * rest * 0.5 / r) / span;
    }
    return (t - r * 0.5) / span;
  };
}

/**
 * 拥有所有 three.js 对象。棋类核心通过事件和动画钩子
 * 驱动它；React 只调用底部那组小型命令式 API。
 */
export class SceneEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private hall: CastleHall;
  private battlefield: Battlefield;
  /** 雨林装饰——只有太阳神庙地图会布置。 */
  private jungle: JungleOverlay;
  private board = new BoardView();
  private effects = new EffectsSystem();
  /** 被将军的王头顶的红光（见 {@link CheckAlarm}）。 */
  private alarm = new CheckAlarm();
  /**
   * 法术唯一允许使用的点光源。它们只向场景添加一次并复用，
   * 因为场景灯光数量的每次变化都会让 three.js 重编译大厅里的
   * 所有材质——女巫的三连射过去一秒内会触发八次，把标签页卡死。
   */
  private spellLights: SpellLightPool;
  private shake = new ShakeSystem();
  private tweens = new TweenManager();
  private factory = new PieceFactory();
  private postfx: PostFX;

  private pieces = new Map<SquareId, PieceView>();
  private captured: PieceView[] = [];
  /**
   * 正在走子途中的棋子。动画期间它们会从 `pieces` 中移除，
   * 所以没有这个集合，它们的混合器永远不会被推进，
   * 攻击/死亡剪辑会冻结在第一帧。
   */
  private motion = new Set<PieceView>();
  /**
   * 每次从棋类核心重建棋盘（画质变更、悔棋、新开一局）时递增。
   * 已在运行的走子动画持有的是已不存在的视图，所以它在每次
   * await 之后检查此值并退出，而不是把一个死去的棋子放回格子——
   * 大厅里留下的孤儿模型正是自动画质降级后看到的幽灵。
   */
  private boardRevision = 0;
  /** 正在进行中的走子动画数。 */
  private movesInFlight = 0;
  /** 等待棋盘安静下来后再执行的重建（见 {@link setQuality}）。 */
  private rebuildPending = false;
  /** 玩家要求的军队皮肤，由 {@link syncArmies} 应用。 */
  private wantedSkins: Record<Faction, ArmySkinId> | null = null;
  /** 雕塑换装期间为 true，让请求排队而不是竞争。 */
  private swappingArmies = false;
  private promotionGroup: THREE.Group | null = null;
  private promotionViews: PieceView[] = [];
  private promotionSlots: PromotionSlot[] = [];
  /** 挂在候选棋子身后的暗色幕布，让棋盘不再争夺视线。 */
  private promotionScrim: THREE.Mesh | null = null;
  /** 指针正悬停在哪个候选棋子上（若有）。 */
  private promotionHover: PieceKind | null = null;
  private promotionResolve: ((kind: PieceKind) => void) | null = null;
  /** 选择器定位用的暂存向量，保证每帧零分配。 */
  private pickerScratch = new THREE.Vector3();

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private selected: SquareId | null = null;
  private hoveredPiece: PieceView | null = null;
  private pointerDownAt: { x: number; y: number; square: SquareId | null } | null = null;
  private legalTargets = new Map<SquareId, boolean>();
  private previewing = false;
  /**
   * 当前选择指向一个尚不存在的棋盘时为 true：
   * 机器的钟还在走，这次点按会排入预走队列而非直接走子。
   */
  private premoving = false;
  /** 排队的走子链，最旧的在前，保存以便重新点亮。 */
  private premoveChain: { from: SquareId; to: SquareId }[] = [];
  /** 指针正悬停在排队走子的撤销币上。 */
  private premoveCancelHovered = false;

  private lastFrameTime = 0;
  private elapsed = 0;
  private frameId = 0;
  private running = false;
  private disposed = false;
  private frameErrors = 0;
  /** 帧已为黑屏检查采样过的次数。 */
  private darkFrameChecks = 0;
  /** 引擎当前已降级到哪一级（见 `escalateFallback`）。 */
  private fallbackStage = 0;
  /** 这个驱动是什么，以及它能做什么。 */
  private gpu: GpuReport;
  /**
   * 安全渲染：不用合成器、不用反射探针、不用阴影贴图。在 Mesa 驱动上，
   * 这三样都曾被观察到把大厅渲染成全黑，所以这个开关是保证一定能出画面的兜底。
   */
  private safeMode = false;
  /** 玩家侧曝光倍率，用于观感偏暗的屏幕。 */
  private brightness = 1;
  /** 当前照亮场景的探针，保留引用以便释放。 */
  private environmentMap: THREE.Texture | null = null;
  /**
   * 探针在此驱动上测试通过前为 null；测试一旦失败则永远为 false ——
   * 没必要在每次切换竞技场时重建它。
   */
  private environmentUsable: boolean | null = null;
  /** 探针关闭时，用来顶替探针环境光贡献的光源。 */
  private ambientFallback: THREE.AmbientLight;

  private preset: QualityPreset;
  private arena: ArenaTheme = DEFAULT_ARENA;
  /** 跟随镜头移动，让每个棋子朝向玩家的一面始终清晰可读。 */
  private cameraLamp: THREE.DirectionalLight;
  private captureCinematics = true;
  /**
   * 热座模式：走完一手后是否把视角转到另一侧。除非玩家主动开启，
   * 否则默认关闭 —— 每步棋之间转半圈大厅是游戏里最重的镜头运动，
   * 而且一分钟要触发两次。
   */
  private rotateBoard = false;
  private rankBadges = true;
  private interactive = true;
  private attract = false;
  /** 电脑对电脑的演示模式：干脆利落的调色加上指定的镜头行为。 */
  private showcase = false;
  private showcaseCamera: ShowcaseCamera = "follow";
  private showcaseOrbitSpeed = 0.32;
  /** 上一次手动拖拽镜头的时间（自动环绕会让位于它）。 */
  private lastManualCameraAt = -999;
  /** 跟随镜头正在追踪的棋子（如果有的话）。 */
  private followPiece: PieceView | null = null;
  /** 没有棋子移动时，跟随镜头保持对准的固定点。 */
  private followPoint: THREE.Vector3 | null = null;
  /** 半径倍率：战斗会把镜头骨骼拉得比普通行军更近。 */
  private followTightness = 1;
  /** 实际取景所对准的缓动点，焦点跳变时不会生硬瞬移。 */
  private followedFocus = new THREE.Vector3(0, 0.45, 0);
  /** 跟随镜头保持的方位角、仰角和距离。 */
  private followRig = new THREE.Spherical(7.6, 0.92, Math.PI * 0.32);
  private followOffset = new THREE.Spherical();
  private scratchFocus = new THREE.Vector3();
  private scratchLean = new THREE.Vector3();
  private scratchDesired = new THREE.Vector3();
  private scratchCornerA = new THREE.Vector3();
  private scratchCornerB = new THREE.Vector3();
  /** 引擎自己正在移动镜头时为 true（永远不算用户输入）。 */
  private cameraDriven = false;
  /** 脚本化镜头运动（开场、推轨、预设）运行时为 true。 */
  private cameraScripted = false;
  private introPlaying = false;
  private introSkipped = false;
  private orbiting = false;
  private cameraFlipped = false;
  /** 平面俯视地图：雕塑换成计数标记，场景陈设被收起。 */
  private tactical = false;
  /** 收起地图后要回落到的 3D 取景。 */
  private tacticalReturn: CameraShot | null = null;
  /** 地图打开期间被藏起来的陈设，保留引用以便精确还原。 */
  private struck: THREE.Object3D[] = [];

  /** 正在绘制到的表面：它的形状决定整个取景。 */
  private view: ViewportProfile = AUTHORED_VIEW;
  /** 首次为实际视口求解出真实取景后为 true。 */
  private viewportFitted = false;
  /**
   * 当前取景所需要的镜头焦段。战斗节拍是从这个值*切入*的，
   * 而不是从某个常量切入 —— 这样手机上更宽的取景仍能保持冲击力，
   * 战斗中途的旋转也不会错误地还原成别的焦段。
   */
  private lensFov = DEFAULT_FOV;
  /** 当前取景最终确定的距离 —— 驱动环绕和跟随骨骼。 */
  private fitRadius = 10.5;
  /** 镜头上一次被送到的*预设*镜头位，每次调整尺寸都会重新求解。 */
  private framedShot: CameraShot = CAMERA_SHOTS.white;
  /** 此视口下的环绕与点按容差。 */
  private limits: OrbitLimits = orbitLimits(AUTHORED_VIEW, 10.5);

  private fpsSamples: number[] = [];
  private autoAdjusted = false;
  private lastFpsReport = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private controller: GameController,
    private callbacks: SceneCallbacks,
    preset: QualityPreset,
    arena: ArenaTheme = DEFAULT_ARENA,
  ) {
    this.preset = preset;
    this.arena = arena;
    const look = ARENA_LOOKS[arena];
    const settings = QUALITY_SETTINGS[preset];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.msaaSamples > 0,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.gpu = probeGpu(this.renderer);
    console.info(`[scene] 显卡信息：${describeGpu(this.gpu)}`);
    this.applyExposure(look.exposure);

    this.scene.background = new THREE.Color(look.background);
    // 比封闭大厅所用的雾更薄、更暖：透过雾气必须还能看清
    // 断墙之外的攻城营地和大军。
    this.scene.fog = new THREE.FogExp2(look.fog.color, look.fog.density);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 260);
    this.camera.position.copy(CAMERA_SHOTS.white.position);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    // 距离、仰角上限和旋转速度都来自视口 ——
    // 见 `applyOrbitLimits`，由下方的 resize 处理器调用。
    this.controls.enablePan = false;
    this.controls.target.copy(CAMERA_SHOTS.white.target);
    this.controls.autoRotateSpeed = 0.45;

    this.hall = new CastleHall(preset, look);
    this.scene.add(this.hall.group);
    this.battlefield = new Battlefield(preset, look);
    this.scene.add(this.battlefield.group);
    this.jungle = new JungleOverlay(preset, look);
    this.scene.add(this.jungle.group);
    this.scene.add(this.board.group);
    this.board.applyArena(look);
    this.scene.add(this.effects.group);
    this.scene.add(this.alarm.group);
    // 三个槽位：汇聚的火球、致命的光矢和审判光柱可以同时点亮。
    // 超出这个数量的就不点灯，而不是扩充灯组。
    // 不带后期处理的预设完全不用法术灯。
    this.spellLights = new SpellLightPool(this.scene, settings.postFx ? 3 : 0);

    // 一盏挂在镜头上的柔光灯：无论棋盘转向哪边，
    // 朝向玩家的脸和盾牌永远不会落在阴影里。
    this.cameraLamp = new THREE.DirectionalLight(look.lamp.color, look.lamp.intensity);
    this.cameraLamp.position.set(0, 1.5, 2.5);
    this.camera.add(this.cameraLamp);
    this.camera.add(this.cameraLamp.target);
    this.cameraLamp.target.position.set(0, 0, -1);
    this.scene.add(this.camera);

    // 天光替身：反射探针正常工作时它保持静默，
    // 一旦探针被丢弃就立刻调亮，保证没有任何东西陷入无光。
    this.ambientFallback = new THREE.AmbientLight(look.environment.top, 0);
    this.scene.add(this.ambientFallback);
    this.applyEnvironment();

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.postfx.setGrade(look.grade);
    this.postfx.setBloom(look.bloom);
    this.postfx.setPreset(preset);

    this.bindEvents();
    this.factory.onClip((keys, name, clip) => this.adoptClip(keys, name, clip));
    this.controller.setAnimator((event) => this.animateMove(event));
    this.controller.on("state", (snapshot) => this.onState(snapshot));
    this.controller.on("reset", () => this.rebuildPieces());
    this.controller.on("illegal", ({ from }) => this.rejectMove(from));
    this.controller.on("gameover", () => void this.playEndCinematic());
    this.controller.on("premove", (premoves) => this.onPremoveChanged(premoves));
    this.controller.on("premovefailed", ({ from, to, dropped, reason }) =>
      void this.flashPremoveLost(from, to, dropped, reason),
    );
    this.handleResize();
  }

  // ---------------------------------------------------------------- 生命周期

  async load(): Promise<void> {
    await this.factory.load((done, total) => this.callbacks.onLoadProgress(done / total));
    if (this.disposed) return;
    this.rebuildPieces();
    this.callbacks.onReady();
    // 弹药库，在游戏背后悄悄加载：军队枪管里每种弹药各一个雕塑，
    // 每个几千个三角形，在有人扣动扳机之前一个也用不上。
    // 在雕塑加载到位之前，弹药改由程序化方式生成
    // （`scene/ammunition.ts`），所以一局游戏的第一枪永远不会是哑弹。
    for (const source of SHOT_MODELS) void primeShotModel(source);
    // 骨骼和站姿动画已经就位；攻击、死亡和步行动画在游戏背后下载，
    // 这样第一步棋永远不用等七十个 GLB 文件。
    void this.factory.warmClips();
  }

  /**
   * 棋盘摆好之后某个动画剪辑才下载完成：把它分发给棋盘上、
   * 托盘中以及正在移动的所有该阵容棋子，让开局阶段创建的棋子
   * 不会在这局游戏里缺少攻击动画。
   */
  private adoptClip(keys: TemplateKey[], name: ClipName, clip: THREE.AnimationClip): void {
    const wanted = new Set<TemplateKey>(keys);
    const install = (piece: PieceView): void => {
      if (wanted.has(`${piece.color}${piece.kind}`)) piece.installClip(name, clip);
    };
    for (const piece of this.pieces.values()) install(piece);
    for (const piece of this.motion) install(piece);
    for (const piece of this.captured) install(piece);
    for (const piece of this.promotionViews) install(piece);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    const loop = (): void => {
      if (!this.running) return;
      this.frameId = requestAnimationFrame(loop);
      try {
        this.frame();
      } catch (error) {
        this.frameErrors += 1;
        if (this.frameErrors <= 3) console.error("[scene] 帧渲染失败", error);
        // 一个行为异常的特效绝不允许把整个大厅一起拖垮。
        if (this.frameErrors === 3) this.postfx.forceDirect("repeated frame errors");
      }
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private frame(): void {
    const now = performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.elapsed += delta;

    this.tweens.update(delta);
    this.hall.update(delta);
    this.battlefield.update(delta, this.camera);
    this.jungle.update(delta, this.camera);
    this.board.update(delta);
    this.effects.update(delta);
    this.alarm.update(delta);
    this.shake.update(delta);

    for (const piece of this.pieces.values()) piece.update(delta, this.elapsed);
    for (const piece of this.motion) piece.update(delta, this.elapsed);
    for (const piece of this.captured) piece.update(delta, this.elapsed);
    for (const piece of this.promotionViews) piece.update(delta, this.elapsed);

    if (this.promotionGroup) this.layoutPromotionPicker(delta);

    if (this.tactical) this.alignTokens();

    // 吸引循环的自动环绕，以及演示模式下仅在观众明确选择环绕时才启用。
    // 绝不要和鼠标上的手较劲：一次拖拽会让它暂停几秒。
    const orbitIdle = this.elapsed - this.lastManualCameraAt > 3.2;
    const showcaseOrbit = this.showcase && this.showcaseCamera === "orbit" && orbitIdle;
    this.controls.autoRotate = !this.tactical && (this.attract || showcaseOrbit);
    this.controls.autoRotateSpeed = this.attract ? 0.45 : this.showcaseOrbitSpeed;

    // 跟随镜头会自己写入镜头参数，所以下方控制器触发的 `change`
    // 事件绝不能被误认为观众在抓取视角。
    this.cameraDriven = this.updateFollowCamera(delta);
    this.controls.update();
    this.cameraDriven = false;
    this.confineCamera();

    this.camera.position.add(this.shake.offset);
    this.postfx.render(delta);
    this.camera.position.sub(this.shake.offset);

    this.guardAgainstBlackFrames();
    this.sampleFps(delta);
  }

  /**
   * 黑屏看门狗。
   *
   * 有几种驱动栈 —— 首当其冲的是 Mesa 的软件光栅化器（没有可用硬件加速的
   * Linux 机器会回落到它）—— 会把大厅渲染成全黑，而上面的界面却完全正常。
   * 病因从不重样：有时是合成器返回空缓冲，有时是反射探针采样出 NaN
   * 并毒害所有受光表面，有时是阴影贴图出问题。
   *
   * 所以与其瞎猜，不如在最初几秒里对帧画面本身采样五次，
   * 每次采样失败就按损失从小到大再丢弃一层。
   */
  private guardAgainstBlackFrames(): void {
    if (this.darkFrameChecks >= DARK_FRAME_CHECKS.length) return;
    if (this.elapsed < DARK_FRAME_CHECKS[this.darkFrameChecks]) return;
    if (typeof document !== "undefined" && document.hidden) return;
    this.darkFrameChecks += 1;
    if (!this.isFrameBlack()) {
      // 屏幕上已经有画面了 —— 永久解除看门狗。
      this.darkFrameChecks = DARK_FRAME_CHECKS.length;
      return;
    }
    this.escalateFallback();
  }

  /**
   * 读取散布在帧画面上的五个小块（中心加四个象限）。
   * 必须每一块都读回全黑才会丢弃任何一层，所以昏暗的角落
   * 或夜间竞技场永远不会误触发它。
   */
  private isFrameBlack(): boolean {
    const gl = this.renderer.getContext();
    const { width, height } = this.renderer.domElement;
    const span = 6;
    if (width < span * 4 || height < span * 4) return false;
    const spots: [number, number][] = [
      [0.5, 0.5],
      [0.28, 0.32],
      [0.72, 0.32],
      [0.28, 0.7],
      [0.72, 0.7],
    ];
    const pixels = new Uint8Array(span * span * 4);
    for (const [u, v] of spots) {
      try {
        gl.readPixels(
          Math.floor(width * u - span / 2),
          Math.floor(height * v - span / 2),
          span,
          span,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
      } catch {
        return false;
      }
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 10 || pixels[i + 1] > 10 || pixels[i + 2] > 10) return false;
      }
    }
    return true;
  }

  /** 丢弃管线中的下一层，并告知界面降级原因。 */
  private escalateFallback(): void {
    this.fallbackStage += 1;
    switch (this.fallbackStage) {
      case 1:
        if (this.postfx.isBypassed) {
          this.escalateFallback();
          return;
        }
        this.postfx.setBypassed(true);
        this.report("此驱动下后处理输出了空画面 —— 已关闭电影特效。", false);
        return;
      case 2:
        if (this.environmentUsable === false) {
          this.escalateFallback();
          return;
        }
        this.environmentUsable = false;
        this.applyEnvironment();
        this.report("此驱动无法采样反射探针 —— 已切换为普通天光。", false);
        return;
      default:
        if (this.safeMode) {
          console.warn("[scene] 所有降级方案用尽后画面仍然全黑", describeGpu(this.gpu));
          this.darkFrameChecks = DARK_FRAME_CHECKS.length;
          return;
        }
        this.setSafeMode(true);
        this.report("已切换到安全渲染模式 —— 你的显卡驱动无法绘制完整场景。", true);
        return;
    }
  }

  private report(message: string, safe: boolean): void {
    console.warn(`[scene] ${message} (${describeGpu(this.gpu)})`);
    this.callbacks.onRenderFallback?.(message, safe);
  }

  // -------------------------------------------------------------- 渲染健康

  /** 色调映射曝光度，在主题基础上叠加玩家亮度。 */
  private applyExposure(base = this.baseExposure()): void {
    this.renderer.toneMappingExposure = base * this.brightness * (this.safeMode ? 1.2 : 1);
  }

  private baseExposure(): number {
    const look = ARENA_LOOKS[this.arena];
    return this.tactical ? look.exposure * 1.12 : look.exposure;
  }

  /**
   * 为当前场景（重）建反射探针，在本驱动上自检一次；若不可信则退回普通
   * 环境天光。NaN 探针会让大厅里所有受光表面全黑，因此这是全黑场景最可能
   * 的唯一原因。
   */
  private applyEnvironment(): void {
    const look = ARENA_LOOKS[this.arena];
    const previous = this.environmentMap;
    this.environmentMap = null;
    this.scene.environment = null;
    previous?.dispose();

    const allowed = !this.safeMode && this.environmentUsable !== false && this.gpu.halfFloatBuffer;
    if (allowed) {
      try {
        const map = buildEnvironmentMap(this.renderer, look);
        if (this.environmentUsable === null) {
          this.environmentUsable = reflectionProbeWorks(this.renderer, map);
          if (!this.environmentUsable) console.warn("[scene] 反射探针渲染为黑色 —— 改用环境天光");
        }
        if (this.environmentUsable) {
          this.environmentMap = map;
          this.scene.environment = map;
          this.scene.environmentIntensity = look.environment.intensity;
        } else {
          map.dispose();
        }
      } catch (error) {
        this.environmentUsable = false;
        console.warn("[scene] 无法构建反射探针", error);
      }
    }

    // 没有探针时环境光项必须有别的来源，否则盔甲和大理石会呈现为纯剪影。
    const lit = this.environmentMap !== null;
    this.ambientFallback.color.setHex(look.environment.top).lerp(new THREE.Color(look.environment.warm), 0.4);
    this.ambientFallback.intensity = lit ? 0 : look.environment.intensity * 1.15;
    this.refreshMaterials();
  }

  /**
   * 强制场景中的每个材质重建着色器。每当运行时开关阴影贴图时都需要这样做，
   * 否则会留下过期的着色器程序。
   */
  private refreshMaterials(): void {
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      if (Array.isArray(material)) material.forEach((entry) => (entry.needsUpdate = true));
      else material.needsUpdate = true;
    });
  }

  private sampleFps(delta: number): void {
    if (delta <= 0) return;
    this.fpsSamples.push(1 / delta);
    if (this.fpsSamples.length > 120) this.fpsSamples.shift();
    if (this.elapsed - this.lastFpsReport < 1) return;
    this.lastFpsReport = this.elapsed;
    const average = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
    this.callbacks.onFps(Math.round(average));

    // 如果检测到的画质预设明显过重，自动降一档。
    if (this.autoAdjusted || this.elapsed < 8 || this.fpsSamples.length < 100) return;
    if (average >= 40) return;
    const order: QualityPreset[] = ["low", "medium", "high", "ultra"];
    const index = order.indexOf(this.preset);
    if (index <= 0) {
      this.autoAdjusted = true;
      return;
    }
    this.autoAdjusted = true;
    const next = order[index - 1];
    this.setQuality(next);
    this.callbacks.onQualityAdjusted(next);
  }

  // ------------------------------------------------------------------- 棋子

  private rebuildPieces(): void {
    // 仍在播放的动画节拍属于旧棋盘：先使其失效，避免它在 await 完成后
    // 把携带的棋子重新注册回来。
    this.boardRevision += 1;
    this.rebuildPending = false;
    for (const piece of this.pieces.values()) piece.dispose();
    // 行进中、攻击中或死亡中的棋子不在 `pieces` 里 —— 不处理的话，它们会作为
    // 重建后放回格子的棋子的冻结分身，永远留在场景中。
    for (const piece of this.motion) piece.dispose();
    for (const piece of this.captured) piece.dispose();
    this.pieces.clear();
    this.motion.clear();
    this.hoveredPiece = null;
    this.followPiece = null;
    this.captured = [];
    this.selected = null;
    this.legalTargets.clear();
    this.board.clearHighlights();
    if (!this.factory.isReady) return;

    const settings = QUALITY_SETTINGS[this.preset];
    for (const entry of this.controller.getBoard()) {
      const view = this.factory.create(entry.kind, entry.color, {
        contactShadows: settings.contactShadows,
        idleAnimation: settings.idleAnimations,
        rankBadge: this.rankBadges,
      });
      if (this.tactical) view.setFlat(true);
      view.container.position.copy(squareToWorld(entry.square));
      this.scene.add(view.container);
      this.pieces.set(entry.square, view);
    }
  }

  private trayPosition(color: Faction, index: number): THREE.Vector3 {
    const column = Math.floor(index / 8);
    const row = index % 8;
    const side = color === "b" ? 1 : -1;
    const x = side * (TILE * 4 + 0.95 + column * 0.62);
    const z = -TILE * 3.2 + row * 0.92;
    return new THREE.Vector3(x, 0, z);
  }

  private async sendToTray(piece: PieceView): Promise<void> {
    this.motion.delete(piece);
    const index = this.captured.filter((entry) => entry.color === piece.color).length;
    this.captured.push(piece);
    // 倒下的棋子到达托盘后会重新站起来。
    piece.resetPose();
    const destination = this.trayPosition(piece.color, index);
    piece.container.scale.setScalar(0.55);
    piece.container.position.copy(destination);
    piece.setOpacity(0);
    await this.tweens.to({
      duration: 0.5,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setOpacity(t * 0.95),
    });
  }

  // ---------------------------------------------------------------- 动画

  private async animateMove(event: MoveEvent): Promise<void> {
    this.movesInFlight += 1;
    try {
      await this.runMove(event);
    } finally {
      this.movesInFlight -= 1;
      // 战斗中途到达的画质变更被暂缓了；现在执行。
      if (this.movesInFlight === 0 && this.rebuildPending) this.rebuildPieces();
    }
  }

  /**
   * 当棋盘在某个正在播放的节拍期间被重建时为 true，意味着该节拍持有的
   * 每个视图都已被销毁。
   */
  private isStale(revision: number): boolean {
    return revision !== this.boardRevision || this.disposed;
  }

  private async runMove(event: MoveEvent): Promise<void> {
    const piece = this.pieces.get(event.from);
    if (!piece) return;
    const revision = this.boardRevision;

    this.clearSelection();
    this.board.clearHighlights();
    this.pieces.delete(event.from);
    this.motion.add(piece);

    const victim = event.capture ? this.pieces.get(event.capture.square) : null;
    if (event.capture) this.pieces.delete(event.capture.square);
    if (victim) this.motion.add(victim);

    const from = squareToWorld(event.from);
    const to = squareToWorld(event.to);

    // 展示跟随镜头：跟随正在移动的棋子，当它走入战斗时稍稍坐近一些。
    this.focusPiece(piece, victim ? 0.86 : 0.98);

    if (victim) {
      const strikeSquare = event.capture ? event.capture.square : event.to;
      // 战斗节拍是一场镜头表演 —— 在棋盘地图上没有实际意义。
      if (this.captureCinematics && !this.tactical) {
        // 攻击与倒下就是整个节拍：确保开打前两个棋子确实持有这些剪辑。
        await this.armCombat(piece, victim);
        try {
          // 施法者原地烧死目标，枪手原地开枪射击；其他人都必须走进这一击。
          const style = attackStyle(piece.kind, piece.arsenal);
          if (style === "spell")
            await this.playSpellCinematic(piece, victim, from, to, strikeSquare);
          else if (style === "gun")
            await this.playGunCinematic(piece, victim, from, to, strikeSquare);
          else await this.playCaptureCinematic(piece, victim, from, to, strikeSquare);
        } catch (error) {
          // 损坏的特效绝不能让棋子卡在战斗中途：用朴素方式完成击杀，
          // 保证棋盘状态一致。
          console.warn("[scene] 战斗节拍失败", error);
          this.camera.fov = this.lensFov;
          this.camera.updateProjectionMatrix();
          piece.setStrikeTilt(0);
          if (!victim.isSlain) await this.crumble(victim, from);
        }
      } else {
        const approach = squareToWorld(event.from);
        await this.glide(piece, from, to, event.kind === "n");
        this.strikeImpact(strikeSquare, 0.8);
        await this.crumble(victim, approach);
      }
      if (this.isStale(revision)) return;
      void this.sendToTray(victim);
    } else {
      await this.glide(piece, from, to, event.kind === "n");
      audio.play("place", 0.55);
    }

    if (this.isStale(revision)) return;
    piece.container.position.copy(to);
    this.motion.delete(piece);
    this.pieces.set(event.to, piece);
    // 这步棋走完了：镜头在刚被占据的格子上稍作停留。
    this.focusPoint(to, 1);
    // 占据格子：尘环、地砖下沉、棋子把重量落定。
    // 刚杀完子就轻一点——那一击已经震过石板了。
    this.landOn(piece, event.to, victim ? 0.7 : event.kind === "n" ? 1.25 : 1);
    // ……如果这格原本是别人的，现在它就易主了。
    if (victim) this.claimSquare(piece, event.to, victim.kind);
    // 到位：重新面向敌方一侧，而不是保持行军朝向。
    // 即将升变的棋子马上要被替换，所以不去动它。
    if (!event.promotion) void piece.turnHome(this.tweens, 0.3);

    if (event.rook) {
      const rook = this.pieces.get(event.rook.from);
      if (rook) {
        this.pieces.delete(event.rook.from);
        this.motion.add(rook);
        // 战车在国王占过它的格子之后还要自己走一段，
        // 所以王车易位读起来是两步棋，而不是一次同步平移。
        await this.glide(rook, squareToWorld(event.rook.from), squareToWorld(event.rook.to), false);
        if (this.isStale(revision)) return;
        this.motion.delete(rook);
        this.pieces.set(event.rook.to, rook);
        audio.play("place", 0.4);
        this.landOn(rook, event.rook.to, 0.85);
        void rook.turnHome(this.tweens, 0.3);
      }
    }

    if (event.promotion) {
      piece.dispose();
      this.pieces.delete(event.to);
      const view = this.factory.create(event.promotion, event.color, {
        contactShadows: QUALITY_SETTINGS[this.preset].contactShadows,
        idleAnimation: QUALITY_SETTINGS[this.preset].idleAnimations,
        rankBadge: this.rankBadges,
      });
      if (this.tactical) view.setFlat(true);
      view.container.position.copy(to);
      view.container.scale.setScalar(0.01);
      this.scene.add(view.container);
      this.pieces.set(event.to, view);
      this.effects.spawnBurst(to.clone().setY(0.4), FACTION_ACCENT[event.color], 40, { speed: 2.6, life: 0.8 });
      this.effects.spawnFlash(to.clone().setY(0.6), 2.4, 0.4);
      await this.tweens.to({
        duration: 0.6,
        easing: Ease.outBack,
        onUpdate: (t) => view.container.scale.setScalar(Math.max(0.01, t)),
      });
      if (this.isStale(revision)) return;
      view.container.scale.setScalar(1);
      this.landOn(view, event.to, 1.3);
    }

    this.board.setHighlight(event.from, "last");
    this.board.setHighlight(event.to, "last");
    // 在这一拍里排队的预排着法已被上面的清空抹掉；它还在
    // 等待，所以把它重新放回石板上。
    this.applyPremoveHighlight();

    if (event.isCheck) {
      audio.play("check", 0.55);
      // 警报灯早在状态发布时就已点亮，但"宣告"是这一拍——
      // 着法真正落到棋盘上的这一刻——所以光涌和轰鸣
      // 从这里触发，而不是从 `onState`。
      // 是轰鸣而不是猛震：没有任何东西撞到镜头，是大厅
      // 在反应。刻意保持轻微而短促——足以在注意力边缘
      // 被感觉到，又不足以在玩家眼前撼动棋盘。
      this.alarm.strike();
      this.shake.tremor(0.16, 0.6);
    }

    if (
      this.rotateBoard &&
      !this.tactical &&
      this.controller.getSnapshot().mode === "hotseat" &&
      !event.isGameOver
    ) {
      await this.swingCamera();
    }
  }

  /**
   * 两名战士被交予他们这一拍所依赖的剪辑。这些剪辑
   * 在启动时就在后台加载，但开局高峰期间丢掉的请求
   * 否则会留下一个从不出手就击杀的棋子——所以一次
   * 吃子会在这里再要一次，并用一个上限挡住糟糕网络，
   * 不让它卡住整盘棋。
   */
  private async armCombat(attacker: PieceView, victim: PieceView): Promise<void> {
    const ready = attacker.hasClip("attack") && (victim.hasClip("death") || !victim.hasAnimations);
    if (ready) return;
    await Promise.race([
      Promise.all([
        this.factory.ensureClip(attacker.color, attacker.kind, "attack"),
        this.factory.ensureClip(victim.color, victim.kind, "death"),
      ]),
      wait(2.4),
    ]);
  }

  /**
   * 把一个棋子即将用到的步态交给它。步态在后台预热，
   * 所以没有这一步的话，一局的第一步会在走路剪辑落地
   * 之前就走完，棋子以站姿滑过棋盘——读作一个等级
   * 完全失去了动画。设了上限，所以慢网只会让这一步
   * 慢零点几秒，而不是把棋盘卡住。
   *
   * @returns 剪辑现在是否已绑定到这个棋子
   */
  private async armStride(piece: PieceView, name: MarchClip): Promise<boolean> {
    if (piece.hasClip(name)) return true;
    await Promise.race([this.factory.ensureClip(piece.color, piece.kind, name), wait(0.6)]);
    return piece.hasClip(name);
  }

  /**
   * 把一个棋子在两个格子之间移动。带骨骼的雕塑转向
   * 面对目的地，用自己的双腿跨过这段距离，每一步都
   * 真实地踩下：走路剪辑按它那一级的步频重新计时，
   * 所以骨骼与那个触发脚步声与砂尘粒子的步伐时钟
   * 是同一个时钟——没有任何打滑。
   *
   * 骑士保留它的跳跃，从空中跑过去而不是走路。没有
   * 骨骼的雕塑（以及关闭骨骼动画的低画质预设）保留
   * 旧的平滑滑行，但仍可听见脚步，让棋盘不至于沉默。
   *
   * @param hurry 步频倍率——大于 1 时棋子向前逼近，
   *   正是冲入对峙所需。
   */
  private async glide(piece: PieceView, from: THREE.Vector3, to: THREE.Vector3, arc: boolean, hurry = 1) {
    const settings = QUALITY_SETTINGS[this.preset];
    const distance = from.distanceTo(to);
    const gait = GAITS[piece.kind];
    // 走路不是画质预设可以夺走的奢侈品：一段行军只是
    // 一两秒内的一个混合器，开销和每个预设都已经在播的
    // 攻击与死亡剪辑相同。只有平面战术地图（屏幕上
    // 根本没有雕塑）和完全没有骨骼的雕塑才退回滑行。
    const wantsLegs = !this.tactical && piece.hasAnimations;
    // 步态必须在移动*编排之前*就到手，而不是某个时间点
    // 下载完就算了：开局第一步在棋盘站起来几秒后就走出，
    // 而那正是步态剪辑还在空中的时刻。
    const clip: MarchClip =
      wantsLegs && arc && (await this.armStride(piece, "run")) ? "run" : "walk";
    const onFoot = wantsLegs && (clip === "run" || (await this.armStride(piece, "walk")));

    // 更远的移动走更多步，而不是滑得更快。
    const tiles = Math.max(0.6, distance / TILE);
    const steps = Math.max(2, Math.round(tiles * gait.stepsPerTile * (arc ? 0.8 : 1)));
    const cadence = gait.cadence * hurry * (arc ? 1.5 : 1);
    const time = onFoot
      ? THREE.MathUtils.clamp(steps / cadence, 0.34, 2.4)
      : Math.min(0.72, 0.24 + distance * 0.055) / hurry;
    // 钳位之后真实达到的步频——双腿必须匹配它。
    const stepRate = steps / time;
    const height = arc ? 0.85 + distance * 0.08 : 0.06;
    const trails = settings.captureParticles >= 34 && distance > TILE * 0.6;
    let nextTrail = 0.18;
    // 一个步伐的零头，让第一只靴子刚好在蹬地起步之后
    // 落下，而不是在棋子开始移动的那一帧。
    let nextStep = 0.34;

    if (arc) {
      // 蹬地起步：砂尘从骑手离开的格子向后扬起。
      piece.flareAura(0.4);
      this.effects.spawnBurst(from.clone().setY(BOARD_TOP + 0.06), 0xc7ac82, trails ? 10 : 5, {
        speed: 1.4,
        life: 0.4,
      });
    } else if (onFoot) {
      // 没有人倒着走：出发之前先朝目的地摆正。
      await piece.turnTowards(to, this.tweens, Math.min(0.22, 0.5 / cadence));
    }

    const marching = onFoot && piece.startMarch(clip, stepRate);
    // 地面行军在移动中段保持匀速；滑行与跳跃保留
    // 它们的缓动曲线。
    const easing: Easing = arc
      ? Ease.inOutCubic
      : marching
        ? strideEasing(Math.min(0.3, 1.1 / steps))
        : Ease.inOutQuart;

    await this.tweens.to({
      duration: time,
      easing,
      onUpdate: (t) => {
        piece.container.position.lerpVectors(from, to, t);
        piece.container.position.y = from.y + Math.sin(Math.PI * t) * height;
        // 脚步声：靴子本身，加上它从石面上掀起的砂尘。
        // 骑手在空中，所以它的奔跑直到落地才有接触。
        if (!arc && steps > 0) {
          const taken = t * steps;
          while (taken >= nextStep && nextStep <= steps) {
            this.footfall(piece, gait, Math.round(nextStep), trails);
            nextStep += 1;
          }
        }
        // 一缕稀薄的尘土跟随滑行的棋子或跳跃的骑手。
        if (trails && !marching && t >= nextTrail && t < 0.88) {
          nextTrail += arc ? 0.2 : 0.24;
          this.effects.spawnSmoke(piece.container.position.clone().setY(BOARD_TOP + 0.07), {
            count: 2,
            radius: 0.22,
            scale: arc ? 0.4 : 0.3,
            growth: 2.1,
            life: 0.55,
            speed: 0.3,
            rise: 0.1,
            color: 0x9d9078,
            opacity: arc ? 0.24 : 0.16,
          });
        }
      },
    });
    piece.container.position.copy(to);
    if (marching) piece.stopMarch(0.2);
    if (arc) this.shake.add(0.05);
  }

  /**
   * 行军途中一只靴子落下：脚步本身按棋子在屏幕上的
   * 位置做声像，加音高抖动让一段长行军永远不会变成
   * 节拍器，再在脚落下处扬起一小团砂尘。
   */
  private footfall(piece: PieceView, gait: Gait, index: number, dust: boolean): void {
    const at = piece.container.position;
    audio.footstep({
      pan: this.stereoPan(at),
      timbre: gait.timbre,
      // 交替的双脚从不完全相等，两步之间也一样。
      volume: gait.volume * (index % 2 === 0 ? 1 : 0.93),
      jitter: (Math.random() - 0.5) * 0.16,
    });
    if (!dust) return;
    this.effects.spawnSmoke(at.clone().setY(BOARD_TOP + 0.05), {
      count: 2,
      radius: 0.16,
      scale: 0.24 + gait.volume * 0.12,
      growth: 2.2,
      life: 0.5,
      speed: 0.26,
      rise: 0.08,
      color: 0xa2947c,
      opacity: 0.15,
    });
  }

  /**
   * 在目标格子上的抵达节拍：一圈尘土从棋子脚下滚出，
   * 格子下沉，阵营光环闪烁，躯体以一段会弹回的短暂
   * 压缩承受重量。`weight` 缩放整段——骑士从弧线上
   * 落下比主教滑过棋盘更重，而胜者踏上尸体会更轻。
   */
  private landOn(piece: PieceView, square: SquareId, weight = 1): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const heavy = piece.kind === "k" || piece.kind === "q" || piece.kind === "r";
    const strength = Math.min(1.6, weight * (heavy ? 1.18 : 0.92));
    const centre = squareToWorld(square, BOARD_TOP + 0.05);

    this.board.land(square, FACTION_ACCENT[piece.color], strength);
    this.woodKnock(piece, centre, strength);
    this.landingSteps(piece, centre, strength);
    piece.flareAura(Math.min(1, 0.8 * strength));
    if (strength > 0.9) this.shake.add(0.035 * strength);

    const grit = Math.max(5, Math.round(settings.captureParticles * 0.2 * strength));
    this.effects.spawnBurst(centre, 0xd9bd8e, grit, { speed: 1.15 * strength, life: 0.45 });
    if (settings.captureParticles >= 34) {
      this.effects.spawnSmoke(centre.clone().setY(BOARD_TOP + 0.08), {
        count: Math.max(2, Math.round(grit * 0.25)),
        radius: 0.42,
        scale: 0.42,
        growth: 2.5,
        life: 0.75,
        speed: 0.6 * strength,
        rise: 0.1,
        color: 0xa2947c,
        opacity: 0.26,
      });
    }

    void this.settle(piece, strength);
  }

  /**
   * 棋子碰上棋盘时那声柔和的木"嗒"，按它落下的
   * 格子做声像。越重的等级敲得越低、越长；轻轻
   * 落下（胜者踏上被清空的格子）几乎听不出。
   */
  private woodKnock(piece: PieceView, at: THREE.Vector3, strength: number): void {
    audio.woodTap({
      pan: this.stereoPan(at),
      weight: WOOD_WEIGHT[piece.kind],
      volume: Math.min(1.05, 0.5 + strength * 0.42),
    });
  }

  /**
   * 靴子踏上格子。每个棋子抵达时都落下一只脚；
   * 骑手从跳跃中落下时双脚先后落地，相差一拍——
   * 这正是让落地读作重量而不是一次触地的东西。
   */
  private landingSteps(piece: PieceView, at: THREE.Vector3, strength: number): void {
    const gait = GAITS[piece.kind];
    const pan = this.stereoPan(at);
    const volume = gait.volume * Math.min(1.4, 0.85 + strength * 0.45);
    audio.footstep({ pan, timbre: gait.timbre, volume });
    if (piece.kind !== "n") return;
    audio.footstep({ pan, timbre: gait.timbre, volume: volume * 1.15, delay: 0.07, jitter: -0.09 });
  }

  /**
   * 格子易主。
   *
   * 这块棋盘上每一次击杀都已经有*暴力*的标点——那一击、那声
   * 惨叫、被抛飞的躯体——但真正赢下一盘棋的事却悄无声息：
   * 一枚棋子踏上了原本属于别人的格子，而棋盘发出的声音
   * 和一步安静的走子毫无区别。这里就是把那一刻配上自己的
   * 节拍，而且刻意做得克制：战斗才是重头戏，这只是它后面
   * 的那个句号。
   *
   * 三件事，全部 keyed 到被吃的是什么、而不是谁吃的
   * （见 {@link CONQUEST_WEIGHT}），这样兑掉一个兵绝不会
   * 听起来像放倒了一位王后：
   *
   * - 占据信号——一只踏上石板的靴子，衬着一段上行的铜管动机；
   * - 胜方的颜色在刚清空的地砖上向内收拢；
   * - 棋子本身在新格子上挺起全部高度。
   */
  private claimSquare(victor: PieceView, square: SquareId, taken: PieceKind): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const weight = CONQUEST_WEIGHT[taken];
    const accent = FACTION_ACCENT[victor.color];
    const centre = squareToWorld(square, BOARD_TOP + 0.032);

    audio.conquest({
      pan: this.stereoPan(centre),
      weight,
      volume: 0.78 + weight * 0.3,
    });

    void spawnConquestClaim(this.scene, this.tweens, centre, {
      color: accent,
      radius: TILE * (2.1 + weight * 0.7),
      height: BOARD_TOP + 0.028,
      weight,
    });

    // 印记合拢时把旧主地砖的碎屑抛起——刻意延时触发，
    // 让它们随着光环闭合落下，而不是跟着脚步声一起。
    const chips = Math.max(4, Math.round(settings.captureParticles * (0.16 + weight * 0.16)));
    void (async () => {
      await wait(0.26);
      if (this.disposed) return;
      this.effects.spawnBurst(centre.clone().setY(BOARD_TOP + 0.1), accent, chips, {
        speed: 0.9 + weight * 0.7,
        life: 0.6,
        gravity: 2.6,
        radius: 0.34,
        size: 0.1,
        growth: 0.6,
        rise: 0.5,
        drag: 1.2,
      });
      this.effects.spawnFlash(centre.clone().setY(BOARD_TOP + 0.18), 1.1 + weight * 0.9, 0.26);
    })();

    // 棋子脚下的队伍光环回应自己颜色的到来。
    victor.flareAura(Math.min(1.5, 1 + weight * 0.5));
    void this.drawUp(victor, weight);
  }

  /**
   * 胜者在自己刚刚夺下的格子上挺直身躯：挥击之后
   * 肩膀收回一拍再弹回水平。由运行时节点驱动而不是
   * 剪辑，所以每个棋子都能得到它——无论是否带骨骼，
   * 也无论刚刚结束的是三种战斗节拍中的哪一种。
   *
   * 刻意做成*倾身*而不是摆姿势：它必须在对手反击前的
   * 那段停顿内完成，否则棋盘会读作在等一段胜利之舞。
   */
  private async drawUp(piece: PieceView, weight: number): Promise<void> {
    const lean = 0.045 + weight * 0.055;
    await this.tweens.to({
      duration: 0.13,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setStrikeTilt(-lean * t),
    });
    await this.tweens.to({
      duration: 0.5,
      easing: Ease.outElastic,
      onUpdate: (t) => piece.setStrikeTilt(-lean * (1 - t)),
    });
    piece.setStrikeTilt(0);
  }

  /** 膝盖承重：一次快速下压，再弹回来。 */
  private async settle(piece: PieceView, strength: number): Promise<void> {
    const depth = Math.min(1, 0.5 + strength * 0.45);
    await this.tweens.to({
      duration: 0.09,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setSquash(depth * t),
    });
    await this.tweens.to({
      duration: 0.62,
      easing: Ease.outElastic,
      onUpdate: (t) => piece.setSquash(depth * (1 - t)),
    });
    piece.setSquash(0);
  }

  /**
   * 近身战斗节拍：冲锋、对峙、挥击、崩解。打击的力度
   * 按进攻棋子的等级从 {@link STRIKES} 读出，所以同一套
   * 编排既承载步卒的一刺，也承载王室处决，谁也不借
   * 谁的分量。
   */
  private async playCaptureCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
  ): Promise<void> {
    const profile = STRIKES[attacker.kind];
    const settings = QUALITY_SETTINGS[this.preset];
    const direction = to.clone().sub(from).normalize();
    const standoff = to.clone().sub(direction.clone().multiplyScalar(TILE * 0.52));
    // 战斗就是镜头：框住两个躯体，把镜组拉近。
    this.focusPoint(standoff.clone().lerp(to, 0.5), 0.68);
    // 吃过路兵杀掉的兵不在所走到的格子上。
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(standoff).setY(0);
    if (blow.lengthSq() < 1e-6) blow.copy(direction);
    blow.normalize();

    const punch = this.lensPunch(profile.zoom);
    void this.tweens.to({
      duration: 0.22,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * t;
        this.camera.updateProjectionMatrix();
      },
    });

    // 双方都摆正架势：进攻方冲进来，防守方转身
    // 迎向它的杀手，那一击才不会落在后脑勺上。
    await Promise.all([
      // 迎着这一击压上去：同样的行军，更快的步频。
      this.glide(attacker, from, standoff, attacker.kind === "n", profile.charge),
      victim.turnTowards(standoff, this.tweens, 0.3),
    ]);
    attacker.faceTowards(victimSpot);
    // 抵达节拍：行军已停，棋子正向它的目标站定。
    // 在这里屏息才让那一击读作一个独立动作，
    // 而不是走路的尾声。等级越重，出手前站得越久。
    await wait(profile.wind);

    // 处决前的宣判：王冠把一道光柱落在死囚身上，
    // 大厅被告知即将发生什么。
    if (profile.pillar) await this.passSentence(victim, victimSpot, profile.pillar, settings.postFx);

    // 挥击：骨骼携带攻击剪辑时播放它，否则用运行时
    // 节点驱动一个蓄力加突刺，让棋盘锚点不动。注意
    // 这里要求的是剪辑本身，不只是骨骼——攻击剪辑
    // 没下载下来的棋子仍必须能看见它在攻击。
    const strike = attacker.hasClip("attack") ? attacker.playAttack() : null;
    if (profile.swing > 0) {
      // 武器破空声在它抵达前一刻先被听见。
      const lead = strike && strike.duration > 0 ? Math.max(0, strike.impact - 0.18) : 0.05;
      audio.bladeWhoosh({
        pan: this.stereoPan(standoff),
        volume: profile.swing,
        weight: profile.heft,
        delay: lead,
      });
    }
    if (strike && strike.duration > 0) await wait(strike.impact);
    else await this.lunge(attacker, direction, profile.heft);

    const impact = victimSpot.clone().setY(0.55);
    const power = profile.power;
    audio.play("capture", Math.min(1, 0.85 * power));
    // 棋盘本身有上限：超过某个点，地砖就不再读作石头。
    this.strikeImpact(strikeSquare, Math.min(1.5, power));
    this.effects.spawnFlash(impact, Math.min(4.4, 2.2 * power), 0.24);
    this.effects.spawnBurst(impact, 0xffc978, Math.round(settings.captureParticles * power), {
      speed: 3.4 * (0.9 + power * 0.1),
      life: 0.75,
    });
    this.shake.add(Math.min(1, 0.55 * power));

    // 钢铁：刃过之后，那道切口还在空气里挂两三帧。
    if (profile.slash) {
      void spawnSlash(this.scene, this.tweens, impact, {
        color: profile.slash.color,
        size: profile.slash.size,
        tilt: -0.55 - Math.random() * 0.35,
      });
    }

    // 分量：砸进地板的一击会在石板上荡开一道波。
    if (profile.wave) {
      audio.groundSlam({ pan: this.stereoPan(victimSpot), volume: Math.min(1, power * 0.6) });
      void spawnGroundWave(this.scene, this.tweens, victimSpot, {
        color: profile.wave.color,
        radius: profile.wave.radius,
        height: BOARD_TOP + 0.03,
        echo: profile.aftershock > 0.2,
      });
      this.effects.spawnSmoke(victimSpot.clone().setY(BOARD_TOP + 0.14), {
        count: Math.max(4, Math.round(settings.captureParticles * 0.3)),
        radius: 0.5,
        scale: 0.8,
        growth: 3.2,
        life: 1.2,
        speed: 2.4,
        rise: 0.1,
        color: 0x9c8f7d,
        opacity: 0.5,
      });
    }

    // 冲锋不会在命中处停下：尘土越过躯体继续往前。
    if (profile.wake) {
      this.effects.spawnSmoke(standoff.clone().setY(BOARD_TOP + 0.12), {
        count: Math.max(3, Math.round(settings.captureParticles * 0.2)),
        radius: 0.34,
        scale: 0.6,
        growth: 2.8,
        life: 0.9,
        speed: 0.8,
        rise: 0.15,
        color: 0xa5977f,
        opacity: 0.4,
        drift: direction.clone().multiplyScalar(2.1),
      });
    }

    // 顿帧：重击命中的瞬间，整拍停一两帧——
    // 这正是让一击感觉"砸上了质量"的东西。
    if (profile.hold > 0) await wait(profile.hold);

    if (!strike || strike.duration === 0) this.recover(attacker, direction, profile.heft);

    // 大厅慢一拍回应。
    if (profile.aftershock > 0) void this.aftershock(strikeSquare, profile.aftershock);

    // 防守方倒下时，进攻方正好把这一击收完。
    const recovery = strike ? Math.min(0.45, Math.max(0, strike.duration - strike.impact)) : 0.18;
    await Promise.all([this.slay(victim, blow), wait(recovery)]);

    void this.tweens.to({
      duration: 0.45,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * (1 - t);
        this.camera.updateProjectionMatrix();
      },
    });

    // 尸体在烟中被抛飞开，胜者踏上格子。抵达本身由
    // 宣告节拍（见 `claimSquare`）点出，而不是安静移动
    // 那一下普通的落子声。
    await Promise.all([
      this.banish(victim, blow),
      // 踏上它刚刚清空的格子的最后一步。
      this.glide(attacker, standoff, to, false, 1.5),
    ]);
  }

  /**
   * 王冠的特权：挥击之前，一道光柱落在死囚身上，
   * 钟声在它上方敲响，石面上的微粒从它脚边被抽起。
   * 棋盘上没有任何其他棋子被允许拥有这个节拍。
   */
  private async passSentence(
    victim: PieceView,
    at: THREE.Vector3,
    pillar: { radius: number; color: number },
    withLight: boolean,
  ): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    audio.judgementToll({ pan: this.stereoPan(at), volume: 0.95 });
    void spawnPillar(this.scene, this.tweens, at, {
      color: pillar.color,
      radius: pillar.radius,
      height: 5.6,
      floor: BOARD_TOP,
      hold: 0.46,
      light: withLight ? this.spellLights.acquire(pillar.color, 5.2) : null,
    });
    // 光把死囚周围的尘土从地板上卷起来。
    this.effects.spawnBurst(at.clone().setY(BOARD_TOP + 0.1), 0xffe6b4, Math.round(settings.captureParticles * 0.4), {
      speed: 0.5,
      life: 1,
      gravity: -1.6,
      radius: pillar.radius * 0.9,
      size: 0.08,
      growth: 0.4,
      drag: 1.4,
      rise: 0.7,
    });
    victim.flareAura(0.8);
    await wait(0.36);
  }

  /**
   * 重击之后石头还在动：地砖上第二记更轻的震颤，
   * 以及从格子上滚开的一团低低的砂尘。
   */
  private async aftershock(square: SquareId, strength: number): Promise<void> {
    await wait(0.18);
    const settings = QUALITY_SETTINGS[this.preset];
    this.shake.add(strength);
    this.board.impact(square, 0xffa457, strength * 0.7);
    const ground = squareToWorld(square, BOARD_TOP + 0.06);
    this.effects.spawnBurst(ground, 0xd8b285, Math.round(settings.captureParticles * 0.3), {
      speed: 1.4,
      life: 0.9,
      gravity: 2.2,
      radius: 0.55,
    });
  }

  /**
   * 施法者的节拍。这场战斗没有任何环节是在手臂所及
   * 的距离内进行的：女巫与法师留在自己的格子上，
   * 把法杖沿直线端平，在水晶处聚火，然后掷出。
   * 目标在原地燃烧——只有等躯体消失，施法者才走完
   * 整段距离踏上那个格子，连脚步声也一步不少。
   */
  private async playSpellCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
  ): Promise<void> {
    // 除吃过路兵外，受害者都站在目标格上；无论哪种，
    // 火焰都朝躯体飞去，爆炸把它从施法者身边抛离。
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(from).setY(0);
    if (blow.lengthSq() < 1e-6) blow.copy(to.clone().sub(from).setY(0));
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();

    const spell = spellProfile(attacker.kind);
    // 远程对决：把电光的两端都收进画面。
    this.focusPoint(from.clone().lerp(victimSpot, 0.55), 0.92);
    const punch = this.lensPunch(spell.zoom);
    void this.tweens.to({
      duration: 0.28,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * t;
        this.camera.updateProjectionMatrix();
      },
    });

    // 施法者端平法杖；目标看见朝自己来的东西。
    await Promise.all([
      attacker.turnTowards(victimSpot, this.tweens, 0.34),
      victim.turnTowards(from, this.tweens, 0.32),
    ]);
    attacker.faceTowards(victimSpot);

    // 攻击剪辑同时充当咒语：火焰在水晶上凝聚，直到
    // 剪辑本该挥出那一击的同一帧。女巫凝聚得更久，
    // 凝聚得也更多。
    const cast = attacker.hasClip("attack") ? attacker.playAttack() : null;
    const gather = (cast && cast.duration > 0 ? Math.max(0.34, cast.impact) : 0.55) + spell.gather;
    // 这个骨骼没有施法剪辑：由身体代替骨骼做施法动作——
    // 它向后仰，俯在自己正在凝聚的火焰上。
    const byHand = !cast || cast.duration <= 0;
    if (byHand) void this.castWind(attacker, gather);
    await this.gatherSpell(attacker, gather, spell.orb);
    // …然后身体随着电光离杖而向前掷出。
    if (byHand) this.castRelease(attacker, blow);

    const impact = victimSpot.clone().setY(0.62);
    if (spell.bolts > 1) {
      // 齐射：先导弹先到、在躯体上炸开，致命的一发
      // 落在它们后面，才是占据格子的那一下。
      const leaders: Promise<void>[] = [];
      for (let i = 0; i < spell.bolts - 1; i += 1) {
        leaders.push(this.throwFireball(attacker, impact, { size: 0.34, delay: i * 0.11, leader: true }));
      }
      await wait(0.18);
      await this.throwFireball(attacker, impact, { size: 0.64 });
      await Promise.all(leaders);
    } else {
      await this.throwFireball(attacker, impact);
    }
    this.spellBurst(attacker.color, impact, strikeSquare, spell.blast, spell.ring);

    // 施法者一步未动，对方已经死了。
    await this.slay(victim, blow);

    void this.tweens.to({
      duration: 0.45,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * (1 - t);
        this.camera.updateProjectionMatrix();
      },
    });

    // 尸体先被清出棋盘，然后才走向那个格子。
    await this.banish(victim, blow);
    if (cast) attacker.playIdle(0.2);
    this.focusPiece(attacker, 0.94);
    await this.glide(attacker, from, to, false, 1.15);
  }

  /**
   * 火药节拍。Grande Armée 从不走进一场它能站在原地
   * 了结的战斗：枪管端平，击锤后扳，弹丸又平又快地
   * 横越棋盘，在射手踏上那个格子之前，躯体就已经
   * 倒下并被清走。是哪一根枪管在说话，按棋子的等级
   * 从 {@link GUNS} 读出——皇帝的燧发枪、线列的火枪，
   * 或炮队的野战炮。
   */
  private async playGunCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
  ): Promise<void> {
    const gun = GUNS[attacker.kind];
    const settings = QUALITY_SETTINGS[this.preset];
    const look = GUN_LOOK[attacker.color];

    // 除吃过路兵外，受害者都站在目标格上；无论哪种，
    // 弹丸都朝躯体飞去，把它从射手身边抛离。
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(from).setY(0);
    if (blow.lengthSq() < 1e-6) blow.copy(to.clone().sub(from).setY(0));
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();

    // 远程对决：把弹道两端都收进画面。
    this.focusPoint(from.clone().lerp(victimSpot, 0.55), 0.92);
    const punch = this.lensPunch(gun.zoom);

    void this.tweens.to({
      duration: 0.26,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * t;
        this.camera.updateProjectionMatrix();
      },
    });

    // 枪管转过来；目标看见指着它的东西。
    await Promise.all([
      attacker.turnTowards(victimSpot, this.tweens, 0.32),
      victim.turnTowards(from, this.tweens, 0.32),
    ]);
    attacker.faceTowards(victimSpot);

    // 击发机构、通条或火绳杆：那声说明"这是火器"的机械咔哒。
    audio.gunLock({
      pan: this.stereoPan(from),
      weight: gun.calibre,
      volume: 0.5 + gun.calibre * 0.5,
    });

    // ---- 单膝跪下 ----------------------------------------
    // 跪姿枪手在任何其他事发生之前先跪到位，并且他用的是
    // 一段关节动画（倒放的起立剪辑）而不是被向下混合，
    // 所以膝盖扎在石面上，而不是整个身体穿过石头沉下去。
    const kneeling = gun.stance.kneel;
    if (kneeling) {
      const drop = attacker.playKneel(gun.stance.drop);
      if (drop > 0) {
        // 膝盖与接住步枪重量的那只手，落在石面真正被
        // 触及的那一帧。
        audio.footstep({
          pan: this.stereoPan(from),
          timbre: "scuff",
          volume: 0.42,
          delay: drop * 0.82,
          jitter: -0.3,
        });
        await wait(drop);
      }
    }

    // ---- 瞄准 ----------------------------------------------------
    // 武器抬起并指向躯体。携带瞄准画面的骨骼在这里循环
    // 播放它；没有的则手动倾身进入射击姿态，所以每个
    // 枪手在击发前都能被看见正在瞄准。
    const aiming = attacker.playAim(kneeling ? 0.3 : 0.18);
    if (!aiming) {
      void this.tweens.to({
        duration: Math.max(0.12, gun.aim),
        easing: Ease.outCubic,
        onUpdate: (t) => attacker.setStrikeTilt(-0.1 * t),
      });
    }
    await wait(gun.aim);

    // ---- 操练 -----------------------------------------------------
    // 站姿枪手按自己的可读时长播放他的射击剪辑（见
    // GunProfile.drill），弹丸在击锤落下的那一帧出膛，
    // 而不是蓄力中途。
    //
    // 跪姿枪手刻意不播放任何射击剪辑：生成器产出的每段
    // 射击素材都以站姿起、以站姿收，所以从跪姿播放会让
    // 他站起来开火再跪回去——正是这个分支要消除的上下
    // 起伏。他从保持的跪姿开火，整段射击（扳机、枪响、
    // 后坐）按操练数字计时，而不是按剪辑。剪辑没到位的
    // 骨骼则用手动方式端平枪管。
    const fire = !kneeling && attacker.hasClip("attack")
      ? attacker.playAttack({ seconds: gun.drill.seconds, impactAt: gun.drill.impact })
      : null;
    const byHand = !fire || fire.duration <= 0;
    // 没有剪辑时节拍仍保留这根枪管编排好的间距：
    // 射手的持枪瞄准是整整一秒的静止，不是三分之一秒。
    const untilShot = byHand
      ? Math.max(0.24, gun.drill.seconds * gun.drill.impact * (kneeling ? 1 : 0.32))
      : fire.impact;
    if (byHand) {
      // 前倾不再被等待：下面两段等待独占时钟，所以
      // 扳机与枪响无论剪辑是否到位都保持它们的间距。
      // 跪姿射手倚着自己的腿，所以他是沉到瞄具上，
      // 而不是探身压上去。
      const settle = kneeling ? -0.05 : -0.14 * (aiming ? 1 : 0.6);
      void this.tweens.to({
        duration: untilShot,
        easing: Ease.outCubic,
        onUpdate: (t) => attacker.setStrikeTilt(settle - (kneeling ? 0.02 : 0.06) * t),
      });
    }

    // ---- 扳机 ---------------------------------------------------
    // 前装枪是两个声音，不是一个。阻铁脱开，燧石刮过击砧，
    // 药池闪光；枪管里的装药在一个击发延时之后才点燃。
    // 所以机械半段在枪响*之前*`gun.lock` 秒播放，而枪响本身
    // 仍落在编排好的点火帧上，与枪口焰同步。正是这一点让
    // 枪声在听觉上属于扣动它的那根手指，而不是仅仅发生在
    // 它附近。
    const lock = Math.min(gun.lock, untilShot * 0.5);
    await wait(untilShot - lock);
    audio.triggerPull({
      pan: this.stereoPan(attacker.muzzleOrigin()),
      weight: gun.calibre,
      volume: 0.8 + gun.calibre * 0.4,
    });
    await wait(lock);

    // ---- 击发 ------------------------------------------------------
    const muzzle = attacker.muzzleOrigin();
    const chest = victimSpot.clone().setY(0.58);
    const line = chest.clone().sub(muzzle);
    const distance = Math.max(0.001, line.length());
    const aim = line.divideScalar(distance);

    audio.gunshot({
      pan: this.stereoPan(muzzle),
      weight: gun.calibre,
      volume: 1,
      voice: gun.voice,
    });
    this.shake.add(Math.min(1, 0.3 + gun.calibre * 0.7));

    // 焰口宽度按即将出膛的弹丸读出，所以装药
    // 永远盖过自己的抛射物。
    const flame = muzzleFlare(gun);
    void spawnMuzzleFlash(this.scene, this.tweens, muzzle, {
      look,
      size: flame,
      direction: aim,
      // 比以往多停一丝：枪口焰现在有一个点火平台托着，
      // 而多出的两三帧正是"看得见的一枪"和
      // "只听得见的一枪"之间的差别。
      life: 0.12 + gun.calibre * 0.07,
      // 更宽的一片火焰把光投到大厅更深处，所以借来的
      // 灯槽的触及范围随装药增长，而不是固定不变。
      light: settings.postFx ? this.spellLights.acquire(look.light, 4.4 + flame * 2.6) : null,
    });
    // 滑膛枪留下带着阵营制服色调的烟灰；神射手的
    // 线膛枪管留下能透出大厅的浅灰白色。
    const powder = gun.smokeTint ?? look.smoke;
    void spawnPowderCloud(this.scene, this.tweens, muzzle, {
      look,
      size: 0.34 + gun.calibre * 0.7,
      direction: aim,
      count: Math.max(3, Math.round(gun.smoke * (settings.captureParticles >= 34 ? 1 : 0.55))),
      life: gun.smokeHang,
      tint: powder,
      density: gun.smokeDensity,
      fine: gun.fineSmoke,
      // 被大厅的气流带离格子、贴着石板滚开，
      // 而不是从石头里沉下去。
      draft: HALL_DRAFT,
      floor: BOARD_TOP + 0.05,
    });
    // 枪响之后枪管还在他手里冒烟——从活的枪口处发烟，
    // 这样武器收下来时烟仍跟着枪管走。
    this.boreTrickle(attacker, gun, powder);
    // 从药池和枪管里抛出的火星与燃着的药粒。尺寸按火焰
    // 而不是常数取，这样药粒才和它成比例：野战炮抛出
    // 可见的火星，手枪击发机构只弹出一小撮。
    this.effects.spawnBurst(muzzle, look.ball, Math.round(settings.captureParticles * 0.44 * (0.5 + gun.calibre)), {
      speed: 2.6 + gun.calibre * 3,
      life: 0.55,
      gravity: 2.4,
      radius: 0.06 + flame * 0.06,
      size: 0.07 + flame * 0.055,
      drag: 2.4,
    });

    // 后坐：躯体被这一枪震得后仰，拖曳火炮则顺着
    // 轮子向后滑，再由炮组把它推回原位。
    this.kickBack(attacker, blow, gun);

    // 弹道是平的：无弧线、无缓动。横越大厅的是哪种弹——
    // 会飘的铸造铅丸、不飘的线膛米涅弹，还是一块烧红的
    // 铁——按这根枪管的配弹读出。
    //
    // 弹丸从枪口前方一点点离开，而不是从枪口点本身：
    // 若正好从枪口出发，它会生在枪口焰和药烟团里，
    // 飞行的前三分之一都看不见。
    // 火焰越大，这个偏移也得跟着变大，否则弹丸开头的
    // 几帧都泡在发射它的那团火里。
    const clear = muzzle.clone().addScaledVector(aim, Math.min(0.42, flame * 0.44));
    const smoking = settings.captureParticles >= 34;
    let nextWisp = 0.12;
    await flyShot(this.scene, this.tweens, clear, chest, {
      look,
      ammo: gun.ammo,
      size: gun.ball,
      flight: THREE.MathUtils.clamp((distance / TILE) * gun.speed, 0.17, 0.58),
      light: gun.ammo === "roundShot" && settings.postFx ? this.spellLights.acquire(0xff7a2e, 3.2) : null,
      // 沿弹道的拖痕——让一枪能被眼睛跟上、而不只是
      // 被耳朵听见的东西。它的骨架分辨率是唯一随
      // 画质预设缩放的开销。
      trailDetail: trailRings(settings.captureParticles),
      onTrail: (at, t) => {
        if (!smoking || t < nextWisp) return;
        nextWisp += 0.22;
        this.effects.spawnSmoke(at.clone(), {
          count: 1,
          radius: 0.06,
          scale: (0.2 + gun.calibre * 0.22) * (gun.fineSmoke ? 0.75 : 1),
          growth: 2.4,
          life: gun.fineSmoke ? 0.34 : 0.5,
          speed: 0.2,
          rise: gun.fineSmoke ? 0.3 : 0.16,
          color: powder,
          opacity: 0.2,
        });
      },
    });

    // ---- 命中 -------------------------------------------------------
    const power = gun.blast;
    // 弹丸抵达，先于通用的吃子打击声：一声呼啸接一记闷响。
    audio.ballImpact({ pan: this.stereoPan(chest), volume: Math.min(1.1, 0.7 + gun.calibre * 0.5) });
    audio.play("capture", Math.min(1, 0.7 * power));
    this.strikeImpact(strikeSquare, Math.min(1.5, power));
    this.effects.spawnFlash(chest, Math.min(4.6, 1.9 * power), 0.2);

    // 这一刻本身：躯体在弹丸钻入处崩开。崩出什么残骸按
    // 受害者而不是射手读出——王国大理石屑、太阳帝国黑曜石
    // 薄片、胸甲上崩下的钢屑，或大军团军服上的羊毛与镀金
    // 饰带。弹丸决定有多狠：手枪弹 barely 在石板上留印，
    // 六磅炮把它掀个底朝天。
    const round = AMMUNITION[gun.ammo];
    const body = this.impactBody(victim);
    const violence = round.shatter * (0.75 + power * 0.25);
    void spawnImpactShatter(this.scene, this.tweens, chest, {
      body,
      along: aim,
      power: violence,
      floor: BOARD_TOP,
      through: round.through,
      budget: Math.round(settings.captureParticles * 0.85),
      light: settings.postFx ? this.spellLights.acquire(0xffd7a0, 3.4) : null,
    });
    // 残骸上再叠一层更薄的暖色爆发：那是跟着弹丸来的
    // 火药，不是弹丸本身。
    this.effects.spawnBurst(chest, look.flash, Math.round(settings.captureParticles * 0.34 * power), {
      speed: 3.6 * (0.9 + power * 0.1),
      life: 0.45,
      gravity: 2.2,
      radius: 0.1,
      drag: 2.6,
    });
    // 残骸扬起的雾，是刚刚碎掉的那种材质的颜色。
    this.effects.spawnSmoke(chest, {
      count: Math.max(2, Math.round(settings.captureParticles * 0.14 * power)),
      radius: 0.24 * power,
      scale: 0.45 * power,
      growth: 2.6,
      life: 0.9,
      speed: 1,
      rise: 0.5,
      color: impactDust(body),
      opacity: 0.4,
    });
    this.shake.add(Math.min(1, 0.3 * power));

    // 实心弹不会留在它命中的人身上。一块六磅的铁
    // 干净地穿透过去，继续在他身后的石板上弹跳——
    // 这正是告诉眼睛"这是一门炮而不是一杆大火枪"的东西。
    if (gun.ammo === "roundShot") {
      const beyond = chest.clone().addScaledVector(aim, TILE * 1.7).setY(BOARD_TOP + 0.05);
      void (async () => {
        await flyShot(this.scene, this.tweens, chest, beyond, {
          look,
          ammo: gun.ammo,
          size: gun.ball,
          flight: 0.24,
          light: null,
          trailDetail: trailRings(settings.captureParticles),
        });
        audio.ballImpact({ pan: this.stereoPan(beyond), volume: 0.42 });
        // 滚烫的铁撞上石板：跳弹崩起石屑，拖出一长串
        // 贴着地板乱窜的火星。
        void spawnImpactShatter(this.scene, this.tweens, beyond, {
          body: "flagstone",
          // 是从地板上跳起来的，所以崩屑从石头里向上冒。
          along: aim.clone().setY(-0.75).normalize(),
          power: 1.5,
          floor: BOARD_TOP,
          through: false,
          budget: Math.round(settings.captureParticles * 0.5),
          light: null,
        });
        this.effects.spawnSmoke(beyond, {
          count: 2,
          radius: 0.2,
          scale: 0.5,
          growth: 2.8,
          life: 0.8,
          speed: 0.9,
          rise: 0.35,
          color: 0x9a8f7e,
          opacity: 0.3,
        });
      })();
    }

    // 野战炮的威力不会止于身体：余下的冲击由石板承受。
    if (gun.wave) {
      audio.groundSlam({ pan: this.stereoPan(victimSpot), volume: Math.min(1, power * 0.5) });
      void spawnGroundWave(this.scene, this.tweens, victimSpot, {
        color: gun.wave.color,
        radius: gun.wave.radius,
        height: BOARD_TOP + 0.03,
        echo: true,
      });
      this.effects.spawnSmoke(victimSpot.clone().setY(BOARD_TOP + 0.12), {
        count: Math.max(4, Math.round(settings.captureParticles * 0.28)),
        radius: 0.52,
        scale: 0.8,
        growth: 3.2,
        life: 1.3,
        speed: 2.2,
        rise: 0.1,
        color: 0x9c8f7d,
        opacity: 0.5,
      });
    }

    if (gun.hold > 0) await wait(gun.hold);
    if (gun.aftershock > 0) void this.aftershock(strikeSquare, gun.aftershock);

    // 弹丸一出膛，瞄准视线便不再游移：开过火的人会盯着自己命中的目标。
    // 跪姿保持不动——从枪声响起，到棋盘对面的人倒下之间，身体没有任何变化。
    if (aiming) attacker.setAimDrift(0.18);

    // 目标在原地被击毙，而射手还未挪动半步。
    await this.slay(victim, blow);

    void this.tweens.to({
      duration: 0.45,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * (1 - t);
        this.camera.updateProjectionMatrix();
      },
    });

    // 在再次装填火炮的同时清除尸体——没人会空着枪管走向目标格。
    // 跪姿炮手就*以开火时的那条跪膝*完成装填，这一段不会让他起身。
    await Promise.all([this.banish(victim, blow), this.reload(attacker, gun)]);

    // ……然后，也只有在这之后，他才从石板上起身。
    if (kneeling) await this.riseToFeet(attacker, from);

    // ……直到此刻，他才走向那个格子。
    this.focusPiece(attacker, 0.94);
    await this.glide(attacker, from, to, false, 1.1);
  }

  /**
   * 射击结束、尸体清除之后，从跪姿起身。
   *
   * 这里刻意作为独立的一段演出，而不是装填或行进的副作用：跪姿射击的全部
   * 意义就在于，从他跪下的那一刻起，到再也没有目标可打的那一刻为止，他始终
   * 保持同一个姿势。站起来是对这份坚持的*奖赏*，所以允许它花足够的时间，
   * 并且要听得见——腿伸直时靴子承重的声音。
   *
   * 如果骨骼的起身剪辑尚未就绪，则退化为一段较长的交叉淡入回到站姿，
   * 这比旧的 0.22s 瞬间切换更慢，读起来像是"起身"而不是"弹直"。
   */
  private async riseToFeet(attacker: PieceView, at: THREE.Vector3): Promise<void> {
    const pan = this.stereoPan(at);
    const length = attacker.playRise(0.95);
    if (length <= 0) {
      attacker.playIdle(0.5);
      await wait(0.4);
      return;
    }
    audio.footstep({ pan, timbre: "scuff", volume: 0.5, delay: length * 0.55, jitter: -0.2 });
    await wait(length);
    // 剪辑被钳制在站立帧上，所以站姿是从一个已经站直的身体中混合出来的。
    attacker.playIdle(0.2);
  }

  /**
   * 击发之后仍在冒烟的枪管。
   *
   * 火药烟团在开火的位置只生成一次，随后留在空中——这是对的，因为空气
   * 不会跟着人走。但脏污的枪管在之后的一两秒内还会继续泄烟，而*那*烟属于
   * 武器本身：无论枪口移到哪里，烟都必须从枪口冒出来。所以烟缕按时间节拍
   * 发射，每一缕在生成的那一刻读取 {@link PieceView.muzzleOrigin}，于是当
   * 射手从跪姿收起步枪时，那一线烟会肉眼可见地拖着枪管走。
   *
   * 每一缕烟都比上一缕更细、更慢：枪管正在冷却。
   */
  private boreTrickle(attacker: PieceView, gun: GunProfile, tint: number): void {
    const settings = QUALITY_SETTINGS[this.preset];
    // 最低画质预设没有余量给击杀之外的烟雾。
    if (settings.captureParticles < 34 || gun.boreSmoke.wisps <= 0) return;
    const { seconds, wisps } = gun.boreSmoke;
    const width = 0.1 + gun.calibre * 0.18;
    let next = 0;
    void this.tweens.to({
      duration: seconds,
      easing: (t: number) => t,
      onUpdate: (t: number) => {
        if (t < next) return;
        next += 1 / wisps;
        // 开火后那一帧为 0，枪管凉透时为 1。
        const cooling = Math.min(1, t);
        this.effects.spawnSmoke(attacker.muzzleOrigin(), {
          count: 1,
          radius: width * 0.5,
          scale: width * (0.7 + cooling * 0.75),
          growth: 2.9,
          // 最后几缕烟停留得最久——它们最没有什么可失去的。
          life: (gun.fineSmoke ? 0.85 : 1.1) * (0.8 + cooling * 0.7),
          // 几乎没有推力：这是从枪管里渗出来的，而不是被吹出来的。
          speed: 0.16 * (1 - cooling * 0.5),
          rise: (gun.fineSmoke ? 0.34 : 0.24) * (1 - cooling * 0.3),
          color: tint,
          opacity: (gun.fineSmoke ? 0.2 : 0.28) * (1 - cooling * 0.55),
          drift: HALL_DRAFT,
        });
      },
    });
  }

  /**
   * 后坐。射手被开火顶得向后一晃再稳住；牵引式火炮则靠轮子猛地后退，
   * 再被重新推回标线——比任何烟雾都更能让人感受到装药的分量。
   */
  private kickBack(attacker: PieceView, blow: THREE.Vector3, gun: GunProfile): void {
    const reach = TILE * gun.kick;
    void (async () => {
      await this.tweens.to({
        duration: 0.07,
        easing: Ease.outQuint,
        onUpdate: (t) => {
          attacker.runtime.position.x = -blow.x * reach * t;
          attacker.runtime.position.z = -blow.z * reach * t;
          attacker.setStrikeTilt(-0.16 * t);
        },
      });
      await this.tweens.to({
        duration: 0.34,
        easing: Ease.outCubic,
        onUpdate: (t) => {
          attacker.runtime.position.x = -blow.x * reach * (1 - t);
          attacker.runtime.position.z = -blow.z * reach * (1 - t);
          attacker.setStrikeTilt(-0.16 * (1 - t));
        },
      });
      attacker.runtime.position.x = 0;
      attacker.runtime.position.z = 0;
      attacker.setStrikeTilt(0);
    })();

    if (gun.recoil <= 0 || !attacker.hasTrain) return;
    this.gunRecoil(attacker, gun);
  }

  /**
   * 一门野战炮开火。棋子不是被轻推——而是被抛出去：轮子离开石板，炮口
   * 跳起，炮架沿着自己炮架尾的长度向后冲出、落地、再滚一小段，然后才被
   * 推回标线。开火那一帧，尘土从轮子底下被锤出来，而在炮声之后片刻，还能
   * 听见石板承受后坐冲击的声音。
   */
  private gunRecoil(attacker: PieceView, gun: GunProfile): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const carriage = attacker.trainOrigin();
    if (carriage) {
      const pan = this.stereoPan(carriage);
      // 炮架尾紧随炮声砸回石板。
      audio.groundSlam({ pan, volume: 0.34, delay: 0.05 });
      // ……以及后冲到底时轮子重新落地的声音。
      audio.footstep({ pan, timbre: "plate", volume: 0.5, delay: 0.2, jitter: -0.18 });
      this.effects.spawnSmoke(carriage.clone().setY(BOARD_TOP + 0.05), {
        count: Math.max(3, Math.round(settings.captureParticles * 0.2)),
        radius: 0.34,
        scale: 0.5,
        growth: 2.8,
        life: 1,
        speed: 1.5,
        rise: 0.08,
        color: 0x9c8f7d,
        opacity: 0.42,
      });
      this.effects.spawnBurst(carriage.clone().setY(BOARD_TOP + 0.04), 0xc7ac82, Math.round(settings.captureParticles * 0.2), {
        speed: 2.6,
        life: 0.5,
        gravity: 3.2,
        radius: 0.16,
        size: 0.06,
        drag: 2.6,
      });
    }

    void (async () => {
      // 装药把它顶起来：不到十分之一秒内向后又向上。
      await this.tweens.to({
        duration: 0.07,
        easing: Ease.outQuint,
        onUpdate: (t) => attacker.setTrainRecoil(gun.recoil * t, t),
      });
      // 炮还在向后滑时，轮子重新咬住石面。
      await this.tweens.to({
        duration: 0.22,
        easing: Ease.outCubic,
        onUpdate: (t) =>
          attacker.setTrainRecoil(gun.recoil * (1 + t * 0.14), Math.pow(1 - t, 1.6)),
      });
      // 然后是炮组把它推回标线：缓慢，正如现实中那样。
      await this.tweens.to({
        duration: 0.86,
        easing: Ease.inOutCubic,
        onUpdate: (t) => attacker.setTrainRecoil(gun.recoil * 1.14 * (1 - t)),
      });
      attacker.setTrainRecoil(0);
    })();

    // 大厅在炮声之后一拍才承受后坐，而不是与炮声同时。
    void (async () => {
      await wait(0.06);
      this.shake.add(0.34);
    })();
  }

  /**
   * 开火后重新伺候这门炮：如果骨骼带有操练剪辑就播放它，同时配上通条与
   * 枪机的声音。时长与清除尸体的一段对齐，所以这段演出不占用战斗的任何
   * 额外时间。
   *
   * 站姿炮手在装填结束时被交还到他的站姿。跪姿炮手则**不会**：他的装填
   * 是在膝上完成的，在这里让他站起来，会在本应是他纹丝不动完成的那一段
   * 演出中间插入一次姿势变化。他会在之后由 {@link SceneEngine.riseToFeet}
   * 统一起身一次。
   */
  private async reload(attacker: PieceView, gun: GunProfile): Promise<void> {
    if (!attacker.hasClip("reload")) return;
    const pan = this.stereoPan(attacker.container.position);
    const length = attacker.playReload();
    if (length <= 0) return;
    audio.gunLock({ pan, weight: gun.calibre, volume: 0.42, delay: length * 0.28 });
    audio.gunLock({ pan, weight: gun.calibre * 0.6, volume: 0.32, delay: length * 0.62 });
    await wait(Math.min(length, 0.95));
    if (!gun.stance.kneel) attacker.playIdle(0.22);
  }

  /** 没有剪辑的施法者：双肩在汇聚的火焰上方向后仰。 */
  private async castWind(attacker: PieceView, duration: number): Promise<void> {
    await this.tweens.to({
      duration: Math.max(0.14, duration * 0.85),
      easing: Ease.outCubic,
      onUpdate: (t) => attacker.setStrikeTilt(-0.22 * t),
    });
  }

  /** 释放：法杖挥下，身体跟着飞出的弹丸前倾。 */
  private castRelease(attacker: PieceView, direction: THREE.Vector3): void {
    const reach = TILE * 0.2;
    const push = (offset: number, tilt: number) => {
      attacker.runtime.position.x = direction.x * offset;
      attacker.runtime.position.z = direction.z * offset;
      attacker.setStrikeTilt(tilt);
    };
    void (async () => {
      await this.tweens.to({
        duration: 0.14,
        easing: Ease.outQuint,
        onUpdate: (t) => push(reach * t, THREE.MathUtils.lerp(-0.22, 0.26, t)),
      });
      await this.tweens.to({
        duration: 0.38,
        easing: Ease.outCubic,
        onUpdate: (t) => push(reach * (1 - t), 0.26 * (1 - t)),
      });
      push(0, 0);
    })();
  }

  /**
   * 蓄力：一团火在法杖顶端汇聚成形，由从周围空气中卷入的余烬喂养，伴随着
   * 混音中渐强的蓄能声。火球每一帧都根据道具自身的施法点重新定位，所以
   * 无论施法手臂如何挥动，它都始终待在水晶里。
   */
  private async gatherSpell(attacker: PieceView, duration: number, size: number): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    const look = SPELL_LOOK[attacker.color];
    const orb = new SpellOrb(look, size, this.spellLights.acquire(look.light, 4.6));
    orb.group.position.copy(attacker.castOrigin());
    this.scene.add(orb.group);

    audio.spellCharge({ pan: this.stereoPan(orb.group.position), duration, volume: size * 2 });
    attacker.flareAura(Math.min(1.2, size * 1.4));

    const motes = Math.max(3, Math.round(settings.captureParticles * 0.14 * (size * 2.4)));
    let nextMote = 0.14;
    try {
      await this.tweens.to({
        duration,
        easing: Ease.linear,
        onUpdate: (t) => {
          const at = attacker.castOrigin();
          orb.group.position.copy(at);
          // 起势很慢，随后便一发不可收拾。
          orb.setIntensity(t * t * 1.15);
          orb.animate(this.elapsed);
          if (t >= nextMote) {
            nextMote += 0.16;
            // 火星向内坠落：先被甩到外圈，再被引力拽回来。
            this.effects.spawnBurst(at, look.ember, motes, {
              speed: 0.55,
              life: 0.45,
              gravity: -1.1,
              radius: 0.36,
              size: 0.075,
              growth: 0.28,
              drag: 2.6,
              rise: 0.2,
            });
          }
        },
      });
    } finally {
      orb.dispose();
    }
  }

  /**
   * 一发弹丸：从法杖到目标胸口的一道平而快的弧线，一路洒落余烬和一缕
   * 细烟。射击距离越远，飞行时间按比例越长，让人感受到横跨棋盘的距离。
   *
   * `leader` 是女巫在致命弹丸之前先发出去的小火球——它偏离中线投出，
   * 自行在目标身上炸开，从不带走那个格子。
   */
  private async throwFireball(
    attacker: PieceView,
    target: THREE.Vector3,
    options: { size?: number; delay?: number; leader?: boolean } = {},
  ): Promise<void> {
    if (options.delay && options.delay > 0) await wait(options.delay);
    const settings = QUALITY_SETTINGS[this.preset];
    const look = SPELL_LOOK[attacker.color];
    const start = attacker.castOrigin();
    const size = options.size ?? 0.52;
    const leader = options.leader === true;
    // 先行火球从肩膀侧向飞来，而不是沿直线正中而来。
    const aim = target.clone();
    if (leader) {
      const side = new THREE.Vector3(0, 1, 0).cross(target.clone().sub(start).setY(0).normalize());
      aim.addScaledVector(side, (Math.random() - 0.5) * 0.5).setY(target.y + (Math.random() - 0.4) * 0.3);
    }
    const distance = start.distanceTo(aim);
    const flight = THREE.MathUtils.clamp(distance * 0.1, 0.22, 0.62);
    const lift = 0.1 + distance * 0.05;
    const motes = Math.max(3, Math.round(settings.captureParticles * 0.16 * (leader ? 0.6 : 1)));
    const smoking = settings.captureParticles >= 34 && !leader;

    // 只有致命弹丸才点亮大厅：在它之前发出的先行火球如果也带光，
    // 就会各自为那三个灯光槽位争抢几帧。
    const orb = new SpellOrb(look, size, leader ? null : this.spellLights.acquire(look.light, 4.6));
    orb.group.position.copy(start);
    orb.setIntensity(1);
    this.scene.add(orb.group);

    audio.spellCast({ pan: this.stereoPan(start), volume: leader ? 0.5 : 1 });
    this.shake.add(leader ? 0.04 : 0.08);

    const at = new THREE.Vector3();
    let nextTrail = 0;
    try {
      await this.tweens.to({
        duration: flight,
        easing: Ease.linear,
        onUpdate: (t) => {
          at.lerpVectors(start, target, t);
          at.y += Math.sin(Math.PI * t) * lift;
          orb.group.position.copy(at);
          // 它在逼近目标身体时收得更紧、烧得更亮。
          orb.setIntensity(1 + t * 0.4);
          orb.animate(this.elapsed);
          if (t >= nextTrail) {
            nextTrail += 0.1;
            this.effects.spawnBurst(at.clone(), look.ember, motes, {
              speed: 0.7,
              life: 0.65,
              gravity: -0.4,
              radius: 0.12,
              size: 0.09,
              growth: 0.35,
              drag: 2.2,
              rise: 0.1,
            });
            if (smoking) {
              this.effects.spawnSmoke(at.clone(), {
                count: 2,
                radius: 0.12,
                scale: 0.32,
                growth: 2.6,
                life: 0.6,
                speed: 0.25,
                rise: 0.18,
                color: 0x8a7d6e,
                opacity: 0.22,
              });
            }
          }
        },
      });
    } finally {
      orb.dispose();
    }

    // 先行火球自行炸开：一小团火焰爆响，不带走格子。
    if (leader) {
      audio.spellImpact({ pan: this.stereoPan(aim), volume: 0.4 });
      this.effects.spawnFlash(aim, 1.5, 0.2);
      this.effects.spawnBurst(aim, look.core, Math.round(settings.captureParticles * 0.35), {
        speed: 2.8,
        life: 0.45,
        gravity: 1.8,
        radius: 0.12,
      });
      this.shake.add(0.14);
    }
  }

  /**
   * 弹丸在目标身体上炸开：一记刺眼的白闪，一圈向外抛出的火壳，余烬悬留
   * 在空气中，格子本身也受到不亚于任何利刃的重击。`scale` 表示施法者在
   * 这一发里注入了多少火力，`ring` 则让爆炸沿石板滚开——女巫会留下
   * 一道环，法师不会。
   */
  private spellBurst(color: Faction, at: THREE.Vector3, square: SquareId, scale = 1, ring = 0): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const look = SPELL_LOOK[color];

    audio.spellImpact({ pan: this.stereoPan(at), volume: Math.min(1.4, scale) });
    audio.play("capture", Math.min(1, 0.5 * scale));
    this.strikeImpact(square, Math.min(1.5, 1.1 * scale));
    this.effects.spawnFlash(at, Math.min(6, 3.4 * scale), 0.3);
    this.effects.spawnBurst(at, look.core, Math.round(settings.captureParticles * scale), {
      speed: 4.4 * (0.9 + scale * 0.1),
      life: 0.55,
      gravity: 2.6,
      radius: 0.1,
    });
    this.effects.spawnBurst(at, look.ember, Math.round(settings.captureParticles * 0.7 * scale), {
      speed: 1.5,
      life: 1.5,
      gravity: -0.7,
      radius: 0.3 * scale,
      size: 0.1,
      growth: 0.38,
      drag: 1.6,
      rise: 0.5,
    });
    this.effects.spawnSmoke(at, {
      count: Math.max(3, Math.round(settings.captureParticles * 0.22 * scale)),
      radius: 0.34 * scale,
      scale: 0.7 * scale,
      growth: 2.8,
      life: 1.1,
      speed: 1.2,
      rise: 0.6,
      color: 0x7d7062,
      opacity: 0.55,
    });
    this.shake.add(Math.min(1, 0.6 * scale));

    if (ring > 0) {
      // 火焰贴着格子平平地铺开，地板随之回应。
      audio.groundSlam({ pan: this.stereoPan(at), volume: 0.5 });
      void spawnGroundWave(this.scene, this.tweens, at, {
        color: look.flame,
        radius: ring,
        height: BOARD_TOP + 0.03,
        life: 0.62,
        echo: true,
      });
      this.effects.spawnBurst(at.clone().setY(BOARD_TOP + 0.12), look.ember, Math.round(settings.captureParticles * 0.5), {
        speed: 3.6,
        life: 0.9,
        gravity: 1.2,
        radius: 0.2,
        size: 0.1,
        growth: 0.5,
        drag: 1.8,
      });
    }
  }

  /**
   * 为没有攻击剪辑的棋子准备的打击动作——未绑定骨骼的雕塑，或剪辑始终
   * 未能加载的棋子。它背向目标蓄力，后仰并扭出中线，然后把一切向前倾泻，
   * 让打击从头顶劈落；它在打击命中的那一刻恰好收束，所以调用方播放的
   * 命中演出保持不变。倾斜通过 {@link PieceView} 保持，这样在带骨骼的
   * 雕塑上拥有姿态控制权的骨架就无法抹掉这次挥击。
   *
   * @param heft 0 = 轻刃，1 = 被拽着抡过来的攻城武器
   */
  private async lunge(attacker: PieceView, direction: THREE.Vector3, heft = 0): Promise<void> {
    const reach = TILE * (0.36 + heft * 0.1);
    const wind = -reach * 0.45;
    const twist = 0.44 + heft * 0.22;
    const chop = 0.3 + heft * 0.14;
    const push = (offset: number, yaw: number, tilt: number) => {
      attacker.runtime.position.x = direction.x * offset;
      attacker.runtime.position.z = direction.z * offset;
      attacker.runtime.rotation.y = yaw;
      attacker.setStrikeTilt(tilt);
    };

    // 重心移回后脚，双肩转出中线，武器收回到身体后方。
    await this.tweens.to({
      duration: 0.2 + heft * 0.14,
      easing: Ease.outCubic,
      onUpdate: (t) => push(wind * t, -twist * t, -0.18 * t),
    });
    // 随后一切同时向前倾泻，打击从头顶劈落。
    await this.tweens.to({
      duration: 0.11,
      easing: Ease.inCubic,
      onUpdate: (t) =>
        push(
          THREE.MathUtils.lerp(wind, reach, t),
          THREE.MathUtils.lerp(-twist, 0.3, t),
          THREE.MathUtils.lerp(-0.18, chop, t),
        ),
    });
  }

  /** 从突刺中收势：身体旋回自己的格子上方。 */
  private recover(attacker: PieceView, direction: THREE.Vector3, heft = 0): void {
    const reach = TILE * (0.36 + heft * 0.1);
    const chop = 0.3 + heft * 0.14;
    void this.tweens.to({
      duration: 0.32 + heft * 0.1,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        attacker.runtime.position.x = direction.x * reach * (1 - t);
        attacker.runtime.position.z = direction.z * reach * (1 - t);
        attacker.runtime.rotation.y = 0.3 * (1 - t);
        attacker.setStrikeTilt(chop * (1 - t));
      },
    });
  }

  /**
   * 死亡演出：沿打击方向驱动的受击踉跄，完整的骨骼死亡剪辑（棋子保持
   * 倒下后的姿势），然后在尸体被清除前短暂停留。未绑定骨骼的雕塑退化
   * 为直挺挺的倾倒。
   */
  private async slay(victim: PieceView, blow: THREE.Vector3): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    victim.takeHit();
    audio.bodyFall(0.8);

    const chest = victim.container.position.clone().setY(0.5);
    this.cryOut(victim, chest);
    this.effects.spawnBurst(chest, 0xff5a3a, Math.round(settings.captureParticles * 0.5), {
      speed: 2.8,
      life: 0.55,
    });

    if (!victim.hasAnimations) {
      await this.topple(victim, blow, 0.55);
      return;
    }

    const death = victim.playDeath();
    if (death <= 0) {
      await this.topple(victim, blow, 0.55);
      return;
    }

    // 被击得双脚离地向后飞出，随后随着身体落定被拖着停下。
    void this.tweens.to({
      duration: Math.min(0.5, death * 0.6),
      easing: Ease.outQuint,
      onUpdate: (t) => {
        victim.runtime.position.x = blow.x * t * 0.22;
        victim.runtime.position.z = blow.z * t * 0.22;
      },
    });

    await wait(death);
    // 尸体落地时扬起尘土，然后停顿一拍，让这次倒下被看清。
    this.effects.spawnBurst(victim.container.position.clone().setY(0.16), 0x9c8a6a, 24, {
      speed: 1.3,
      life: 0.8,
    });
    this.effects.spawnSmoke(victim.container.position.clone().setY(0.12), {
      count: Math.max(3, Math.round(settings.captureParticles * 0.16)),
      radius: 0.42,
      scale: 0.7,
      growth: 2.2,
      life: 1,
      speed: 0.8,
      rise: 0.2,
      color: 0x8f8172,
      opacity: 0.5,
    });
    await wait(0.14);
  }

  /**
   * 退场：倒下的棋子绝不会简单地凭空消失。步兵与骑手沿翻滚的弧线被抛
   * 出棋盘，沉重的宫廷棋子则被拖入一根翻腾的烟柱——两种情况下，身体
   * 本身都穿过一片噪声场燃尽，在空中稀散成余烬。
   */
  private async banish(victim: PieceView, blow: THREE.Vector3): Promise<void> {
    const heavy = victim.kind === "k" || victim.kind === "q" || victim.kind === "r";
    if (heavy) await this.swallow(victim);
    else await this.hurl(victim, blow);
  }

  /** 被击飞出棋盘：弹道弧线、首尾翻滚、拖着烟迹。 */
  private async hurl(victim: PieceView, blow: THREE.Vector3): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    const start = victim.container.position.clone();
    const rest = victim.container.quaternion.clone();
    const plume = Math.max(4, Math.round(settings.captureParticles * 0.22));

    victim.setAirborne(true);
    audio.bodyFall(0.32);
    this.shake.add(0.16);

    // 从石板上被撕脱：砖面溅起砂砾，吐出第一口烟。
    this.effects.spawnBurst(start.clone().setY(0.18), 0xc0a075, Math.round(settings.captureParticles * 0.4), {
      speed: 2.6,
      life: 0.6,
    });
    this.effects.spawnSmoke(start.clone().setY(0.28), {
      count: plume,
      radius: 0.42,
      scale: 0.85,
      growth: 2.6,
      life: 1.2,
      speed: 1.1,
      rise: 0.5,
      color: 0x9b8b76,
      opacity: 0.7,
    });

    const lateral = new THREE.Vector3(-blow.z, 0, blow.x).multiplyScalar((Math.random() - 0.5) * TILE * 0.7);
    const distance = TILE * 2.5;
    const spinAxis = new THREE.Vector3(-blow.z, 0.35, blow.x).normalize();
    const spin = Math.PI * (1.7 + Math.random() * 1.1);
    const tumble = new THREE.Quaternion();
    const position = new THREE.Vector3();
    let nextTrail = 0.14;
    let nextEmber = 0.2;
    const motes = Math.max(4, Math.round(settings.captureParticles * 0.16));

    await this.tweens.to({
      duration: 0.82,
      easing: Ease.linear,
      onUpdate: (t) => {
        position.copy(start).addScaledVector(blow, distance * t).addScaledVector(lateral, t * t);
        // 猛烈的抛射，在身体散开时仍在爬升。
        position.y = start.y + Math.sin(Math.PI * t * 0.78) * 1.5;
        victim.container.position.copy(position);
        tumble.setFromAxisAngle(spinAxis, spin * t);
        victim.container.quaternion.copy(tumble).multiply(rest);
        victim.container.scale.setScalar(1 - t * 0.2);
        // 两层"离去"：表面从脚底向上烧穿，残余的部分同时在光中稀薄下去。
        victim.setDissolve(Math.max(0, (t - 0.2) / 0.74));
        victim.setOpacity(1 - 0.7 * Math.max(0, (t - 0.3) / 0.7));
        if (t >= nextEmber) {
          nextEmber += 0.09;
          // 余烬从燃烧边缘剥落，悬留在身体原本所在的位置。
          this.effects.spawnBurst(position.clone().setY(position.y + 0.3), EMBER_COLOR[victim.color], motes, {
            speed: 0.5,
            life: 1.5,
            gravity: -0.5,
            radius: 0.32,
            size: 0.085,
            growth: 0.35,
            drag: 1.9,
            rise: 0.3,
          });
        }
        if (t >= nextTrail) {
          nextTrail += 0.16;
          this.effects.spawnSmoke(position.clone().setY(position.y + 0.35), {
            count: Math.max(2, Math.round(plume * 0.4)),
            radius: 0.2,
            scale: 0.55,
            growth: 2.3,
            life: 0.9,
            speed: 0.45,
            rise: 0.3,
            color: 0x94897b,
            opacity: 0.45,
          });
        }
      },
    });

    // 它永远不会落地——身体在半空中烧穿，然后消失。
    const end = position.clone();
    this.effects.spawnBurst(end, EMBER_COLOR[victim.color], motes * 3, {
      speed: 0.85,
      life: 1.9,
      gravity: -0.6,
      radius: 0.42,
      size: 0.1,
      growth: 0.3,
      drag: 1.6,
      rise: 0.45,
    });
    this.effects.spawnSmoke(end, {
      count: plume + 4,
      radius: 0.45,
      scale: 1.05,
      growth: 3,
      life: 1.3,
      speed: 1.3,
      rise: 0.45,
      color: 0x8d8174,
      opacity: 0.75,
      drift: blow.clone().multiplyScalar(0.55),
    });
    this.effects.spawnBurst(end, 0xffa561, Math.round(settings.captureParticles * 0.35), {
      speed: 2.3,
      life: 0.7,
    });

    victim.setDissolve(1);
    victim.setOpacity(0);
    victim.container.scale.setScalar(1);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
    victim.setAirborne(false);
  }

  /** 宫廷棋子随棋盘一起下沉：沉下去，化作一柱烟。 */
  private async swallow(victim: PieceView): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    const start = victim.container.position.clone();
    const rest = victim.container.quaternion.clone();
    const plume = Math.max(5, Math.round(settings.captureParticles * 0.3));
    const up = new THREE.Vector3(0, 1, 0);
    const swirl = new THREE.Quaternion();

    audio.bodyFall(0.45);
    this.shake.add(0.12);
    this.effects.spawnSmoke(start.clone().setY(0.14), {
      count: plume,
      radius: 0.5,
      scale: 1,
      growth: 3.1,
      life: 1.5,
      speed: 1.4,
      rise: 0.85,
      color: 0x746757,
      opacity: 0.85,
    });
    this.effects.spawnBurst(start.clone().setY(0.2), 0xb59a72, Math.round(settings.captureParticles * 0.35), {
      speed: 1.8,
      life: 0.7,
    });

    let nextPuff = 0.22;
    let nextEmber = 0.16;
    const motes = Math.max(5, Math.round(settings.captureParticles * 0.2));
    await this.tweens.to({
      duration: 0.86,
      easing: Ease.inCubic,
      onUpdate: (t) => {
        victim.container.position.y = start.y - t * 0.4;
        victim.container.scale.setScalar(1 - t * 0.22);
        swirl.setFromAxisAngle(up, t * 0.8);
        victim.container.quaternion.copy(swirl).multiply(rest);
        // 王室的消解是缓慢的：烧灼随下沉爬上躯体，
        // 残余的部分在下沉途中化作薄雾。
        victim.setDissolve(Math.max(0, (t - 0.12) / 0.8));
        victim.setOpacity(Math.max(0.12, 1 - t * 0.85));
        if (t >= nextEmber) {
          nextEmber += 0.1;
          this.effects.spawnBurst(start.clone().setY(0.34 + t * 0.5), EMBER_COLOR[victim.color], motes, {
            speed: 0.42,
            life: 1.8,
            gravity: -0.62,
            radius: 0.3,
            size: 0.095,
            growth: 0.32,
            drag: 1.7,
            rise: 0.5,
          });
        }
        if (t >= nextPuff) {
          nextPuff += 0.24;
          this.effects.spawnSmoke(start.clone().setY(0.2), {
            count: Math.max(3, Math.round(plume * 0.45)),
            radius: 0.45,
            scale: 0.8,
            growth: 2.6,
            life: 1.2,
            speed: 1,
            rise: 0.65,
            color: 0x8b7d6d,
            opacity: 0.6,
          });
        }
      },
    });

    // 最后的部分在它自己的格子上方化作一柱缓缓升起的余烬。
    this.effects.spawnBurst(start.clone().setY(0.5), EMBER_COLOR[victim.color], motes * 3, {
      speed: 0.35,
      life: 2.2,
      gravity: -0.7,
      radius: 0.34,
      size: 0.105,
      growth: 0.28,
      drag: 1.4,
      rise: 0.6,
    });

    // 它曾占据的格子上留下一汪低低飘荡的烟。
    this.effects.spawnSmoke(start.clone().setY(0.1), {
      count: Math.max(4, Math.round(plume * 0.6)),
      radius: 0.6,
      scale: 0.9,
      growth: 2.8,
      life: 1.6,
      speed: 0.7,
      rise: 0.15,
      color: 0x8f8272,
      opacity: 0.5,
    });

    victim.setDissolve(1);
    victim.setOpacity(0);
    victim.container.scale.setScalar(1);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
  }

  /**
   * 棋子自己的临终之声。每支军队的每个等级都有一段录好的
   * 惨叫，按躯体在屏幕上的位置做声像，并加音高抖动让重复
   * 听起来绝不雷同；越重的等级死得越响、音调也略低。
   */
  private cryOut(victim: PieceView, chest: THREE.Vector3): void {
    const weight = CRY_WEIGHT[victim.kind];
    audio.deathCry(victim.color, victim.kind, {
      pan: this.stereoPan(chest),
      volume: weight.volume,
      rate: weight.rate * (0.95 + Math.random() * 0.1),
      delay: 0.03 + Math.random() * 0.05,
    });
  }

  /** 一个世界坐标点在屏幕横向的位置，以 -1..1 的立体声位置表示。 */
  private stereoPan(position: THREE.Vector3): number {
    const projected = position.clone().project(this.camera);
    if (!Number.isFinite(projected.x)) return 0;
    return Math.max(-1, Math.min(1, projected.x));
  }

  /** 给无骨骼素体用的刚性翻倒：被击翻，脸朝下。 */
  private async topple(victim: PieceView, blow: THREE.Vector3, duration: number): Promise<void> {
    const start = victim.container.position.clone();
    const axis = new THREE.Vector3(blow.z, 0, -blow.x).normalize();
    const fallen = new THREE.Quaternion().setFromAxisAngle(axis, -Math.PI * 0.46);
    const rest = victim.container.quaternion.clone();
    const target = fallen.multiply(rest);
    await this.tweens.to({
      duration,
      easing: Ease.outBounce,
      onUpdate: (t) => {
        victim.container.quaternion.slerpQuaternions(rest, target, t);
        victim.container.position.y = start.y + Math.sin(Math.PI * t) * 0.06;
        victim.container.position.x = start.x + blow.x * t * 0.12;
        victim.container.position.z = start.z + blow.z * t * 0.12;
      },
    });
    this.effects.spawnBurst(start.clone().setY(0.12), 0x9c8a6a, 22, { speed: 1.4, life: 0.7 });
    await wait(0.2);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
  }

  /**
   * 被占据格子上的棋盘级打击反馈：一道衰减为冲击波环的
   * 白闪、地砖猛地错位、石上溅起的火星，以及一次短促的
   * 镜头顿挫。
   */
  private strikeImpact(square: SquareId, strength: number): void {
    const settings = QUALITY_SETTINGS[this.preset];
    this.board.impact(square, 0xff7a3a, strength);
    this.shake.add(0.22 * strength);
    const ground = squareToWorld(square, BOARD_TOP + 0.05);
    this.effects.spawnFlash(ground.clone().setY(BOARD_TOP + 0.18), 1.5 * strength, 0.2);
    this.effects.spawnBurst(ground, 0xffb066, Math.round(settings.captureParticles * 0.45 * strength), {
      speed: 2.1,
      life: 0.5,
    });
  }

  /**
   * 弹丸抵达时面对的东西。
   *
   * 命中抛出的残骸必须由*受害者*的材质构成，而不是射手的
   * 火药——打进太阳帝国黑曜石偶像的一弹，不可能溅出和
   * 打进羊毛军服同样的暖色砂尘。所以材质按躯体所属的军队
   * 读出，而全甲等级无论穿什么制服都按钢来回应：胸甲骑兵的
   * 护胸和塔楼守卫的铁甲都是迸火星，而不是崩碎片。
   */
  private impactBody(victim: PieceView): ImpactBody {
    const armoured = victim.kind === "n" || victim.kind === "r";
    switch (this.factory.getSkins()[victim.color]) {
      case "empire":
        return armoured ? "plate" : "uniform";
      case "sun":
        // 黑曜石与翡翠：它不成块崩，而是剥成玻璃薄片。
        return armoured ? "plate" : "obsidian";
      default:
        return armoured ? "plate" : "marble";
    }
  }

  /**
   * 不带运镜演出的死亡：棋子仍播放它的死亡剪辑并被击倒，
   * 只是没有镜头调度，也没有对峙距离。
   */
  private async crumble(victim: PieceView, killer: THREE.Vector3): Promise<void> {
    const blow = victim.container.position.clone().sub(killer).setY(0);
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();
    victim.faceTowards(killer);
    await this.slay(victim, blow);
    await this.banish(victim, blow);
  }

  private async rejectMove(square: SquareId): Promise<void> {
    const piece = this.pieces.get(square);
    audio.blip("deny");
    if (!piece) return;
    await this.tweens.to({
      duration: 0.32,
      easing: Ease.linear,
      onUpdate: (t) => {
        piece.runtime.position.x = Math.sin(t * Math.PI * 6) * 0.07 * (1 - t);
      },
    });
    piece.runtime.position.x = 0;
  }

  // ------------------------------------------------------------------- 镜头

  /**
   * 战斗节拍的镜头冲击，按当前取景来缩放。手机用宽得多的
   * 镜头框住棋盘，固定的 6° 推近在那里几乎看不出；冲击
   * 是取景的一个比例，而不是常数。
   */
  private lensPunch(degrees: number): number {
    return degrees * (this.lensFov / DEFAULT_FOV);
  }

  async moveCameraTo(shot: CameraShot, duration = 1.1): Promise<void> {
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    this.controls.enabled = false;
    this.cameraScripted = true;
    try {
      await this.tweens.to({
        duration,
        easing: Ease.inOutCubic,
        onUpdate: (t) => {
          this.camera.position.lerpVectors(fromPosition, shot.position, t);
          this.controls.target.lerpVectors(fromTarget, shot.target, t);
        },
      });
    } finally {
      this.cameraScripted = false;
      this.captureFollowRig();
    }
    this.controls.enabled = this.interactive;
  }

  // ------------------------------------------------------------ 跟随镜头

  /**
   * 演示模式的跟随镜头。它保持一个角度和一个距离——观看者
   * 上次把画面停在哪儿就是哪儿——只把镜组向侧面平移来把
   * 动作留在画面里，这样棋盘从不在战斗下方旋转。
   *
   * @returns 引擎正在接管镜头时返回 true。
   */
  private updateFollowCamera(delta: number): boolean {
    if (!this.showcase || this.showcaseCamera !== "follow") return false;
    if (this.tactical || this.orbiting || this.cameraScripted || this.introPlaying) return false;
    // 鼠标上的手永远优先；几秒钟后恢复跟随。
    if (this.elapsed - this.lastManualCameraAt < 2.4) return false;

    const subject = this.followPiece?.container.position ?? this.followPoint ?? BOARD_FOCUS;
    // 向动作倾身，而不是僵硬地跟在正后方：眼睛只覆盖棋盘的
    // 一部分而不是全部——既让其余局面留在画面里，
    // 也让镜组避开大厅。
    this.scratchFocus
      .copy(BOARD_FOCUS)
      .addScaledVector(this.scratchLean.copy(subject).sub(BOARD_FOCUS), FOLLOW_LEAN)
      .setY(THREE.MathUtils.clamp(subject.y + 0.45, 0.35, 1.1));
    this.followedFocus.lerp(this.scratchFocus, 1 - Math.exp(-delta * 3.6));

    const desired = this.solveFollowEye(
      THREE.MathUtils.clamp(
        this.followRig.radius * this.followTightness,
        this.limits.minDistance,
        this.limits.maxDistance,
      ),
    );
    const smooth = 1 - Math.exp(-delta * 2.4);
    this.camera.position.lerp(desired, smooth);
    this.controls.target.lerp(this.followedFocus, smooth);
    return true;
  }

  /**
   * 跟随装置所请求的镜头位置，已经求解到落在大厅之内。
   *
   * 这正是阻止演示镜头抖动的东西。装置锚定在动作上，
   * 所以跟踪棋盘近半边的任何东西都会要求镜头伸到墙后——
   * 而在平滑已经跑完之后才在*镜头*上修正这一点（也就是
   * {@link confineCamera} 唯一能做的），等于在循环里
   * 放进一个硬投影：每一帧追逐都向外跨一步，墙把它推回去，
   * 高度还要再经过一次平方根重新推导。对着沿近列行进的
   * 棋子实测，这把镜头的平均帧间抖动翻了一倍，单帧
   * 尖峰达到屏幕高度的百分之零点五——几乎每一步棋
   * 都能看见抖动。
   *
   * 所以墙在这里被求解，在任何东西移动之前：装置的地面
   * 触及距离被截到大厅实际容得下的范围，先从距离里扣，
   * 不够再动用俯仰。结果是同一段指数平滑得到一个合法
   * 目标，跟随时 `confineCamera` 永不触发，镜头最终
   * 反而比旧钳位留下的位置*更低*。
   */
  private solveFollowEye(radius: number): THREE.Vector3 {
    const focus = this.followedFocus;
    const { phi, theta } = this.followRig;
    const room = HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN;
    // 镜头沿装置朝向能走多远才离开大厅：
    // |focus + reach · heading| = room 的正根。
    const towards = Math.sin(theta) * focus.x + Math.cos(theta) * focus.z;
    const span = towards * towards - (focus.x * focus.x + focus.z * focus.z) + room * room;
    const available = span <= 0 ? 0 : Math.max(0, Math.sqrt(span) - towards);
    const reach = Math.min(radius * Math.sin(phi), available);
    // 先从距离里扣，扣到下限；剩下的由俯仰补。
    const pulled = THREE.MathUtils.clamp(
      reach / Math.max(1e-3, Math.sin(phi)),
      Math.max(this.limits.minDistance, radius * (1 - FOLLOW_GIVE)),
      radius,
    );
    this.followOffset.set(
      pulled,
      Math.max(this.limits.minPolarAngle, Math.asin(THREE.MathUtils.clamp(reach / pulled, 0, 1))),
      theta,
    );
    return this.scratchDesired.setFromSpherical(this.followOffset).add(focus);
  }

  /**
   * 记住画面当前停驻的角度和距离，这样跟随镜头从观看者
   * 摆放镜头的位置去跟动作，而不是弹回某个罐头机位。
   */
  private captureFollowRig(): void {
    const offset = this.scratchDesired.copy(this.camera.position).sub(this.controls.target);
    if (offset.lengthSq() < 1e-4) return;
    const spherical = new THREE.Spherical().setFromVector3(offset);
    this.followRig.phi = spherical.phi;
    this.followRig.theta = spherical.theta;
    this.followRig.radius = THREE.MathUtils.clamp(
      spherical.radius / Math.max(0.4, this.followTightness),
      this.limits.minDistance + 0.9,
      Math.max(13, this.fitRadius * 1.05),
    );
  }

  /** 跟随镜头主体：正在横越棋盘的那枚棋子。 */
  private focusPiece(piece: PieceView | null, tightness = 1): void {
    this.followPiece = piece;
    if (piece) this.followPoint = null;
    this.followTightness = tightness;
  }

  /** 跟随镜头主体：一个固定点——战斗处，或被占据的格子。 */
  private focusPoint(point: THREE.Vector3 | null, tightness = 1): void {
    this.followPiece = null;
    this.followPoint = point ? point.clone() : null;
    this.followTightness = tightness;
  }

  setCameraPreset(preset: CameraPreset): void {
    // 选一个 3D 机位总是先把平面地图收起来。
    if (this.tactical) {
      this.setTacticalView(false, CAMERA_SHOTS[preset]);
      return;
    }
    this.framedShot = CAMERA_SHOTS[preset];
    const framing = this.framingFor(this.framedShot);
    this.adoptFraming(framing);
    void this.moveCameraTo(framing);
  }

  // --------------------------------------------------------- 战术 2D 视图

  /** 棋盘正被当作一张俯视平面图读取时为 true。 */
  isTacticalView(): boolean {
    return this.tactical;
  }

  /**
   * 把大厅收起来、把棋盘读作一张 2D 地图：镜头爬上窄镜头的
   * 俯拍机位，每枚棋子被替换成一枚印着等级的平面算子，
   * 棋盘周围的世界被熄掉，没有任何东西能立在玩家和
   * 格子之间。
   */
  setTacticalView(active: boolean, exitShot?: CameraShot): void {
    if (this.tactical === active) return;
    this.tactical = active;
    this.callbacks.onTacticalView?.(active);

    if (active) {
      this.tacticalReturn = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };
      this.strikeWorld();
      this.applyTacticalAtmosphere();
      for (const piece of this.allPieces()) piece.setFlat(true);
      this.alignTokens();

      this.controls.enableRotate = false;
      this.controls.autoRotate = false;
      this.framedShot = TACTICAL_SHOT;
      void this.flyTo(this.framingFor(TACTICAL_SHOT));
      return;
    }

    const look = ARENA_LOOKS[this.arena];
    this.restoreWorld();
    (this.scene.background as THREE.Color).setHex(look.background);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = look.fog.density;
    this.applyExposure(look.exposure);
    for (const piece of this.allPieces()) piece.setFlat(false);

    this.controls.enableRotate = true;
    const shot = exitShot ?? this.tacticalReturn ?? CAMERA_SHOTS.white;
    this.tacticalReturn = null;
    this.framedShot = shot;
    void this.flyTo(this.framingFor(shot));
  }

  /** 在 3D 与地图两种取景之间同时缓动焦距的镜头移动。 */
  private async flyTo(framing: Framing): Promise<void> {
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const fromFov = this.camera.fov;
    const fov = framing.fov;
    this.lensFov = fov;
    this.fitRadius = framing.radius;
    this.applyOrbitLimits();
    this.controls.enabled = false;
    this.cameraScripted = true;
    await this.tweens.to({
      duration: 0.95,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        this.camera.position.lerpVectors(fromPosition, framing.position, t);
        this.controls.target.lerpVectors(fromTarget, framing.target, t);
        this.camera.fov = fromFov + (fov - fromFov) * t;
        this.camera.updateProjectionMatrix();
      },
    });
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.cameraScripted = false;
    this.captureFollowRig();
    this.controls.enabled = this.interactive;
  }

  /** 一片染上主题色的黑暗虚空：无雾，除了棋盘无可读之物。 */
  private applyTacticalAtmosphere(): void {
    const look = ARENA_LOOKS[this.arena];
    (this.scene.background as THREE.Color).setHex(look.background).multiplyScalar(0.16);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = 0;
    this.applyExposure(look.exposure * 1.12);
  }

  /**
   * 隐藏布景世界但保持每盏灯都亮着——棋盘仍须由它一刻前
   * 的那套主光、补光和火把来照明。
   */
  private strikeWorld(): void {
    for (const group of [this.hall.group, this.battlefield.group, this.jungle.group]) {
      for (const child of group.children) {
        if ((child as THREE.Light).isLight || !child.visible) continue;
        child.visible = false;
        this.struck.push(child);
      }
    }
  }

  private restoreWorld(): void {
    for (const object of this.struck) object.visible = true;
    this.struck = [];
  }

  /**
   * 旋转每一枚算子，让印在上面的等级在屏幕上保持竖直，
   * 无论地图被转到哪个方向。
   */
  private alignTokens(): void {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const yaw = Math.atan2(-up.x, -up.z);
    for (const piece of this.allPieces()) piece.setTokenYaw(yaw);
  }

  /** 引擎当前持有的每一枚棋子，无论它处于生命周期的哪一段。 */
  private *allPieces(): Generator<PieceView> {
    for (const piece of this.pieces.values()) yield piece;
    for (const piece of this.motion) yield piece;
    for (const piece of this.captured) yield piece;
  }

  /**
   * 让镜头绕棋盘中心转过 `deltaTheta` 弧度，保持当前距离和
   * 仰角，取景绝不跳动。
   */
  private async orbitBy(deltaTheta: number, duration: number): Promise<void> {
    if (this.orbiting) return;
    this.orbiting = true;
    const target = this.controls.target.clone();
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const startTheta = spherical.theta;
    const wasEnabled = this.controls.enabled;
    this.controls.enabled = false;
    try {
      await this.tweens.to({
        duration,
        easing: Ease.inOutCubic,
        onUpdate: (t) => {
          spherical.theta = startTheta + deltaTheta * t;
          this.camera.position.copy(target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
          this.camera.lookAt(target);
        },
      });
    } finally {
      this.orbiting = false;
      this.controls.enabled = wasEnabled && this.interactive;
    }
  }

  /**
   * HUD 控件：把画面转半圈，让玩家从对手一侧读棋盘。
   * 从任何预设或手拖角度都可用。
   */
  flipCamera(): void {
    if (this.orbiting) return;
    this.cameraFlipped = !this.cameraFlipped;
    this.callbacks.onCameraFlipped?.(this.cameraFlipped);
    void this.orbitBy(Math.PI, 0.95);
  }

  /** 画面当前停在起始机位的另一侧时为 true。 */
  isCameraFlipped(): boolean {
    return this.cameraFlipped;
  }

  /**
   * 热座模式：回合之间把镜头绕棋盘转过去。属于可选行为，
   * 且比手动翻转更慢（1.15s -> 1.8s）：手动翻转是玩家
   * 主动要求并注视的，而这一转是在玩家已经在跟随的一步棋
   * 结束时自行到来的，所以它必须读作大厅在转动，
   * 而不是一次剪切。
   */
  private async swingCamera(): Promise<void> {
    await this.orbitBy(Math.PI, 1.8);
  }

  async playIntro(): Promise<void> {
    if (this.introPlaying) return;
    this.introPlaying = true;
    this.introSkipped = false;
    this.interactive = false;
    this.controls.enabled = false;
    this.postfx.setCinematic(true, 7);

    // 飞入是一段演出，保留它编排好的路径，但它落下的镜头
    // 是玩家接下来要使用的——所以这一个像其他每个取景
    // 一样按屏幕求解。
    this.framedShot = CAMERA_SHOTS.white;
    const rest = this.framingFor(CAMERA_SHOTS.white);
    this.adoptFraming(rest);
    const path: CameraShot[] = [
      { position: new THREE.Vector3(13.5, 2.1, 12.5), target: new THREE.Vector3(5, 3.2, 3.5) },
      { position: new THREE.Vector3(8.5, 2.4, 10.5), target: new THREE.Vector3(0, 1.4, 0) },
      { position: new THREE.Vector3(2.6, 4.2, 9.6), target: new THREE.Vector3(0, 0.6, 0) },
      rest,
    ];
    this.camera.position.copy(path[0].position);
    this.controls.target.copy(path[0].target);

    for (let i = 1; i < path.length; i += 1) {
      if (this.introSkipped) break;
      await this.moveCameraTo(path[i], i === path.length - 1 ? 2.2 : 2.4);
      this.controls.enabled = false;
    }

    this.camera.position.copy(rest.position);
    this.controls.target.copy(rest.target);
    this.postfx.setCinematic(false);
    this.introPlaying = false;
    this.interactive = true;
    this.controls.enabled = true;
  }

  skipIntro(): void {
    if (!this.introPlaying) return;
    this.introSkipped = true;
    this.tweens.cancelAll();
  }

  private async playEndCinematic(): Promise<void> {
    const snapshot = this.controller.getSnapshot();
    const result = snapshot.result;
    if (!result) return;
    audio.play("fanfare", 0.7);
    // 俯视地图保持原有构图：不推轨，不景深。
    if (this.tactical) return;

    const loser: Faction | null = result.winner ? (result.winner === "w" ? "b" : "w") : null;
    let focus = new THREE.Vector3(0, 0.6, 0);
    if (loser) {
      for (const [square, piece] of this.pieces) {
        if (piece.kind === "k" && piece.color === loser) {
          focus = squareToWorld(square, 0.7);
          break;
        }
      }
    }
    this.postfx.setCinematic(true, Math.max(4, this.camera.position.distanceTo(focus) * 0.55));
    const direction = this.camera.position.clone().sub(focus).normalize();
    const shot: CameraShot = {
      position: focus.clone().add(direction.multiplyScalar(3.4)).setY(1.9),
      target: focus,
    };
    this.shake.add(0.35);
    await this.moveCameraTo(shot, 2.4);
  }

  // ---------------------------------------------------------------- 升变

  /**
   * 构建升变兵可以选择的四个候选棋子。
   *
   * 这是一个模态时刻，所以按模态的方式来布景：一块深色面板落在候选棋子
   * 身后，每个候选棋子都立在自己的底座上，铭牌写着兵种名称和选择它的
   * 按键。光摆四个雕塑并不能构成玩家能读懂的选择——这支军队里的每个
   * 军官都是王室身高，差异全在他们手中的武器上，而在选择器的尺寸下那
   * 只是几个像素。
   */
  private buildPromotionPicker(color: Faction): void {
    this.closePromotionPicker();
    const group = new THREE.Group();
    const pedestalGeometry = new THREE.CylinderGeometry(0.44, 0.54, 0.22, 24);
    const accent = new THREE.Color(FACTION_ACCENT[color]);

    PROMOTION_CHOICES.forEach(({ kind, key }) => {
      const slot = new THREE.Group();
      const pedestal = new THREE.Mesh(
        pedestalGeometry,
        new THREE.MeshStandardMaterial({
          color: 0x3a332a,
          roughness: 0.5,
          metalness: 0.7,
          emissive: accent.clone().multiplyScalar(0.4),
          emissiveIntensity: 0.5,
        }),
      );
      pedestal.position.y = -0.11;
      pedestal.userData.promotion = kind;
      slot.add(pedestal);

      const view = this.factory.create(kind, color, {
        contactShadows: false,
        idleAnimation: true,
        rankBadge: false,
      });
      view.container.scale.setScalar(PROMOTION_SLOT_SCALE);
      for (const mesh of view.hitMeshes) mesh.userData.promotion = kind;
      // 棋子在自己的组内旋转，这样待机动画的转动永远不会把铭牌带偏。
      const spin = new THREE.Group();
      spin.add(view.container);
      slot.add(spin);

      const plaque = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: promotionPlaqueTexture(kind, color, PIECE_LABEL[kind], key),
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      plaque.scale.set(PROMOTION_SLOT_WIDTH, PROMOTION_SLOT_WIDTH / PLAQUE_ASPECT, 1);
      plaque.position.y = -0.5;
      plaque.renderOrder = 60;
      plaque.frustumCulled = false;
      // 铭牌是最容易瞄准的目标，所以它也能响应点选。
      plaque.userData.promotion = kind;
      slot.add(plaque);

      this.promotionViews.push(view);
      this.promotionSlots.push({ kind, group: slot, spin, view, plaque, pedestal, attention: 0 });
      group.add(slot);
    });

    // 纱幕：挂在候选棋子身后，每帧按视口调整尺寸，让远处的军队呈现为压暗的
    // 背景，而不是候选棋子必须与之抗争的杂乱干扰。在手机上实测，加纱幕之前
    // 棋盘上的棋子遮挡了每个候选棋子剪影的 94–100%。
    const scrim = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x04060c, transparent: true, opacity: 0, depthWrite: false }),
    );
    scrim.position.z = -PROMOTION_SCRIM_DEPTH;
    scrim.renderOrder = -1;
    scrim.frustumCulled = false;
    group.add(scrim);
    this.promotionScrim = scrim;

    this.scene.add(group);
    this.promotionGroup = group;
    this.promotionHover = null;
    this.setBoardOverlaysMuted(true);
    this.layoutPromotionPicker(0);
    this.callbacks.onPromotionOpen(true);
  }

  /**
   * 把升变选择器放到镜头前方，并根据视口求解它的尺寸：宽屏上一字排开四个，
   * 屏幕太窄、放不下四个可读棋子并排时改用 2x2 网格。在手机上实测，旧的
   * 贴棋盘横排把每个候选棋子画成 38px 高、淹没在远处军队里；求解后的网格
   * 让同一个棋子在纱幕前达到约 115px。
   */
  private layoutPromotionPicker(delta: number): void {
    const group = this.promotionGroup;
    if (!group) return;

    const aspect = Math.max(0.35, this.camera.aspect);
    const columns = aspect < 1.05 ? 2 : PROMOTION_CHOICES.length;
    const rows = Math.ceil(PROMOTION_CHOICES.length / columns);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const spanWide = (columns - 1) * PROMOTION_SPACING + PROMOTION_SLOT_WIDTH;
    const spanTall = (rows - 1) * PROMOTION_ROW_GAP + PROMOTION_SLOT_HEIGHT;
    const distance = THREE.MathUtils.clamp(
      Math.max(spanWide / (PROMOTION_FILL * 2 * halfHeight * aspect), spanTall / (PROMOTION_FILL * 2 * halfHeight)),
      3,
      9,
    );

    // 锚定在镜头上而不是棋盘上：这样选择器在每种屏幕上的观感都一致，
    // 也永远不会被藏进一排棋子身后。
    const forward = this.camera.getWorldDirection(this.pickerScratch);
    group.position.copy(this.camera.position).addScaledVector(forward, distance);
    if (this.tactical) {
      // 垂直俯视时"上"没有意义——直接借用镜头自身的朝向，
      // 让网格始终与屏幕保持方正。
      group.quaternion.copy(this.camera.quaternion);
    } else {
      group.rotation.set(0, 0, 0);
      group.lookAt(this.camera.position);
    }

    this.promotionSlots.forEach((slot, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const hovered = this.promotionHover === slot.kind;
      slot.attention += ((hovered ? 1 : 0) - slot.attention) * Math.min(1, delta * 12);
      slot.group.position.set(
        (column - (columns - 1) / 2) * PROMOTION_SPACING,
        ((rows - 1) / 2 - row) * PROMOTION_ROW_GAP + PROMOTION_SLOT_HEIGHT * 0.1 + slot.attention * 0.12,
        slot.attention * 0.18,
      );
      slot.group.scale.setScalar(1 + slot.attention * 0.06);
      slot.spin.rotation.y = this.elapsed * 0.7 + index * 0.5;
      const pedestal = slot.pedestal.material as THREE.MeshStandardMaterial;
      pedestal.emissiveIntensity = 0.5 + slot.attention * 1.6;
      (slot.plaque.material as THREE.SpriteMaterial).opacity = 0.9 + slot.attention * 0.1;
    });

    if (this.promotionScrim) {
      const depth = distance + PROMOTION_SCRIM_DEPTH;
      const height = 2 * halfHeight * depth * 1.25;
      this.promotionScrim.scale.set(height * aspect * 1.25, height, 1);
      const material = this.promotionScrim.material as THREE.MeshBasicMaterial;
      material.opacity = Math.min(0.72, material.opacity + delta * 3);
    }

    this.postfx.setCinematic(true, distance + 0.4);
  }

  private closePromotionPicker(): void {
    if (this.promotionGroup) {
      this.scene.remove(this.promotionGroup);
      this.promotionGroup.traverse((node) => {
        const carrier = node as THREE.Mesh | THREE.Sprite;
        if ((carrier as THREE.Mesh).isMesh && (carrier as THREE.Mesh).geometry) (carrier as THREE.Mesh).geometry.dispose();
        // 雕塑归属于各自的 PieceView，随它一起销毁；这里只释放
        // 选择器自己的底座、铭牌和纱幕。
        if (!carrier.userData.promotion && !(carrier as THREE.Sprite).isSprite) return;
        const material = carrier.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) for (const entry of material) entry.dispose();
        else material?.dispose();
      });
      this.promotionGroup = null;
    }
    for (const view of this.promotionViews) view.dispose();
    this.promotionViews = [];
    this.promotionSlots = [];
    this.promotionScrim = null;
    this.promotionHover = null;
    this.setBoardOverlaysMuted(false);
    this.postfx.setCinematic(false);
    this.callbacks.onPromotionOpen(false);
  }

  /**
   * 选择器打开期间，让无视深度的棋盘覆盖层退场。
   *
   * 兵种纹章和透视准星是故意用 `depthTest: false` 绘制的——纹章若被挡在
   * 前排棋子身后就毫无用处。但同样的特权也让它们能穿透模态面板：站在
   * 选择器身后的军队纹章会压到候选棋子和它们的铭牌之上。仅靠渲染顺序
   * 无法解决，因为底座和雕塑是不透明的，会在所有透明精灵之前绘制；
   * 所以覆盖层必须退场。玩家自己的纹章开关偏好不受影响——这是一个
   * 独立的静默，选择器关闭时恢复。
   */
  private setBoardOverlaysMuted(muted: boolean): void {
    for (const piece of this.pieces.values()) piece.setBadgeMuted(muted);
    for (const piece of this.motion) piece.setBadgeMuted(muted);
    for (const piece of this.captured) piece.setBadgeMuted(muted);
    this.board.setOverlaysMuted(muted);
  }

  /** 指针射线当前命中了哪个候选棋子（如果有的话）。 */
  private pickPromotion(): PieceKind | null {
    if (!this.promotionGroup) return null;
    const targets: THREE.Object3D[] = [];
    this.promotionGroup.traverse((node) => {
      if ((node as THREE.Mesh).isMesh || (node as THREE.Sprite).isSprite) targets.push(node);
    });
    for (const hit of this.raycaster.intersectObjects(targets, false)) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        const kind = node.userData.promotion as PieceKind | undefined;
        if (kind) return kind;
        node = node.parent;
      }
    }
    return null;
  }

  /**
   * 接收来自画布之外的选择——即印在每个铭牌上的键盘快捷键。
   * 除非确实有升变在等待，否则为空操作。
   */
  choosePromotion(kind: PieceKind): boolean {
    if (!this.promotionResolve) return false;
    if (!PROMOTION_CHOICES.some((choice) => choice.kind === kind)) return false;
    audio.blip("press");
    this.promotionResolve(kind);
    return true;
  }

  private requestPromotion(color: Faction): Promise<PieceKind> {
    this.buildPromotionPicker(color);
    return new Promise<PieceKind>((resolve) => {
      this.promotionResolve = (kind) => {
        this.promotionResolve = null;
        this.closePromotionPicker();
        resolve(kind);
      };
    });
  }

  // -------------------------------------------------------------- 交互

  private bindEvents(): void {
    this.controls.addEventListener("start", this.onManualCamera);
    this.controls.addEventListener("change", this.onManualCameraChange);
    this.controls.addEventListener("end", this.onManualCameraEnd);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("resize", this.handleResize);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /**
   * 解析指针当前悬停在什么之上。
   *
   * 棋子是真人大小的人形，所以一座雕塑在屏幕上会遮住它*身后*的格子。
   * 因此只检测地块的话，玩家一点击棋子身体就会返回错误的格子——这次
   * 点击会悄无声息地落到棋盘上两排之外。每个棋子都带一个隐形碰撞体，
   * 射线先碰到碰撞体还是地块，谁近谁赢。
   *
   * 这条规则对"选择棋子"是对的，对"走子"却是错的，两者的差异由
   * {@link reachUnderPointer} 来裁定。
   */
  private pickTarget(exclude?: PieceView | null): { square: SquareId | null; piece: PieceView | null } {
    const hit = this.rayPick(exclude);
    const reach = this.reachUnderPointer();
    if (reach === null || reach === hit.square) return hit;

    // 棋子只代表它脚下的那一格，仅此而已。此时指针落在某个亮起的目的地
    // 自己的投影轮廓内，所以除非指针*同时*也悬在前方障碍所占的那一格
    // 上——它的脚、它的底座、它被点选时所在的地块——否则目的地才是
    // 玩家真正瞄准的目标。
    if (hit.square !== null && this.pointerOverSquare(hit.square)) return hit;
    return { square: reach, piece: this.pieces.get(reach) ?? null };
  }

  /** 射线下最近的实体：棋子的碰撞体，或是石板地面。 */
  private rayPick(exclude?: PieceView | null): { square: SquareId | null; piece: PieceView | null } {
    const colliders: THREE.Mesh[] = [];
    for (const piece of this.pieces.values()) {
      if (piece === exclude) continue;
      colliders.push(...piece.hitMeshes);
    }
    const pieceHit = this.raycaster.intersectObjects(colliders, false)[0] ?? null;
    const tileHit = this.raycaster.intersectObjects(this.board.tiles, false)[0] ?? null;

    if (pieceHit && (!tileHit || pieceHit.distance <= tileHit.distance)) {
      const piece = (pieceHit.object.userData.piece as PieceView | undefined) ?? null;
      const square = piece ? this.squareOf(piece) : null;
      if (square) return { square, piece };
    }

    const square = tileHit
      ? ((tileHit.object.userData.square as SquareId | undefined) ?? null)
      : this.squareUnderRay();
    return { square, piece: square ? (this.pieces.get(square) ?? null) : null };
  }

  /**
   * 指针悬停的那个亮起的目的地，**无视深度**。
   *
   * 这盘棋是在低机位、真人大小棋子之间进行的，所以一个合法格子通常
   * 藏在某个身体身后而不是旁边：在初始局面下，马的两个目的地在桌面
   * 窗口里有 88% 被前排的兵挡住，手机上约 64%。过去这些点击全被兵
   * 吃掉——选中跳到了兵身上而不是马走子，看起来就像棋盘无视了玩家。
   *
   * 指针是否落在某格子的投影轮廓内，恰好就是"玩家正指着那个格子"的
   * 判定，而且不需要任何容差调校：棋盘是一个平面，它的 64 个轮廓
   * 无缝无重叠地铺满屏幕，指针至多只会落在其中一个里面。
   */
  private reachUnderPointer(): SquareId | null {
    if (this.selected === null || this.legalTargets.size === 0) return null;
    for (const square of this.legalTargets.keys()) {
      if (this.pointerOverSquare(square)) return square;
    }
    return null;
  }

  /** 指针是否落在这个格子自己在屏幕上的投影轮廓内？ */
  private pointerOverSquare(square: SquareId): boolean {
    const centre = squareToWorld(square, BOARD_TOP);
    const half = TILE / 2;
    let side = 0;
    for (let index = 0; index < 4; index += 1) {
      const from = this.footprintCorner(this.scratchCornerA, centre, half, index);
      const to = this.footprintCorner(this.scratchCornerB, centre, half, (index + 1) % 4);
      // 角点跑到眼睛后方会让投影失去意义，而贴得这么近的地块
      // 也不是任何人想要点击的目标。
      if (from.z > 1 || to.z > 1) return false;
      const cross =
        (to.x - from.x) * (this.pointer.y - from.y) - (to.y - from.y) * (this.pointer.x - from.x);
      const turn = Math.sign(cross);
      if (turn === 0) continue;
      if (side === 0) side = turn;
      else if (turn !== side) return false;
    }
    return true;
  }

  /** 沿周边走过的一个格子的第 `index` 个角，位于裁剪空间。 */
  private footprintCorner(
    out: THREE.Vector3,
    centre: THREE.Vector3,
    half: number,
    index: number,
  ): THREE.Vector3 {
    const step = FOOTPRINT_CORNERS[index];
    return out.set(centre.x + step[0] * half, BOARD_TOP, centre.z + step[1] * half).project(this.camera);
  }

  private squareUnderRay(): SquareId | null {
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, point)) return null;
    return worldToSquare(point.x, point.z);
  }

  private squareOf(piece: PieceView): SquareId | null {
    for (const [square, view] of this.pieces) {
      if (view === piece) return square;
    }
    return null;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.interactive) return;
    this.updatePointer(event);

    if (this.promotionGroup) {
      this.board.setHover(null);
      const kind = this.pickPromotion();
      if (kind !== this.promotionHover) {
        if (kind) audio.blip("hover");
        this.promotionHover = kind;
      }
      this.canvas.style.cursor = kind ? "pointer" : "default";
      return;
    }

    // 撤销硬币悬浮在所有东西前面，所以它要抢在棋盘之前响应指针——
    // 否则它身后的格子会夺走悬停态，玩家瞄着硬币时石板却亮了起来。
    if (this.premoveCancelUnderPointer()) {
      if (!this.premoveCancelHovered) {
        this.premoveCancelHovered = true;
        this.board.setPremoveCancelHot(true);
        audio.blip("hover");
      }
      if (this.hoveredPiece) {
        this.hoveredPiece.setHovered(false);
        this.hoveredPiece = null;
      }
      this.board.setHover(null);
      this.canvas.style.cursor = "pointer";
      return;
    }
    if (this.premoveCancelHovered) {
      this.premoveCancelHovered = false;
      this.board.setPremoveCancelHot(false);
    }

    const { square: hoveredSquare, piece } = this.pickTarget();
    const snapshot = this.controller.getSnapshot();
    // 一个棋子可触摸有两种情形：轮到你了且棋子是你的；或者机器还在走钟，
    // 而这枚棋子归你预先瞄准。
    const canTouch =
      piece !== null &&
      snapshot.status === "playing" &&
      (this.controller.isHumanTurn()
        ? piece.color === snapshot.turn
        : this.controller.canPremove() && piece.color === snapshot.playerColor);

    if (this.hoveredPiece && this.hoveredPiece !== piece) {
      this.hoveredPiece.setHovered(false);
      this.hoveredPiece = null;
    }
    if (canTouch && piece) {
      if (this.hoveredPiece !== piece) audio.blip("hover");
      piece.setHovered(true);
      this.hoveredPiece = piece;
    }

    this.board.setHover(hoveredSquare);
    this.canvas.style.cursor =
      canTouch || (this.selected && hoveredSquare !== null && this.legalTargets.has(hoveredSquare))
        ? "pointer"
        : "default";
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive || event.button !== 0) return;
    this.updatePointer(event);

    if (this.promotionGroup) {
      const kind = this.pickPromotion();
      if (kind) this.choosePromotion(kind);
      return;
    }

    // 这里只记录按下位置——整盘棋完全靠点按操作（选一个棋子，再点它的
    // 目的地），在抬手时才响应，这样一次演变成镜头旋转的按压可以被丢弃。
    const { square } = this.pickTarget();
    this.pointerDownAt = { x: event.clientX, y: event.clientY, square };
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.interactive) return;
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!down) return;

    // 发生了位移的按压是在甩动镜头，而不是点按格子，所以它绝不应该移动
    // 棋子或改变选中。手指比鼠标允许更多的偏差——在玻璃上点按总会有
    // 轻微漂移。
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > this.limits.tapSlop) return;

    this.updatePointer(event);

    // 点按硬币会撤回队尾最近一条排队着法，无论指针下还有什么。一次只撤
    // 一环：它是这条链的撤销键，不是清空键。
    if (this.premoveCancelUnderPointer()) {
      this.premoveCancelHovered = false;
      this.board.setPremoveCancelHot(false);
      audio.blip("deny");
      this.controller.popPremove();
      return;
    }

    const { square, piece } = this.pickTarget();

    if (!square) {
      this.clearSelection();
      return;
    }

    const snapshot = this.controller.getSnapshot();
    if (snapshot.status !== "playing") return;

    // 机器仍握有棋盘主导权：一次点按瞄准的是即将形成的局面，
    // 而不是石板上当前的局面。
    if (!this.controller.isHumanTurn()) {
      if (this.controller.canPremove()) this.handlePremoveTap(square, piece, snapshot);
      return;
    }

    if (this.selected && square !== this.selected) {
      if (this.legalTargets.has(square)) {
        void this.commitMove(this.selected, square);
        return;
      }
      if (piece && piece.color === snapshot.turn) this.selectWithTap(square, piece);
      else {
        void this.rejectMove(this.selected);
        this.clearSelection();
      }
      return;
    }

    if (this.selected === square) {
      this.clearSelection();
      return;
    }

    if (piece && piece.color === snapshot.turn) this.selectWithTap(square, piece);
  };

  // ---------------------------------------------------------------- 预先走子

  /**
   * 等待窗口内的一次点按：选一枚棋子、给它瞄准，或者就此作罢。
   *
   * 这里的一切都读自*推演后的*棋盘，而不是石板上的棋盘。一旦一环入队，
   * 就这个计划而言它的棋子已经在远端格子上了——所以下一环就是从那里
   * 接起的，尽管木头棋子还没有动。
   */
  private handlePremoveTap(square: SquareId, piece: PieceView | null, snapshot: GameSnapshot): void {
    const projected = this.controller.premovePieceAt(square);
    const mine = projected !== null && projected.color === snapshot.playerColor;

    if (this.premoving && this.selected) {
      if (square === this.selected) {
        this.clearSelection();
        return;
      }
      if (this.legalTargets.has(square)) {
        void this.queuePremove(this.selected, square);
        return;
      }
      if (mine) {
        this.selectPremoveWithTap(square, piece);
        return;
      }
      this.clearSelection();
      return;
    }

    // 点按某一环的起点格会收回这一环——连同它后面的所有环节，
    // 因为那些都是瞄准着一个如今永远不会出现的棋局面。
    const index = this.controller.premoveIndexFrom(square);
    if (index >= 0) {
      this.controller.truncatePremoves(index);
      return;
    }
    if (mine) this.selectPremoveWithTap(square, piece);
    else this.controller.clearPremove();
  }

  /**
   * 为一手排队着法选中棋子。点按是和普通选中相同的手势，
   * 但刻意更安静——这是一个承诺，不是一次落子。
   */
  private selectPremoveWithTap(square: SquareId, piece: PieceView | null): void {
    this.selectPremove(square);
    const projected = this.controller.premovePieceAt(square);
    if (!projected) return;
    audio.woodTap({
      // 链条深处被选起的棋子，那格上还没有它的木头实体，
      // 所以敲击声的声像按计划把它放到的位置来定。
      pan: this.stereoPan(piece ? piece.container.position : squareToWorld(square)),
      weight: WOOD_WEIGHT[projected.kind],
      volume: 0.5,
      lift: false,
    });
  }

  /**
   * 点亮一枚棋子凭几何走法可能到达的所有格子，读自它的几何形状
   * 而非当前局面——见 `GameController.premoveTargets`。
   */
  private selectPremove(square: SquareId): void {
    this.previewing = false;
    this.clearSelection();
    if (!this.controller.premovePieceAt(square)) return;
    this.selected = square;
    this.premoving = true;
    // 链条深处的那格是光秃秃的石板：棋子还站在它出发的地方，
    // 所以只能点亮格子本身。
    this.pieces.get(square)?.setSelected(true);
    this.board.setHighlight(square, "select");

    const origin = squareToWorld(square);
    const targets = this.controller
      .premoveTargets(square)
      .map((to) => ({ to, distance: squareToWorld(to).distanceTo(origin) }));
    targets.sort((a, b) => a.distance - b.distance);
    for (const target of targets) {
      this.legalTargets.set(target.to, false);
      this.board.setHighlight(target.to, "premove", false, Math.min(target.distance * 0.02, 0.14));
    }
    this.board.setShroud([square, ...targets.map((target) => target.to)], square);
    if (targets.length > 0) audio.blip("hover");
  }

  /** 把瞄准好的着法交给控制器，必要时先问要哪顶王冠。 */
  private async queuePremove(from: SquareId, to: SquareId): Promise<void> {
    const projected = this.controller.premovePieceAt(from);
    let promotion: PieceKind | undefined;
    if (this.controller.isPremovePromotion(from, to)) {
      const color = this.controller.getSnapshot().playerColor;
      this.clearSelection();
      promotion = await this.requestPromotion(color);
    }
    if (!this.controller.setPremove(from, to, promotion)) {
      // 要么是选择器开着的时候等待窗口关闭了，要么是队列已达允许的最大
      // 深度。两者殊途同归：什么都不入队，而拒绝提示音表示这次点按被
      // 听见了，而不是被吞掉了。
      audio.blip("deny");
      this.clearSelection();
      return;
    }
    if (!projected) return;
    const piece = this.pieces.get(from);
    audio.woodTap({
      pan: this.stereoPan(piece ? piece.container.position : squareToWorld(from)),
      weight: WOOD_WEIGHT[projected.kind],
      volume: 0.42,
      lift: false,
    });
    // 光凭敲击声只说了"有棋子被碰到"，而拿起一枚棋子也是这个声音。
    // 真正说出*它已入队*的是这个音符——而且它随环节沿音阶上行，
    // 让人能听见一条链正在被搭建。声像定在计划*落点*的位置，
    // 而不是木头所在的位置：标记刚刚出现在那里。
    audio.premoveChime({
      pan: this.stereoPan(squareToWorld(to)),
      index: this.controller.getPremoves().length - 1,
    });
  }

  /** 指针是否悬在某条排队着法的撤销硬币上？ */
  private premoveCancelUnderPointer(): boolean {
    const handle = this.board.premoveCancelHandle();
    if (!handle) return false;
    return this.raycaster.intersectObject(handle, false).length > 0;
  }

  /** 控制器的队列变了：重绘这条链。 */
  private onPremoveChanged(premoves: { from: SquareId; to: SquareId }[]): void {
    this.premoveChain = premoves.map((move) => ({ from: move.from, to: move.to }));
    if (premoves.length === 0) {
      this.premoveCancelHovered = false;
      this.board.setPremoveCancelHot(false);
    }
    this.clearSelection();
  }

  /**
   * 把排队中的着法（如果有）点亮，叠加在环境标记之上。
   *
   * 两端刻意*不*做同样的装饰。起点上本来就站着一枚棋子，足以自明；
   * 终点是光秃秃的石板，才是玩家真正需要回读的那一半，所以它得到
   * 明亮的括弧边框，而起点只留下一个暗淡的空心圆环。同一族锡镴色，
   * 但显然只有一头是箭尖。
   */
  private applyPremoveHighlight(): void {
    this.board.setPremoveLinks(this.premoveChain);
    // 哪一格是*第三步*无法从标记上读出来：圆环全都一样，丝线互相交错。
    // 序号数字落在目的地上，所以它们的阅读顺序就是着法将要执行的顺序。
    this.board.setPremoveOrders(this.premoveChain.map((link) => link.to));
    const last = this.premoveChain.length > 0 ? this.premoveChain[this.premoveChain.length - 1] : null;
    // 撤销硬币只在还有着法等待时才有意义，而且它悬在链的*末端*上方，
    // 因为它收回的正是那一环。
    this.board.setPremoveCancel(last ? last.to : null);
    if (!last) return;
    // 一条链是一支箭，不是一堆箭：每个途经点都保留暗淡的空心圆环，
    // 只有计划落脚的那格得到明亮的箭头。
    for (const link of this.premoveChain) {
      this.board.setHighlight(link.from, "queued", false);
      if (link !== last) this.board.setHighlight(link.to, "queued", false);
    }
    this.board.setHighlight(last.to, "queuedTarget", true);
  }

  /**
   * 对方的应着让排队中的着法变得无法执行。两个格子上闪一拍短促的红光，
   * 队列就此消失——玩家刚亲眼看着杀死它的那步棋落下，所以没有什么要
   * 解释的，也没有什么要撤销的。
   *
   * 将军是例外。王所在的那格已经在跳红光，横幅也已经升起；两处红光
   * 同时出现就是一件事发了两条消息，而更响的那条不属于队列。所以
   * 因将军而失效的链条只带着音效和震颤离场，棋盘把将军留给自己表达。
   */
  private async flashPremoveLost(
    from: SquareId,
    to: SquareId,
    dropped: number,
    reason: "illegal" | "check",
  ): Promise<void> {
    this.premoveChain = [];
    this.board.setPremoveCancel(null);
    this.board.setPremoveOrders([]);
    // 整个计划覆灭，理应得到比一步棋更强烈的一拍。
    if (dropped > 1) this.shake.tremor(0.09, 0.4);
    this.premoveCancelHovered = false;
    audio.blip("deny");
    if (reason === "check") {
      this.restoreBaseHighlights();
      return;
    }
    this.board.setHighlight(from, "capture", true);
    this.board.setHighlight(to, "capture", true);
    await wait(0.55);
    if (this.disposed) return;
    this.restoreBaseHighlights();
  }

  /** 点按选中：棋子伴着一声干脆的木质感嗒声立正。 */
  private selectWithTap(square: SquareId, piece: PieceView): void {
    this.select(square);
    audio.woodTap({
      pan: this.stereoPan(piece.container.position),
      weight: WOOD_WEIGHT[piece.kind],
      volume: 0.8,
      lift: true,
    });
  }

  private async commitMove(from: SquareId, to: SquareId): Promise<void> {
    let promotion: PieceKind | undefined;
    if (this.controller.isPromotion(from, to)) {
      const color = this.controller.getSnapshot().turn;
      this.clearSelection();
      promotion = await this.requestPromotion(color);
    }
    const ok = await this.controller.tryMove(from, to, promotion);
    if (!ok) void this.rejectMove(from);
  }

  private select(square: SquareId): void {
    this.previewing = false;
    this.clearSelection();
    const piece = this.pieces.get(square);
    if (!piece) return;
    this.selected = square;
    piece.setSelected(true);
    this.board.setHighlight(square, "select");

    // 合法格从棋子处向外泛起涟漪，让这扇形的选择面读起来是一个动作，
    // 而不是 20 个标记同时闪烁亮起。
    const origin = squareToWorld(square);
    const targets = this.controller.legalTargets(square).map((target) => ({
      ...target,
      distance: squareToWorld(target.to).distanceTo(origin),
    }));
    targets.sort((a, b) => a.distance - b.distance);
    for (const target of targets) {
      this.legalTargets.set(target.to, target.capture);
      const delay = Math.min(target.distance * 0.02, 0.14);
      // 按走子类型配色：红色代表吃子，紫罗兰色代表升变，
      // 天青色代表王车易位，翠绿色代表安静的前进。
      const kind: HighlightKind = target.capture
        ? "capture"
        : target.promotion
          ? "promote"
          : target.castle
            ? "castle"
            : "move";
      this.board.setHighlight(target.to, kind, target.capture || target.promotion, delay);
    }

    // 棋子到不了的一切地方都沉入阴影，这样即使几个亮格共用一种颜色，
    // 它们也绝不会认错。
    this.board.setShroud([square, ...targets.map((target) => target.to)], square);
    if (targets.length > 0) audio.blip("hover");
  }

  private clearSelection(): void {
    if (this.selected) {
      const piece = this.pieces.get(this.selected);
      piece?.setSelected(false);
    }
    this.selected = null;
    this.legalTargets.clear();
    this.previewing = false;
    this.premoving = false;
    this.board.setShroud(null);
    this.restoreBaseHighlights();
  }

  /** 重新点亮环境标记（上一步、将军、排队着法）。 */
  private restoreBaseHighlights(): void {
    this.board.clearHighlights();
    const snapshot = this.controller.getSnapshot();
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
    this.applyPremoveHighlight();
  }

  /**
   * 点亮从着法记录里挑出的那步棋的两个格子。有棋子被选中时忽略，
   * 以免与合法走子标记打架。
   */
  previewMove(move: { from: SquareId; to: SquareId } | null): void {
    if (this.selected) return;
    if (!move) {
      if (!this.previewing) return;
      this.previewing = false;
      this.restoreBaseHighlights();
      return;
    }
    this.board.clearHighlights();
    this.board.setHighlight(move.from, "hint", true);
    this.board.setHighlight(move.to, "hint", true);
    this.previewing = true;
  }

  private applyCheckHighlight(snapshot: GameSnapshot): void {
    for (const piece of this.pieces.values()) piece.setAlarm(0);
    const threatened = this.threatenedKing(snapshot);
    // 警报由*状态*驱动，而不是由引发它的那步棋驱动，所以在悔棋、
    // 重建或对局中切换画质之后它依然正确——而且王走出将军时它总会
    // 自动解除。
    this.alarm.setThreat(threatened ? squareToWorld(threatened.square) : null);
    if (!threatened) return;
    threatened.piece.setAlarm(1);
    this.board.setHighlight(threatened.square, "check", true);
  }

  /** 当前被将军的王（如果棋局还在进行中）。 */
  private threatenedKing(snapshot: GameSnapshot): { square: SquareId; piece: PieceView } | null {
    if (!snapshot.inCheck || snapshot.status !== "playing") return null;
    for (const [square, piece] of this.pieces) {
      if (piece.kind === "k" && piece.color === snapshot.turn) return { square, piece };
    }
    return null;
  }

  private onState(snapshot: GameSnapshot): void {
    this.applyCheckHighlight(snapshot);
    const intensity = snapshot.inCheck ? 1 : snapshot.captured.length >= 12 ? 0.6 : 0;
    audio.setIntensity(intensity);
  }

  // ------------------------------------------------------------------ 选项

  /**
   * 切换棋盘所在的地图场景。每个子系统原地重绘——不重建任何几何体——
   * 所以即使在对局中切换也能在一帧内完成，只有反射探针会重新生成。
   */
  setArena(theme: ArenaTheme): void {
    if (theme === this.arena) return;
    this.arena = theme;
    const look = ARENA_LOOKS[theme];

    this.applyExposure(look.exposure);
    (this.scene.background as THREE.Color).setHex(look.background);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.setHex(look.fog.color);
      fog.density = look.fog.density;
    }

    this.hall.applyArena(look);
    this.battlefield.applyArena(look);
    this.jungle.applyArena(look);
    this.board.applyArena(look);
    this.postfx.setGrade(look.grade);
    this.postfx.setBloom(look.bloom);

    this.cameraLamp.color.setHex(look.lamp.color);
    this.cameraLamp.intensity = look.lamp.intensity;

    // 对着新的布景重新摆好突刺场景，然后把虚空放回去。
    if (this.tactical) {
      this.restoreWorld();
      this.strikeWorld();
      this.applyTacticalAtmosphere();
    }

    this.applyEnvironment();
  }

  /** 当前布景所用的地图。 */
  getArena(): ArenaTheme {
    return this.arena;
  }

  setQuality(preset: QualityPreset): void {
    if (preset === this.preset) return;
    this.preset = preset;
    const settings = QUALITY_SETTINGS[preset];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    this.renderer.shadowMap.enabled = settings.shadows && !this.safeMode;
    this.hall.applyQuality(preset);
    this.battlefield.applyQuality(preset);
    this.jungle.applyQuality(preset);
    this.postfx.setPreset(preset);
    this.handleResize();
    // 在交战正酣时重建棋子会拆掉那些正在行军、攻击或倒下的棋子，
    // 把它们的节奏拦腰截断，所以自动降级（通常正是*因为*屏幕上正在
    // 交战才触发）会等棋盘安静下来再执行。重建随后从 `animateMove`
    // 里触发。
    if (this.movesInFlight > 0) this.rebuildPending = true;
    else this.rebuildPieces();
    if (this.tactical) {
      this.restoreWorld();
      this.strikeWorld();
    }
  }

  /**
   * 安全渲染模式。关掉三样在 Linux/Mesa 驱动上被观察到会把场景渲染成
   * 全黑的东西——后期处理合成器、反射探针和阴影贴图——并略微提升
   * 曝光以补偿损失的环境光。完全可逆。
   */
  setSafeMode(active: boolean): void {
    if (this.safeMode === active) return;
    this.safeMode = active;
    this.postfx.setBypassed(active);
    this.renderer.shadowMap.enabled = !active && QUALITY_SETTINGS[this.preset].shadows;
    // 从未测试过的探针，在手动关闭安全模式时值得再给一次机会；
    // 自检失败过的探针则保持关闭。
    this.applyEnvironment();
    this.applyExposure();
    this.refreshMaterials();
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  /** 玩家侧曝光倍率（0.6–1.8），为看起来太暗的屏幕准备。 */
  setBrightness(value: number): void {
    const clamped = Math.min(1.8, Math.max(0.6, value));
    if (Math.abs(clamped - this.brightness) < 0.001) return;
    this.brightness = clamped;
    this.applyExposure();
  }

  /** 一行标明驱动的文字，供设置面板和缺陷报告使用。 */
  getGpuSummary(): string {
    return describeGpu(this.gpu);
  }

  /**
   * 为一方或双方召集一支不同的军队。雕塑必须重新下载，所以换装在后台
   * 进行：正在进行的节奏允许走完，每个站立的棋子先撤下（它的几何体
   * 属于即将被释放的模板），新军队名单加载完毕，再把棋盘重新立起来。
   * 换装过程中到达的新请求会替换掉挂起的旧请求。
   */
  setArmySkins(skins: Record<Faction, ArmySkinId>): void {
    this.wantedSkins = { w: skins.w, b: skins.b };
    void this.syncArmies();
  }

  /** 双方当前正在召集的军队。 */
  getArmySkins(): Record<Faction, ArmySkinId> {
    return this.factory.getSkins();
  }

  private async syncArmies(): Promise<void> {
    if (this.swappingArmies) return;
    this.swappingArmies = true;
    try {
      while (!this.disposed) {
        const wanted = this.wantedSkins;
        this.wantedSkins = null;
        if (!wanted || !this.factory.setSkins(wanted)) break;

        // 行军到一半的棋子手里还握着即将被释放的雕塑，
        // 所以先让屏幕上的战斗打完。
        while (this.movesInFlight > 0 && !this.disposed) await wait(0.1);
        if (this.disposed) return;

        // 先标记为过时，这样重建时只会拆掉旧军队。
        this.factory.markStale();
        this.rebuildPieces();
        try {
          await this.factory.reload();
        } catch (error) {
          console.warn("[scene] 无法召集新军队", error);
        }
        if (this.disposed) return;
        this.rebuildPieces();
        const skins = this.factory.getSkins();
        audio.setArmyCries({ w: ARMY_SKINS[skins.w].cries, b: ARMY_SKINS[skins.b].cries });
        void this.factory.warmClips();
      }
    } finally {
      this.swappingArmies = false;
    }
  }

  /** 从棋局核心重建每个棋子（用于悔棋之后）。 */
  resync(): void {
    this.rebuildPieces();
    const snapshot = this.controller.getSnapshot();
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
  }

  setCaptureCinematics(enabled: boolean): void {
    this.captureCinematics = enabled;
  }

  setRotateBoard(enabled: boolean): void {
    this.rotateBoard = enabled;
  }

  /** 悬浮在棋盘上每个棋子上方的兵种纹章。 */
  setRankBadges(enabled: boolean): void {
    if (this.rankBadges === enabled) return;
    this.rankBadges = enabled;
    for (const piece of this.pieces.values()) piece.setBadgeEnabled(enabled);
    for (const piece of this.motion) piece.setBadgeEnabled(enabled);
    for (const piece of this.captured) piece.setBadgeEnabled(enabled);
  }

  /**
   * 人机对战的观演模式。
   *
   * 观众在这里永远只是观看，所以画面按"读盘"而不是"氛围"来调校：
   * 完全关闭景深（那层柔焦曾把整座大厅都糊掉），颗粒、暗角和泛光
   * 全部收敛，并用一个固定的取景取代持续环绕。镜头行为由观众
   * 自己选择——见 {@link ShowcaseCamera}。
   */
  setShowcase(active: boolean, camera: ShowcaseCamera = "follow", orbitSpeed = 0.32): void {
    const changed = this.showcase !== active;
    this.showcase = active;
    this.showcaseOrbitSpeed = orbitSpeed;
    this.showcaseCamera = camera;
    // 观演是用来看的，不是眯着眼睛猜的：保持锐利。
    this.postfx.setCinematic(false);
    this.postfx.setClarity(active);
    if (!active) {
      this.controls.autoRotate = false;
      this.focusPoint(null);
      return;
    }
    if (camera !== "orbit") this.controls.autoRotate = false;
    if (changed && !this.tactical) {
      this.followedFocus.copy(BOARD_FOCUS);
      this.framedShot = SHOWCASE_SHOT;
      const framing = this.framingFor(SHOWCASE_SHOT);
      this.adoptFraming(framing);
      void this.moveCameraTo(framing, 1.4);
    }
  }

  /** 在固定机位、环绕和跟随之间切换观演镜头。 */
  setShowcaseCamera(camera: ShowcaseCamera): void {
    if (this.showcaseCamera === camera) return;
    this.showcaseCamera = camera;
    if (camera !== "orbit") this.controls.autoRotate = false;
    if (camera === "follow") {
      // 从画面当前所在的位置开始跟随。
      this.captureFollowRig();
      this.followedFocus.copy(this.controls.target);
    }
  }

  /** 当前生效的观演镜头行为。 */
  getShowcaseCamera(): ShowcaseCamera {
    return this.showcaseCamera;
  }

  setAttract(active: boolean): void {
    this.attract = active;
    this.postfx.setCinematic(false);
    this.postfx.setClarity(active || this.showcase);
    if (active) {
      this.controls.enabled = false;
      this.framedShot = CAMERA_SHOTS.cinematic;
      const framing = this.framingFor(CAMERA_SHOTS.cinematic);
      this.adoptFraming(framing);
      void this.moveCameraTo(framing, 2);
    } else {
      this.controls.enabled = this.interactive;
    }
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.controls.enabled = interactive && !this.introPlaying && !this.attract;
    if (!interactive) {
      this.clearSelection();
      this.hoveredPiece?.setHovered(false);
      this.hoveredPiece = null;
    }
  }

  handleResize = (): void => {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height);
    this.applyViewport(width, height);
  };

  // ------------------------------------------------------------- 屏幕适配

  /**
   * 为屏幕上实际的显示面重新求解取景：镜头、轨道限制，以及——当屏幕的
   * *形状*而不仅仅是尺寸变化时——镜头画面本身。
   *
   * 浏览器工具栏滑走只会让高度变化几个百分点，为此让镜头重新飞一遍会
   * 和玩家自己的缩放打架，所以只有当宽高比真正改变时（旋转屏幕、手机/
   * 桌面切换、拖动窗口）才重新求解镜头画面。
   */
  private applyViewport(width: number, height: number): void {
    const previous = this.view;
    this.view = readViewport(width, height);
    const reshaped =
      !this.viewportFitted ||
      previous.portrait !== this.view.portrait ||
      previous.handheld !== this.view.handheld ||
      Math.abs(previous.aspect - this.view.aspect) > 0.06;

    const framing = this.framingFor(this.framedShot);
    this.adoptFraming(framing);
    if (!reshaped) return;

    const first = !this.viewportFitted;
    this.viewportFitted = true;
    this.reframeCamera(framing, first ? 0 : 0.7);
  }

  /** 为当前实时视口求解一个手工设计的镜头画面。 */
  private framingFor(shot: CameraShot): Framing {
    const base = this.tactical ? TACTICAL_FOV : DEFAULT_FOV;
    return frameShot(shot.position, shot.target, this.view, {
      fov: base,
      maxFov: lensCeiling(this.view, base),
      // 俯视地图是从正上方读的，所以可以向外爬升得更远。
      maxDistance: this.tactical ? 30 : 19,
    });
  }

  /** 采用某个取景的镜头与取景范围，但不移动镜头。 */
  private adoptFraming(framing: Framing): void {
    this.lensFov = framing.fov;
    this.fitRadius = framing.radius;
    this.camera.fov = framing.fov;
    this.camera.updateProjectionMatrix();
    this.applyOrbitLimits();
  }

  private applyOrbitLimits(): void {
    this.limits = orbitLimits(this.view, this.fitRadius);
    this.controls.rotateSpeed = this.limits.rotateSpeed;
    this.controls.minPolarAngle = this.limits.minPolarAngle;
    this.controls.maxPolarAngle = this.limits.maxPolarAngle;
    if (this.tactical) {
      this.controls.minDistance = Math.min(11, this.fitRadius * 0.62);
      this.controls.maxDistance = Math.max(34, this.fitRadius * 1.5);
      return;
    }
    this.controls.minDistance = this.limits.minDistance;
    this.controls.maxDistance = this.limits.maxDistance;
  }

  /**
   * 把镜头放到求解好的取景上，同时保持玩家正在观看的棋盘一侧——
   * 旋转是重新构图棋盘，绝不会把棋盘转过来。
   */
  private reframeCamera(framing: Framing, duration: number): void {
    if (this.introPlaying || this.cameraScripted) return;
    const current = new THREE.Spherical().setFromVector3(
      this.scratchDesired.copy(this.camera.position).sub(this.controls.target),
    );
    const wanted = new THREE.Spherical().setFromVector3(framing.position.clone().sub(framing.target));
    if (current.radius > 1e-3) wanted.theta = current.theta;
    wanted.makeSafe();
    const position = new THREE.Vector3().setFromSpherical(wanted).add(framing.target);
    if (duration <= 0) {
      this.camera.position.copy(position);
      this.controls.target.copy(framing.target);
      this.captureFollowRig();
      return;
    }
    void this.moveCameraTo({ position, target: framing.target.clone() }, duration);
  }

  /**
   * 镜头永远不允许跑出大厅。
   *
   * 轨道控制器只能分别限制角度和距离，所以一个需要站得更远的取景——
   * 而这正是窄屏所需要的——会让镜头径直穿过半径 12.5 的柱廊跑到外面，
   * 最后柱子和幕墙反而挡在棋盘前面。在这里，每一帧都把越过柱子的
   * 水平距离换算成高度，让视角从大厅上方爬过去，而不是倒退着穿墙。
   */
  private confineCamera(): void {
    // 开场动画是故意从城墙外飞进来的。
    if (this.introPlaying || this.cameraScripted) return;
    const ground = Math.hypot(this.camera.position.x, this.camera.position.z);
    if (ground <= HALL_INNER_RADIUS) return;
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    const scale = HALL_INNER_RADIUS / ground;
    this.camera.position.x *= scale;
    this.camera.position.z *= scale;
    const flat = Math.hypot(this.camera.position.x - target.x, this.camera.position.z - target.z);
    // 按拉远的等价值向上爬升，这样取景保持原有大小。
    this.camera.position.y = target.y + Math.sqrt(Math.max(0.25, distance * distance - flat * flat));
  }

  private onManualCamera = (): void => {
    this.lastManualCameraAt = this.elapsed;
  };

  /** 阻尼会在拖拽后继续触发 `change`；只统计真实的用户输入。 */
  private onManualCameraChange = (): void => {
    if (this.controls.autoRotate || this.orbiting || this.cameraDriven || this.cameraScripted) return;
    this.lastManualCameraAt = this.elapsed;
  };

  /** 观众刚选好的角度与距离，就此成为跟随骨骼的基准。 */
  private onManualCameraEnd = (): void => {
    this.captureFollowRig();
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.callbacks.onContextLost();
  };

  private onContextRestored = (): void => {
    this.postfx.setPreset(this.preset);
    this.handleResize();
    this.start();
  };

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.tweens.cancelAll();
    this.controller.setAnimator(null);
    this.controls.removeEventListener("start", this.onManualCamera);
    this.controls.removeEventListener("change", this.onManualCameraChange);
    this.controls.removeEventListener("end", this.onManualCameraEnd);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("resize", this.handleResize);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.closePromotionPicker();
    for (const piece of this.pieces.values()) piece.dispose();
    for (const piece of this.captured) piece.dispose();
    this.pieces.clear();
    this.captured = [];
    this.effects.dispose();
    this.alarm.dispose();
    this.spellLights.dispose();
    disposeStrikeAssets();
    disposeGunAssets();
    disposeShatterAssets();
    this.board.dispose();
    this.hall.dispose();
    this.battlefield.dispose();
    this.jungle.dispose();
    this.factory.dispose();
    this.environmentMap?.dispose();
    this.environmentMap = null;
    this.scene.environment = null;
    this.postfx.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
