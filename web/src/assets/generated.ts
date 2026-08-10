/**
 * 游戏所用 AI 生成资产的 URL 清单。
 * 模型由 GLTFLoader 直接从 R2 加载；音频由 Web Audio 混音器解码。
 * 换成更高质量的 glTF 角色只需每处条目改一行（见 README）。
 */

import type { Faction, PieceKind } from "../core/types";
import type { ArmSculptSource } from "../scene/armoury";
import type { ShotModelSource } from "../scene/gunfire";
import type { WeaponId } from "../scene/weapons";

const MODEL_BASE = "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd";

/**
 * 一支军队的雕塑。每款皮肤都是一整个文明，配有自己专属的六棋子阵容；
 * 缺失的条目会回退到对方军队的雕塑，再不行就回退到程序化生成的棋子，
 * 因此棋盘上永远会被填满。
 */
type Roster<T> = Partial<Record<PieceKind, T>>;

/**
 * 为某款皮肤的棋子配发哪个武器家族。棋子永远是空手生成的
 * （手持道具会破坏自动绑骨），所以武器是作为独立对象
 * 挂到手部骨骼上的——用 `scene/weapons.ts` 中的几何体拼装，
 * 大军团（Grande Armée）则使用真实武器的生成为雕塑
 * （见 {@link ARM_SCULPTS}）。
 */
export type ArsenalId = "kingdom" | "sun" | "empire";

/** 可选的军队皮肤。棋盘两侧可以穿戴其中任意一款。 */
export type ArmySkinId = "ivory" | "sun" | "empire";

/** 每种棋子的静态（未绑骨）雕塑——骨骼加载失败时的回退方案。 */
const STILL_MODELS: Record<ArmySkinId, Roster<string>> = {
  ivory: {
    k: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8.glb`,
    q: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886.glb`,
    b: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72.glb`,
    n: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2.glb`,
    r: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1.glb`,
    p: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69.glb`,
  },
  // 太阳帝国：皇帝、大祭司、蛇祭司、美洲豹武士、
  // 神殿守卫与鹰武士步卒。
  sun: {
    k: `${MODEL_BASE}/ad5cfb3c-4fbc-4952-a1f1-b1d4a684b2e7.glb`,
    q: `${MODEL_BASE}/d39273ce-17e5-41df-a7f5-634f944e3467.glb`,
    b: `${MODEL_BASE}/7066c2da-f466-438b-ab74-f2a45b2a0ddb.glb`,
    n: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c.glb`,
    r: `${MODEL_BASE}/c044d8e8-28fd-4aa9-af00-d58ca49fedee.glb`,
    p: `${MODEL_BASE}/2cd10f02-711f-4e51-8b32-1d6603e7cc3f.glb`,
  },
  // 大军团：拿破仑、佩马伦戈剑的帝国统帅、
  // 胸甲骑兵勇士、炮兵卫士与线列步兵。
  empire: {
    k: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8.glb`,
    q: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952.glb`,
    b: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c.glb`,
    n: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1.glb`,
    r: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2.glb`,
    p: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e.glb`,
  },
};

/**
 * 绑骨（蒙皮）雕塑及其骨骼动画剪辑。上面的普通 GLB 没有骨骼，
 * 所以要让棋子动起来，必须渲染绑骨变体，
 * 并在绑定到它的混合器上播放这些剪辑。此处缺失的棋子种类
 * 会回退到静态 GLB 加程序化待机动画。
 */
export interface PieceAnimationSet {
  /** 绑骨 GLB——动画棋子的视觉呈现。 */
  rigged: string;
  /** 循环播放的战斗姿态。 */
  idle?: string;
  /** 该棋子吃子时播放的单次攻击动作。 */
  attack?: string;
  /** 该棋子被吃时播放的单次阵亡动作。 */
  death?: string;
  /**
   * 棋子走向目标格时循环播放的原地步态。
   * 仅限原地变体：棋盘位移由容器补间驱动，
   * 携带根位移的剪辑会让行进距离翻倍。
   */
  walk?: string;
  /** 循环播放的原地奔跑——骑士跃击时的冲锋。 */
  run?: string;
  /**
   * 射击后播放的单次装填操练：倒药、填弹、通条。
   * 只有火药军队携带此剪辑——剑士没有东西可装填。
   */
  reload?: string;
  /**
   * 射击前保持的循环瞄准姿态：手臂抬起、枪管抵住身体、
   * 头部沿枪管瞄视。只有火药军队携带此剪辑——
   * 它让远距离击杀读起来像一次瞄准射击。
   */
  aim?: string;
  /**
   * 跪姿与站姿之间切换的单次动作：剪辑以单膝跪地开始、
   * 以完全站立结束。只有跪姿作战的棋子需要它，而且它会向
   * *两个*方向播放——正向用于射击结束后从跪姿起身，
   * 反向用于最初跪下去（见 `PieceView.playKneel`）。
   * 一次下载、两种动作，而且他起身离开的那个跪姿，
   * 按构造就是当初跪入的那个跪姿。
   */
  rise?: string;
}

const ANIMATED_MODELS: Record<ArmySkinId, Roster<PieceAnimationSet>> = {
  ivory: {
  // 王冠保持全高站立，以裁决者的姿态而非斗殴者的姿态示人。
  k: {
    rigged: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-rigged.glb`,
    idle: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-idle.glb`,
    attack: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-sword-judgment.glb`,
    death: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-dead.glb`,
    // 朴实挺直的步态：T 台式的阔步在国王身上读作趾高气昂，
    // 所以王冠现在正常行走，威仪由 GAITS 里的缓慢步频提供。
    // 同一骨骼上的备选：
    // `...-anim-spear-walk-inplace.glb`（持械在前的行军）。
    walk: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-casual-walk-inplace.glb`,
  },
  q: {
    rigged: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-rigged.glb`,
    idle: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-idle.glb`,
    attack: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-charged-spell-cast.glb`,
    death: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-dying-backwards.glb`,
    // 自然的步态取代了旧的红毯步——交叉步和扭胯
    // 在战裙之下看起来都不对劲。
    // 备选：`...-anim-spear-walk-inplace.glb`。
    walk: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-casual-walk-inplace.glb`,
  },
  b: {
    rigged: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-rigged.glb`,
    idle: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-sword-judgment.glb`,
    death: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-dead.glb`,
    walk: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-spear-walk-inplace.glb`,
  },
  n: {
    rigged: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-rigged.glb`,
    idle: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-charged-slash.glb`,
    death: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-dying-backwards.glb`,
    walk: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-confident-strut-inplace.glb`,
    // 贯穿整个跳跃过程，因此骑手是在冲锋而非漂浮。
    run: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-standard-forward-charge-inplace.glb`,
  },
  r: {
    rigged: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-rigged.glb`,
    idle: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-heavy-hammer-swing.glb`,
    death: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-knock-down.glb`,
    // 全身板甲：以卫戍的缓慢步频播放普通步态，读作沉重的踏行；
    // 而驼背的兽人走姿会读作一头怪物。
    // 备选：`...-anim-carry-heavy-object-walk-inplace.glb`（负重跋涉）。
    walk: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-casual-walk-inplace.glb`,
  },
  p: {
    rigged: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-rigged.glb`,
    idle: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-thrust-slash.glb`,
    death: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-knock-down.glb`,
    walk: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-spear-walk-inplace.glb`,
  },
  },
  sun: {
    k: {
      rigged: `${MODEL_BASE}/ad5cfb3c-4fbc-4952-a1f1-b1d4a684b2e7-rigged.glb`,
      idle: `${MODEL_BASE}/ad5cfb3c-4fbc-4952-a1f1-b1d4a684b2e7-anim-idle.glb`,
      attack: `${MODEL_BASE}/ad5cfb3c-4fbc-4952-a1f1-b1d4a684b2e7-anim-sword-judgment.glb`,
      death: `${MODEL_BASE}/ad5cfb3c-4fbc-4952-a1f1-b1d4a684b2e7-anim-dead.glb`,
      // 与白曜国王同理：挺直自然的步态，不要 T 台扭摆。
      // 备选：`...-anim-spear-walk-inplace.glb`。
      walk: `${MODEL_BASE}/ad5cfb3c-4fbc-4952-a1f1-b1d4a684b2e7-anim-casual-walk-inplace.glb`,
    },
    q: {
      rigged: `${MODEL_BASE}/d39273ce-17e5-41df-a7f5-634f944e3467-rigged.glb`,
      idle: `${MODEL_BASE}/d39273ce-17e5-41df-a7f5-634f944e3467-anim-idle.glb`,
      attack: `${MODEL_BASE}/d39273ce-17e5-41df-a7f5-634f944e3467-anim-charged-spell-cast.glb`,
      death: `${MODEL_BASE}/d39273ce-17e5-41df-a7f5-634f944e3467-anim-dying-backwards.glb`,
      // 备选：`...-anim-spear-walk-inplace.glb`。
      walk: `${MODEL_BASE}/d39273ce-17e5-41df-a7f5-634f944e3467-anim-casual-walk-inplace.glb`,
    },
    b: {
      rigged: `${MODEL_BASE}/7066c2da-f466-438b-ab74-f2a45b2a0ddb-rigged.glb`,
      idle: `${MODEL_BASE}/7066c2da-f466-438b-ab74-f2a45b2a0ddb-anim-combat-stance.glb`,
      attack: `${MODEL_BASE}/7066c2da-f466-438b-ab74-f2a45b2a0ddb-anim-sword-judgment.glb`,
      death: `${MODEL_BASE}/7066c2da-f466-438b-ab74-f2a45b2a0ddb-anim-dead.glb`,
      walk: `${MODEL_BASE}/7066c2da-f466-438b-ab74-f2a45b2a0ddb-anim-spear-walk-inplace.glb`,
    },
    n: {
      rigged: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c-rigged.glb`,
      idle: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c-anim-combat-stance.glb`,
      attack: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c-anim-charged-slash.glb`,
      death: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c-anim-dying-backwards.glb`,
      // 白曜骑士正步行进之处，美洲豹武士则潜行逼近。
      walk: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c-anim-sneaky-walk-inplace.glb`,
      run: `${MODEL_BASE}/a5ff70a9-b2e7-40e0-b7bc-ea4fe0ba6d5c-anim-standard-forward-charge-inplace.glb`,
    },
    r: {
      rigged: `${MODEL_BASE}/c044d8e8-28fd-4aa9-af00-d58ca49fedee-rigged.glb`,
      idle: `${MODEL_BASE}/c044d8e8-28fd-4aa9-af00-d58ca49fedee-anim-combat-stance.glb`,
      attack: `${MODEL_BASE}/c044d8e8-28fd-4aa9-af00-d58ca49fedee-anim-heavy-hammer-swing.glb`,
      death: `${MODEL_BASE}/c044d8e8-28fd-4aa9-af00-d58ca49fedee-anim-knock-down.glb`,
      // 备选：`...-anim-carry-heavy-object-walk-inplace.glb`。
      walk: `${MODEL_BASE}/c044d8e8-28fd-4aa9-af00-d58ca49fedee-anim-casual-walk-inplace.glb`,
    },
    p: {
      rigged: `${MODEL_BASE}/2cd10f02-711f-4e51-8b32-1d6603e7cc3f-rigged.glb`,
      idle: `${MODEL_BASE}/2cd10f02-711f-4e51-8b32-1d6603e7cc3f-anim-combat-stance.glb`,
      attack: `${MODEL_BASE}/2cd10f02-711f-4e51-8b32-1d6603e7cc3f-anim-thrust-slash.glb`,
      death: `${MODEL_BASE}/2cd10f02-711f-4e51-8b32-1d6603e7cc3f-anim-knock-down.glb`,
      walk: `${MODEL_BASE}/2cd10f02-711f-4e51-8b32-1d6603e7cc3f-anim-spear-walk-inplace.glb`,
    },
  },
  empire: {
    // 皇帝从不斗殴，也从不近身：大衣敞开、燧发枪抬起，
    // 事情在他立足之处就地了结。
    // 同一骨骼上的备选：`...-anim-sword-judgment.glb`（礼服佩剑）。
    k: {
      rigged: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8-rigged.glb`,
      idle: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8-anim-idle.glb`,
      // 大衣敞开，手枪先端平锁定目标，然后才触碰扳机——
      // 正是这段保持姿态读起来像瞄准。
      aim: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8-anim-archery-aim-with-lateral-scan.glb`,
      attack: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8-anim-cowboy-quick-draw-shooting.glb`,
      death: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8-anim-dead.glb`,
      walk: `${MODEL_BASE}/b533d4ac-cac7-47f2-887d-8b90ee8626a8-anim-casual-walk-inplace.glb`,
      // 没有装填操练：与军中其他所有枪管不同，这套骨骼在服务器上
      // 没有装填剪辑（`-anim-standing-reload.glb` 和
      // `-anim-kneeling-reload.glb` 都是 404）。硬写一个上去会让
      // 皇帝的每次射击在节拍继续前都多一次无效下载，所以皇帝干脆
      // 直接垂下手枪——`playReload` 返回 0，战斗跳过这一拍。
      // 想让他有装填动作，需在这套骨骼上重新生成一个。
    },
    // 统帅在远处作战，但靠的是火药而非巫术：
    // 马伦戈剑留在左手，燧发枪才是干活的家伙。
    //   * aim     ——手枪抬起，锁定棋盘对面的人
    //   * strike  ——自肩侧拔枪即射，保持全高站姿
    //   * reload  ——重新装药填弹，全程站立
    // 同一骨骼上的备选：`...-anim-charged-spell-cast.glb`（旧的女巫
    // 施法动作，留着以备宫廷哪天想回到巫火时代）。
    q: {
      rigged: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-rigged.glb`,
      idle: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-anim-idle.glb`,
      aim: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-anim-archery-aim-with-lateral-scan.glb`,
      attack: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-anim-cowboy-quick-draw-shooting.glb`,
      death: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-anim-dying-backwards.glb`,
      walk: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-anim-casual-walk-inplace.glb`,
      reload: `${MODEL_BASE}/a152280e-7af7-4e3e-846e-b20e8f8c2952-anim-standing-reload.glb`,
    },
    // 帝国的神射手。他不持法杖也不施法：步枪抬起、单膝跪地，
    // 就在那里完成射击。
    //   * stance  ——回合之间持枪戒备站立，枪口压低，注视棋盘。
    //     他过去会*整场对局都单膝跪着*等，读作一个永远躲在
    //     掩体后的人；跪姿只有在他开火的那一刻出现才有意义。
    //   * rise    ——膝盖落下与起身，围绕射击先反向再正向播放
    //     （见 {@link PieceAnimationSet.rise}）
    //   * aim     ——跪姿保持：步枪抬起、头部贴上瞄具、扫视棋盘
    //     对面的身影。这是他*开火时*的姿态：跪姿射击根本没有
    //     独立的 attack 剪辑（见下）。
    //   * stride  ——推进时步枪横持于身前
    //   * reload  ——装药填弹，仍跪在他开火的那条膝上；等目标
    //     倒下清场之后，他才重新站起
    //
    // 没有 `attack`。这套骨骼的射击剪辑是 `Female_Crouch_Pick_Gun_
    // Point_Forward`，名字是个陷阱：以髋部测量，它从 92 单位
    // （站立）开始，下沉到 68，到 70% 处又回到 93——在 0.6 处
    // 标定的击发帧落在人*站着*的时候。把它夹在跪姿瞄准（髋 48）
    // 和跪姿装填（髋 42）之间播放，会让神射手每次射击都站起来
    // 开火再跪回去、来回两次。所以跪姿枪手保持跪姿，
    // 直接从保持的瞄准姿态开火；该剪辑不上名册，
    // 免得加载了又跳过。
    // 同一骨骼上的备选：`...-anim-combat-stance.glb`（徒手戒备）、
    // `...-anim-charged-spell-cast-1.glb`（旧的持杖施法）。
    b: {
      rigged: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-rigged.glb`,
      idle: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-anim-lower-weapon-look-raise.glb`,
      aim: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-anim-crouchlookaroundbow.glb`,
      rise: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-anim-kneel-on-one-knee-and-stand.glb`,
      death: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-anim-dead.glb`,
      walk: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-anim-rifle-charge-inplace.glb`,
      reload: `${MODEL_BASE}/779c54d4-67b3-4e69-948a-fdcc8c58ae5c-anim-kneeling-reload.glb`,
    },
    n: {
      rigged: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1-rigged.glb`,
      idle: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1-anim-combat-stance.glb`,
      attack: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1-anim-charged-slash.glb`,
      death: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1-anim-dying-backwards.glb`,
      // 骑兵即使下了马，走路依然带着傲气。
      walk: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1-anim-confident-strut-inplace.glb`,
      run: `${MODEL_BASE}/ebbe76e7-dbc7-4961-bf10-035acee68ee1-anim-standard-forward-charge-inplace.glb`,
    },
    // 炮兵组：炮手拖拽火炮就位，然后操炮。它的"攻击"是
    // 踏入炮架、猛拉拉火绳。它的双手是空的——炮是拖行的，
    // 不是扛着的——所以两个循环都选了炮手立在炮位的姿态，
    // 而非怀抱武器的姿态：
    //   * stance ——在炮架旁稍息，双臂下垂（不是斗殴者的戒备）
    //   * stride ——普通的行进步态，以炮组的缓慢步频播放，
    //     读作沉重的踏行。旧的扛炮跋涉让双臂抱着一根
    //     看不见的炮管，读作一段坏掉的走姿。
    // 同一骨骼上的备选：`...-anim-combat-stance.glb`、
    // `...-anim-carry-heavy-cannon-forward-inplace.glb`。
    r: {
      rigged: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2-rigged.glb`,
      idle: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2-anim-idle.glb`,
      attack: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2-anim-step-forward-and-push.glb`,
      death: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2-anim-knock-down.glb`,
      walk: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2-anim-casual-walk-inplace.glb`,
      // 火炮发言之后，跪在炮口旁装药填弹。
      reload: `${MODEL_BASE}/044ccbd8-c9d3-452e-8524-4a47034b8fe2-anim-kneeling-reload.glb`,
    },
    // 线列步兵打排枪齐射，而不是挺刺刀冲锋。
    // 备选：`...-anim-thrust-slash.glb`（刺刀突刺）。
    p: {
      rigged: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-rigged.glb`,
      idle: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-anim-combat-stance.glb`,
      // 火枪抵肩、脸颊贴上枪托、枪管追踪棋盘对面的身影：
      // 齐射先瞄准，再开火。
      aim: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-anim-archery-aim-with-lateral-scan.glb`,
      attack: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-anim-draw-and-shoot-from-back.glb`,
      death: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-anim-knock-down.glb`,
      // 火枪横持身前、蓄势待发——线列在推进，而不是闲逛。
      // 完整的 1.13 秒步态循环，重定时到步兵的步频后读作行军。
      // 同一骨骼上的持枪*冲锋*（`...-anim-rifle-charge-inplace.glb`）
      // 是 0.53 秒的冲刺，腿部糊成一片，髋部还带着六单位的
      // 左右根位移——拉到一格棋的长度上读作一个人在原地抖动，
      // 所以只保留下面的冲锋用途。
      walk: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-anim-spear-walk-inplace.glb`,
      reload: `${MODEL_BASE}/29b4a2e7-eba2-4ca7-a9f3-e22278c8df9e-anim-standing-reload.glb`,
    },
  },
};

/**
 * 弹药库，逐一雕塑：大军团发射的每一发弹药都是真实网格，
 * 而不是一个发光点——因此一发穿过大厅的射击，
 * 读起来是一块在空中翻滚的金属。
 *
 * 枪膛里的每种弹药各配一座雕塑——军官的浇铸铅手枪弹、
 * 线列的磕瘪 .69 沙勒维尔弹、神射手的线膛米涅弹、
 * 炮兵组的麻面铁实心弹。它们从生成器返回时都是
 * *无方向的*（旋转体没有内在的正前方），所以加载器以
 * 每座雕塑自己实测的长轴作为弹头朝向，而不是虚构一个
 * 偏航修正——见 `scene/gunfire.ts`。尚未下载完成的雕塑
 * 会在 `scene/ammunition.ts` 中程序化锻造，
 * 因此下载途中没有人打过空包弹。
 */
export const SHOT_MODELS: ShotModelSource[] = [
  // 军官燧发枪：小而略失圆，模具接缝还留在弹体上。
  { ammo: "pistolBall", url: `${MODEL_BASE}/49825d82-a7a6-4658-98e0-0c86275128d5.glb` },
  // .69 软铅弹，局部被通条捣扁，沾着火药残渣。
  { ammo: "musketBall", url: `${MODEL_BASE}/737c408d-b677-4be0-a805-02354f7f3532.glb` },
  // 军中唯一的锥形弹：卵形弹头、润滑脂槽、空心底部。
  { ammo: "minieBullet", url: `${MODEL_BASE}/76d56227-19ad-46cf-b9e8-b84f93bef133.glb` },
  // 六磅砂型铸铁弹，周身麻点，腰线一圈合模缝。
  { ammo: "roundShot", url: `${MODEL_BASE}/dca2d8a4-736e-4e04-ace0-691ae325a730.glb` },
];

/**
 * 拿破仑时代的武器，逐一雕塑。
 *
 * 奇幻刀剑可以用方块和圆柱拼出来，因为没人能查证。
 * 大军团的武器不行：沙勒维尔火枪、An XI 胸甲骑兵剑和燧发枪
 * 都是有据可查的实物，在一只本就是真实雕塑的手里，
 * 几何体拼出来的近似物读起来就是个玩具。
 * 每个条目都是真实武器的生成网格，由 `scene/armoury.ts`
 * 装入道具框架——它*测量*每个模型而不是信任其姿态，
 * 因为生成器交回来的这些武器都躺在自己包围盒的对角线上。
 *
 * `grip` 和 `muzzle` 是从枪托起算的、占武器全长的比例——
 * 这是测量找不到的两样东西，毕竟网格里没有写着"扳机"。
 * 两者都是从各雕塑自身的截面轮廓读出来的
 * （火器上枪机的隆起、刀剑上柄首与护手之间的空隙），
 * 与它们所替代的手工拼装道具误差在几个百分点以内。
 *
 * 没有条目的武器——所有中世纪与太阳帝国的武器，
 * 以及炮兵组拖曳的野战炮——仍用几何体拼装；
 * 这些条目下载失败时也一样：一杆朴素的火枪，
 * 总好过一个手无寸铁的士兵。
 */
export const ARM_SCULPTS: Partial<Record<WeaponId, ArmSculptSource>> = {
  // 沙勒维尔 1777 型，上刺刀。实测轮廓：一端是枪托底板，
  // 枪机隆起在全长 0.22 处，刺刀座在 0.80 处，刀尖在远端——
  // 棋盘上最长的剪影。
  musketBayonet: {
    url: `${MODEL_BASE}/bc6b8c09-5d21-440c-b145-eee190c2e0cf.glb`,
    length: 0.86,
    grip: 0.19,
    // 是膛口而不是刺刀尖：火光必须从枪管里喷出。
    muzzle: 0.8,
    family: "firearm",
  },
  // 1793 凡尔赛线膛骑枪：贴腮片、片状瞄具，无刺刀。
  marksmanRifle: {
    url: `${MODEL_BASE}/4fb92659-06c6-4bbe-b0d3-ed21f37c2c8b.glb`,
    length: 0.85,
    grip: 0.3,
    muzzle: 0.985,
    family: "firearm",
  },
  // An XI 重骑兵剑：直刃，四分支黄铜碗形护手。
  cavalrySabre: {
    url: `${MODEL_BASE}/ebf0edf9-d446-4fa7-a0a7-d1db4e6123ed.glb`,
    length: 0.63,
    grip: 0.11,
    family: "blade",
  },
  // 将官礼服佩剑：鎏金剑柄，烤蓝鎏金蚀刻剑身。
  //
  // 长度是实物与佩剑者的真实比例，不是猜的：军官礼服佩剑
  // 全长约 95 厘米，拿破仑身高 1.69 米——算上这座雕塑戴的
  // 双角帽帽顶是 1.75 米。得 0.54，这让皇帝的剑比骑兵的
  // An XI（0.63）还要*短*，而非棋盘上最长的钢铁。
  imperialSabre: {
    url: `${MODEL_BASE}/47492c2e-f774-49e0-b2ef-113a02132a50.glb`,
    length: 0.54,
    grip: 0.11,
    family: "blade",
  },
  // 赐剑：象牙握柄、月桂枝护弓、鹰首柄头。
  // 这一把到货时是柄在后的朝向；装配器不靠告知就能找到剑尖。
  // 宫廷剑是帝国宫廷所佩最长、最直的剑，
  // 全长也不过一米上下——是佩戴者身高的 0.58。
  marengoSword: {
    url: `${MODEL_BASE}/307d49bd-b8c8-44b5-9837-bd55d8c849b6.glb`,
    length: 0.58,
    grip: 0.13,
    family: "blade",
  },
  // An XIII 军官燧发手枪，鎏金饰件，文件中枪口朝前。
  officerPistol: {
    url: `${MODEL_BASE}/ff7079b3-d6d5-44a9-a43a-0bf4d3a2954d.glb`,
    length: 0.27,
    grip: 0.15,
    muzzle: 0.98,
    family: "firearm",
  },
};

/**
 * 生成器为每座雕塑上报的朝向判定：
 * hasIntrinsicFront = true，正前 = +Z，向上 = +Y。
 */
export const PIECE_MODEL_ORIENTATION = {
  localFrontAxis: "positiveZ",
  localUpAxis: "positiveY",
} as const;

const CRY_BASE = "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd";

/**
 * 每支军队每个棋子各配一声阵亡呼喊。它们都按角色性格配音——
 * 白曜王国死得像中世纪欧洲人，太阳帝国死得像美洲豹/鹰武士，
 * 大军团死得像刚中弹的人——因此不看棋盘，
 * 耳朵也能分辨刚倒下的是什么棋子、属于哪支军队。
 * 女王们是例外：是带气声的叹息与喘息，而非尖叫。
 * 每条剪辑都按真实的一秒时长生成，
 * 混音器以自然音高回放，而不是把更长的录音加速播放。
 * 在混音器解锁后惰性加载（只有吃子时才用得上）。
 */
const DEATH_CRIES: Record<ArmySkinId, Record<PieceKind, string>> = {
  ivory: {
    k: `${CRY_BASE}/c4d801f3-b8e7-42bb-b046-6b21e9ec40a5.mp3`,
    q: `${CRY_BASE}/e01a2d0f-2b13-426b-89b4-d40e67d4b16f.mp3`,
    b: `${CRY_BASE}/4ca6a216-52fc-4882-b51a-9a44d188edac.mp3`,
    n: `${CRY_BASE}/ebb33bba-cf2b-481f-aec6-4465a6a35253.mp3`,
    r: `${CRY_BASE}/f9d84835-112f-46de-951b-052f867814da.mp3`,
    p: `${CRY_BASE}/e4caca0d-8f61-4228-b349-025ae499cde5.mp3`,
  },
  sun: {
    k: `${CRY_BASE}/7efd7eb4-936a-4488-83ae-e0ebea314601.mp3`,
    // 年轻女声——一声被喘息掐断的、拖长的朴素尖叫"啊——"。
    q: `${CRY_BASE}/6fe2ac5d-b4e4-4655-9354-cfbb117bc7f5.mp3`,
    b: `${CRY_BASE}/6ae51ccd-12c2-4002-875d-ec4c1d907227.mp3`,
    n: `${CRY_BASE}/a66374c2-9253-4f07-8202-1001ccf6ba69.mp3`,
    r: `${CRY_BASE}/6107aca9-aa81-45ff-a3d5-eda9d457fc3b.mp3`,
    // 低沉男声——一声渐强的呐喊被断气声戛然而止。
    p: `${CRY_BASE}/ffa27c35-53ff-4f3a-a71e-285aff8a2a4b.mp3`,
  },
  // 大军团死得像它自己。白曜王国是怒吼、太阳帝国是尖啸，
  // 而火药军队中弹后很快安静下来：
  // 这些全是中弹反应——先是气被一拳打出去，声音还在后面。
  empire: {
    // 拿破仑：一声统帅式的震惊闷哼，从咬紧的牙关里被咬断。
    // 他不尖叫；大衣一合，声音就闷在里面。
    k: `${CRY_BASE}/dd0626e5-1b47-4d72-800b-503ae732f16d.mp3`,
    // 帝国统帅：急促的倒吸气，接着是渐弱的低痛喘——
    // 强撑着而非嘶喊，与那两位女巫女王不同。
    q: `${CRY_BASE}/bbae4ca6-bb5c-46b5-be77-b2a4e6bfc890.mp3`,
    // 猎兵元帅：在他开火的那条膝上中弹——
    // 一声短促的闷哼，加上贴地的沙哑喘息。
    b: `${CRY_BASE}/203b9d42-08e3-43e5-96e3-9c7653f419db.mp3`,
    // 胸甲骑兵：一声被钢盔兜住的狂怒咆哮，收尾带血沫声。
    n: `${CRY_BASE}/f2391f92-4656-4dd2-bb62-8975ca2926a8.mp3`,
    // 炮兵卫士：棋盘上最魁梧的人——一声低沉的岔气呻吟，
    // 随着身体倒下音高一路下沉。
    r: `${CRY_BASE}/1dc52c19-e964-4089-a111-d0b1122b4198.mp3`,
    // 线列步兵：年轻、单薄、惊慌失措——一声渐高的哭喊被猛地掐断。
    p: `${CRY_BASE}/d32a7184-f41f-4ad9-a61b-a4dc386648e2.mp3`,
  },
};

/** 一个可选文明：雕塑、动画剪辑、武器、名称与嗓音。 */
export interface ArmySkin {
  id: ArmySkinId;
  /** 军队名称，显示在点将面板中。 */
  label: string;
  /** 名称下方的一行风味描述。 */
  blurb: string;
  /** 军衔名，按剪影从大到小排列——纹章会用到。 */
  ranks: Record<PieceKind, string>;
  /** 棋子配发的程序化武器家族。 */
  arsenal: ArsenalId;
  /**
   * 这支军队绘制时所归属的一方。当双方穿戴同一皮肤时，
   * 原生一方保留自己的贴图，另一方重新染上号衣配色，
   * 两支军队因此永远不会混为一谈。
   */
  native: Faction;
  still: Roster<string>;
  animated: Roster<PieceAnimationSet>;
  cries: Record<PieceKind, string>;
}

export const ARMY_SKINS: Record<ArmySkinId, ArmySkin> = {
  ivory: {
    id: "ivory",
    label: "白曜王国",
    blurb: "中世纪欧洲——板甲、熨斗盾与巫火。",
    ranks: { k: "国王", q: "王后", b: "法师", n: "骑士", r: "卫戍", p: "步卒" },
    arsenal: "kingdom",
    native: "w",
    still: STILL_MODELS.ivory,
    animated: ANIMATED_MODELS.ivory,
    cries: DEATH_CRIES.ivory,
  },
  sun: {
    id: "sun",
    label: "太阳帝国",
    blurb: "黑曜石、翡翠与格查尔鸟羽，在阶梯金字塔的烈日之下。",
    ranks: { k: "皇帝", q: "大祭司", b: "蛇祭司", n: "美洲豹武士", r: "神殿守卫", p: "鹰武士" },
    arsenal: "sun",
    native: "b",
    still: STILL_MODELS.sun,
    animated: ANIMATED_MODELS.sun,
    cries: DEATH_CRIES.sun,
  },
  empire: {
    id: "empire",
    label: "大军团",
    blurb: "拿破仑时代的法国——藏青与鎏金，线膛枪、火绳枪与火炮。",
    ranks: {
      k: "拿破仑",
      q: "帝国统帅",
      b: "猎兵元帅",
      n: "胸甲骑兵",
      r: "炮兵卫士",
      p: "线列步兵",
    },
    arsenal: "empire",
    native: "b",
    still: STILL_MODELS.empire,
    animated: ANIMATED_MODELS.empire,
    cries: DEATH_CRIES.empire,
  },
};

/** 皮肤在设置面板中的展示顺序。 */
export const ARMY_SKIN_ORDER: ArmySkinId[] = ["ivory", "sun", "empire"];

/** 在玩家另行指定之前，双方各自召集的军队。 */
export const DEFAULT_ARMY_SKINS: Record<Faction, ArmySkinId> = { w: "ivory", b: "sun" };

/**
 * 黑火药枪声，实录而非合成。每根枪管都有自己的录音：
 * 混音器里的合成人声仍在底层播放，负责超低频和节奏，
 * 但耳朵在上层听到的是真实的枪响。
 * 在混音器解锁后惰性加载——只有大军团用得上。
 *
 * 这四根枪管的录音都重新录制过，让起点*正对瞬态*。
 * 上一版是按普通音效生成的，意味着每条录音在枪响前
 * 都带一段房间底噪：沙勒维尔的爆音前有 54ms 的静默，
 * 线膛枪管的峰值更是到 171ms 才出现。在击锤落下的那一帧
 * 从零采样点开始播放，枪响因此比枪口火光*晚到*三到十帧——
 * 先看见射击，后听见枪声。混音器现在还会在解码时
 * 找出每条录音的真实起点（见 `analyseTake`），
 * 所以重新生成的剪辑若仍带前导空白，会被裁剪而非盲信。
 */
export const GUN_AUDIO_URLS = {
  /** 皇帝的燧发枪：干脆、明亮的爆音。 */
  pistol: `${CRY_BASE}/a8cbcada-acce-4a51-8690-974d0e50a68a.mp3`,
  /** 石厅里的沙勒维尔火枪：爆音压着一记胸腔闷响。 */
  musket: `${CRY_BASE}/b042be28-3bb5-48e8-b0a5-ef7a1fbec2d5.mp3`,
  /** 神射手的线膛枪管：更紧、更细的鞭哨声。 */
  rifle: `${CRY_BASE}/9ab8b947-9b2c-4cfc-8b26-653be55a6451.mp3`,
  /** 炮兵组：轰鸣之下，炮架在石板上一路后坐。 */
  cannon: `${CRY_BASE}/65e94019-873c-478d-a688-e76d01bb73a3.mp3`,
  /** 弹丸命中：跳弹的呜咽被入肉的闷响截断。 */
  impact: `${CRY_BASE}/a0f8c443-5140-41f8-b21c-770450ae9751.mp3`,
} as const;

/** 大军团每个军衔击发的是哪根实录枪管。 */
export type GunVoice = "pistol" | "musket" | "rifle" | "cannon";

export const AUDIO_URLS = {
  ambience: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/e62d5bb9-8c84-4464-8696-dbcf975f938b.mp3",
  score: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/3fbe58de-9d38-4d91-a002-794d0e979eb0.mp3",
  tension: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/00baae5a-fde3-478a-8190-b1ad14d2e96d.mp3",
  place: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/73f19d09-0275-4c4b-87cd-eeeed26a616b.mp3",
  capture: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/64ee8170-b796-413f-8249-f1deb7803393.mp3",
  check: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/20ebb41c-0b20-4b4b-8c75-5f78541722d3.mp3",
  fanfare: "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd/c89fa5ef-7904-4a5f-899e-e1973b13b30f.mp3",
} as const;
