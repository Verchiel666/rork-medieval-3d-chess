import { ARMY_SKINS, AUDIO_URLS, DEFAULT_ARMY_SKINS, GUN_AUDIO_URLS, type GunVoice } from "../assets/generated";
import type { Faction, PieceKind } from "../core/types";

type SfxName = "place" | "capture" | "check" | "fanfare";
type BedName = "ambience" | "score" | "tension";

/** 棋子濒死之声在混音中的定位方式。 */
export interface DeathCryOptions {
  /** 声像：-1 极左 … 1 极右 —— 尸体在屏幕上的位置。 */
  pan?: number;
  /** 相对响度（越重的棋子死得越响）。 */
  volume?: number;
  /** 播放速率抖动，让同一枚棋子不会两次死得一模一样。 */
  rate?: number;
  /** 人声开始前等待的秒数，让击打先落地。 */
  delay?: number;
}

/**
 * 一次脚步的材质声线。驱动噪声频段、体鸣模态与余响，
 * 让耳朵能分辨赤脚步兵与披甲守卫。
 */
export type FootstepTimbre = "scuff" | "leather" | "plate" | "regal";

/** 一只脚踏上石板。 */
export interface FootstepOptions {
  /** 声像：-1 极左 … 1 极右 —— 棋子在屏幕上的位置。 */
  pan?: number;
  /** 相对响度。 */
  volume?: number;
  /** 靴子的形制 —— 见 {@link FootstepTimbre}。 */
  timbre?: FootstepTimbre;
  /** 发声前等待的秒数。 */
  delay?: number;
  /** 每一步轻微的失谐，让行军永不变成节拍器。 */
  jitter?: number;
}

/** 一次法术音效在混音中的定位。 */
export interface SpellOptions {
  /** 声像：-1 极左 … 1 极右 —— 施法者或爆炸点在屏幕上的位置。 */
  pan?: number;
  /** 相对响度。 */
  volume?: number;
  /** 发声前等待的秒数。 */
  delay?: number;
  /** 蓄力达到满功率所需的时长（仅用于蓄力）。 */
  duration?: number;
}

/** 一声枪响在混音中的定位，叠加在近战定位之上。 */
export interface GunSoundOptions extends StrikeSoundOptions {
  /**
   * 使用哪一根录音枪管。省略时，枪声只有合成声线 ——
   * 这也是所有非火药军队一直在用的方式。
   */
  voice?: GunVoice;
}

/** 一次近战打击音效在混音中的定位。 */
export interface StrikeSoundOptions {
  /** 声像：-1 极左 … 1 极右 —— 击打点在屏幕上的位置。 */
  pan?: number;
  /** 相对响度。 */
  volume?: number;
  /** 发声前等待的秒数。 */
  delay?: number;
  /** 0 = 轻刃破空，1 = 抡起的攻城重锤。 */
  weight?: number;
}

/** 占格标志音在混音中的定位方式。 */
export interface ConquestOptions {
  /** 声像：-1 极左 … 1 极右 —— 被占格在屏幕上的位置。 */
  pan?: number;
  /** 相对响度。 */
  volume?: number;
  /** 发声前等待的秒数。 */
  delay?: number;
  /**
   * 被吃掉的是什么：0 是步兵，1 是王冠。会压低动机根音、
   * 拉长尾音并加入第三个音，让耳朵不看托盘也能知道
   * 这次吃子有多大。
   */
  weight?: number;
}

/** 一步棋加入预排着法链时的轻柔确认音。 */
export interface PremoveChimeOptions {
  /** 声像：-1 极左 … 1 极右 —— 计划落点所在格的位置。 */
  pan?: number;
  /** 刚落下的是链中的第几环，从 0 计。让音符沿音阶爬升。 */
  index?: number;
  /** 相对响度。 */
  volume?: number;
}

/** 一枚木棋子从棋盘上拿起或放下。 */
export interface WoodTapOptions {
  /** 声像：-1 极左 … 1 极右 —— 棋格在屏幕上的位置。 */
  pan?: number;
  /** 相对响度。 */
  volume?: number;
  /** 0 = 轻步兵的轻叩，1 = 重国王的落定（更低、余响更长）。 */
  weight?: number;
  /** 拿起（而非放下）棋子时使用的更轻、更亮的叩声。 */
  lift?: boolean;
  /** 发声前等待的秒数。 */
  delay?: number;
}

/**
 * 一段已解码的枪声录音，附带两个不可信任录制方做对的属性：
 * 枪声实际从哪里开始，以及这段录音本身有多响。
 */
interface ShotTake {
  buffer: AudioBuffer;
  /**
   * 枪响本身之前的前导秒数。播放从这里开始，
   * 让瞬态正好落在调用方请求的那一帧，
   * 而不是录音碰巧开始之后任意远的位置。
   */
  onset: number;
  /** 该录音的峰值采样，用于把每根枪管对齐到同一余量。 */
  peak: number;
}

/**
 * 每段录音统一归一化到的峰值。生成的素材回来时在满幅的
 * 0.18 到 1.55 之间 —— 相差 9 倍。若不处理，手工调好的
 * 各枪管配比就毫无意义，因为录音电平会淹没一切。
 */
const TAKE_PEAK = 0.92;
/** 该修正量的上下限，免得把嘶嘶作响的录音推成噪声。 */
const TAKE_GAIN_RANGE: readonly [number, number] = [0.3, 3.4];

/**
 * 每根录音枪管与其下方合成声线的配比。
 *
 * 两者不可互换。瞬态又硬又近的录音（夏勒维尔火枪）自己
 * 就能扛起整个枪响，只需要合成器补一点次低音；而松散的
 * 录音（燧发枪，录进去的大多是厅堂混响）则必须把合成的
 * 爆音留得更足，否则枪声在发生的那一帧上没有棱角。
 * 按枪管逐一调校，因为“这段录音有多好”不是 `calibre`
 * 能表达的。
 */
const SHOT_VOICES: Record<GunVoice, { take: number; synth: number }> = {
  /** 设计上棋盘上最安静的击杀 —— 录音里大多是房间声。 */
  pistol: { take: 0.74, synth: 0.6 },
  /** 四者中瞬态最硬：下面几乎不需要垫任何东西。 */
  musket: { take: 1, synth: 0.34 },
  /** 一条细鞭响；它没有的体量由合成器补足。 */
  rifle: { take: 0.88, synth: 0.5 },
  /** 自带厅堂混响，但没有野战炮欠房间的那份次低音。 */
  cannon: { take: 0.96, synth: 0.52 },
};

/**
 * 占格动机的根音，单位 Hz —— G3，与审判之钟敲击的
 * 基频相同。共享同一个根音，让两者听起来像同一座厅堂
 * 在说话，而不是两个毫不相干的音效。
 */
const CLAIM_ROOT = 196;

/** 人声余量，确保嘶吼永不压过配乐而削波。 */
const CRY_VOLUME = 0.85;
/** 同时发声的上限 —— 超过这个数混音就糊成一团。 */
const MAX_VOICES = 3;
/**
 * 哀嚎按一秒长的录音生成，因此播放时不做任何时间拉伸。
 * 这只是为回来稍长的素材准备的安全网。
 */
const MAX_CRY_SECONDS = 1.15;
/** 尾部淡出，让被裁剪的素材永不爆音。 */
const CRY_FADE = 0.1;

interface FootstepVoice {
  /** 这只靴子的整体响度。 */
  level: number;
  /** 低频体鸣模态 —— 砸进地板的重量，单位 Hz。 */
  body: number;
  /** 体鸣闷响的峰值。 */
  weight: number;
  /** 闷响消散所需的时长。 */
  decay: number;
  /** 噪声频段的中心 —— 砂砾、皮革或钢铁。 */
  noise: number;
  /** 该频段的锐度。 */
  q: number;
  /** 噪声瞬态的电平。 */
  hiss: number;
  /** 摩擦声的时长（秒）。 */
  scuff: number;
  /** 包络指数 —— 越大摩擦声越短促干脆。 */
  grit: number;
  /** 金属余响的电平（无甲脚步为 0）。 */
  ring: number;
  /** 该余响的音高，单位 Hz。 */
  ringHz: number;
}

/**
 * 在这块棋盘上行进的四种靴子。步兵蹭地而行，教士的
 * 皮革吱呀作响，高塔守卫浑身板甲铿锵，而王冠每一步
 * 都踏出缓慢、深沉、从容的重量。
 */
const FOOTSTEP_VOICES: Record<FootstepTimbre, FootstepVoice> = {
  scuff: {
    level: 0.82,
    body: 108,
    weight: 0.2,
    decay: 0.09,
    noise: 1650,
    q: 0.8,
    hiss: 0.5,
    scuff: 0.055,
    grit: 3.2,
    ring: 0,
    ringHz: 0,
  },
  leather: {
    level: 0.9,
    body: 96,
    weight: 0.24,
    decay: 0.11,
    noise: 1180,
    q: 0.7,
    hiss: 0.42,
    scuff: 0.075,
    grit: 2.4,
    ring: 0.03,
    ringHz: 2350,
  },
  plate: {
    level: 1.12,
    body: 72,
    weight: 0.34,
    decay: 0.17,
    noise: 820,
    q: 0.55,
    hiss: 0.34,
    scuff: 0.09,
    grit: 2,
    ring: 0.09,
    ringHz: 3120,
  },
  regal: {
    level: 1.05,
    body: 62,
    weight: 0.32,
    decay: 0.2,
    noise: 940,
    q: 0.6,
    hiss: 0.3,
    scuff: 0.1,
    grit: 2.2,
    ring: 0.055,
    ringHz: 2680,
  },
};

interface Bed {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  target: number;
}

const BED_VOLUME: Record<BedName, number> = {
  ambience: 0.32,
  score: 0.34,
  tension: 0.0,
};

/**
 * Web Audio 混音器：三条循环床（环境声 / 配乐 / 紧张度声部）
 * 随游戏烈度交叉淡化，外加单发音效。UI 提示音为合成音，
 * 这样每次悬停都不必耗费一份网络资源。
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 音乐/环境声子总线，会在死亡哀嚎下被压低。 */
  private bedBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** 按 URL 索引的已解码死亡哀嚎，按需流式加载。 */
  private voices = new Map<string, AudioBuffer>();
  private voiceLoads = new Map<string, Promise<void>>();
  /** 按 URL 索引的已解码枪声录音。只有火药军队需要它们。 */
  private shots = new Map<string, ShotTake>();
  private shotLoads = new Map<string, Promise<void>>();
  /**
   * 双方临死时使用谁的声线。玩家换上另一支军队时切换，
   * 这样一名法国线列步兵绝不会发出美洲豹战士的嘶吼。
   */
  private cries: Record<Faction, Record<PieceKind, string>> = {
    w: ARMY_SKINS[DEFAULT_ARMY_SKINS.w].cries,
    b: ARMY_SKINS[DEFAULT_ARMY_SKINS.b].cries,
  };
  private activeVoices = 0;
  private beds = new Map<BedName, Bed>();
  private muted = false;
  private started = false;
  private loading: Promise<void> | null = null;

  get isMuted(): boolean {
    return this.muted;
  }

  /** 必须由用户手势触发调用（浏览器自动播放策略）。 */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.bedBus = this.ctx.createGain();
      this.bedBus.gain.value = 1;
      this.bedBus.connect(this.master);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.loading) this.loading = this.preload();
    await this.loading;
    this.startBeds();
    // 人声只在吃子时才用得上，所以让它们在音乐背后流式加载，
    // 而不是卡住游戏的第一帧。
    void this.primeDeathCries();
    void this.primeGunfire();
  }

  private async preload(): Promise<void> {
    const entries = Object.entries(AUDIO_URLS).filter(([, url]) => url.length > 0);
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const response = await fetch(url);
          const raw = await response.arrayBuffer();
          const ctx = this.ctx;
          if (!ctx) return;
          const buffer = await ctx.decodeAudioData(raw);
          this.buffers.set(key, buffer);
        } catch (error) {
          console.warn(`[audio] could not load "${key}"`, error);
        }
      }),
    );
  }

  private startBeds(): void {
    if (this.started || !this.ctx || !this.master) return;
    this.started = true;
    const layers: { name: BedName; key: keyof typeof AUDIO_URLS }[] = [
      { name: "ambience", key: "ambience" },
      { name: "score", key: "score" },
      { name: "tension", key: "tension" },
    ];
    for (const layer of layers) {
      const buffer = this.buffers.get(layer.key);
      const gain = this.ctx.createGain();
      gain.gain.value = BED_VOLUME[layer.name];
      gain.connect(this.bedBus ?? this.master);
      let source: AudioBufferSourceNode | null = null;
      if (buffer) {
        source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(gain);
        source.start(0);
      }
      this.beds.set(layer.name, { gain, source, target: BED_VOLUME[layer.name] });
    }
  }

  /** 0 = 平静，1 = 将军 / 残局。交叉淡化紧张度声部。 */
  setIntensity(intensity: number): void {
    if (!this.ctx) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    this.fadeBed("tension", clamped * 0.5, 1.8);
    this.fadeBed("score", 0.34 - clamped * 0.12, 1.8);
  }

  private fadeBed(name: BedName, value: number, seconds: number): void {
    const bed = this.beds.get(name);
    if (!bed || !this.ctx) return;
    bed.target = value;
    const now = this.ctx.currentTime;
    bed.gain.gain.cancelScheduledValues(now);
    bed.gain.gain.setValueAtTime(bed.gain.gain.value, now);
    bed.gain.gain.linearRampToValueAtTime(value, now + seconds);
  }

  play(name: SfxName, volume = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.master);
    source.start(0);
  }

  /** 短暂压低配乐与环境声，让人声穿透出来。 */
  private duckBeds(amount: number, seconds: number): void {
    if (!this.bedBus || !this.ctx) return;
    const now = this.ctx.currentTime;
    const gain = this.bedBus.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(amount, now + 0.08);
    gain.linearRampToValueAtTime(1, now + 0.08 + Math.max(0.2, seconds));
  }

  /** 混音器就绪后，在后台预热每一段哀嚎。 */
  /**
   * 把双方指向各自军队的声线并预热新素材。已解码的哀嚎
   * 会留在缓存里（按 URL 索引），所以切回来时即刻可用。
   */
  setArmyCries(cries: Record<Faction, Record<PieceKind, string>>): void {
    this.cries = { w: cries.w, b: cries.b };
    if (this.ctx) void this.primeDeathCries();
  }

  /** 混音器就绪后，在后台预热各录音枪管。 */
  private async primeGunfire(): Promise<void> {
    await Promise.all(Object.values(GUN_AUDIO_URLS).map((url) => this.loadShot(url)));
  }

  private loadShot(url: string): Promise<void> {
    const pending = this.shotLoads.get(url);
    if (pending) return pending;
    const job = (async () => {
      try {
        const response = await fetch(url);
        const raw = await response.arrayBuffer();
        const ctx = this.ctx;
        if (!ctx) {
          this.shotLoads.delete(url);
          return;
        }
        this.shots.set(url, this.analyseTake(await ctx.decodeAudioData(raw)));
      } catch (error) {
        console.warn("[audio] gunfire take failed to load", error);
      }
    })();
    this.shotLoads.set(url, job);
    return job;
  }

  /**
   * 找出一段枪声录音实际从哪里开始，以及它录得有多响。
   *
   * 生成的音效是一段*素材*，不是一个事件：它开头带着模型
   * 随意给出的房间底噪，而枪响可能落在素材内部任何位置。
   * 若从第 0 个采样播放，耳朵会先听到闪光、后听到炸响 ——
   * 这正是本函数要消灭的不同步。
   *
   * 起点取自最响的时刻，而非第一个越过阈值的采样：
   * 阈值穿越会咬住房间底噪（或燧石刮擦声），把一段真正
   * 在 170ms 处才炸响的录音报成 0ms。所以先找到最响的
   * 4ms 窗口，*反向*回走到能量仍只有它一小部分的位置
   * —— 音头的脚下 —— 再在该窗口内精修到波形首次
   * 出现动作的那个采样。
   */
  private analyseTake(buffer: AudioBuffer): ShotTake {
    const data = buffer.getChannelData(0);
    const rate = buffer.sampleRate;
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]);
      if (value > peak) peak = value;
    }
    if (peak <= 0) return { buffer, onset: 0, peak: 1 };

    // 按 4ms 窗口计算能量包络：短到足以分辨瞬态，
    // 又长到不会让单个游离采样冒充瞬态。
    const window = Math.max(1, Math.round(rate * 0.004));
    const windows = Math.ceil(data.length / window);
    const energy = new Float32Array(windows);
    let loudest = 0;
    for (let w = 0; w < windows; w += 1) {
      const start = w * window;
      const end = Math.min(data.length, start + window);
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += data[i] * data[i];
      energy[w] = Math.sqrt(sum / Math.max(1, end - start));
      if (energy[w] > energy[loudest]) loudest = w;
    }

    // 音头的脚下：最响窗口之前最后一个安静的窗口。
    const floor = energy[loudest] * 0.14;
    let start = loudest;
    while (start > 0 && energy[start - 1] > floor) start -= 1;

    // 在该窗口内精修，免得爆音被截掉最多 4ms。
    let onset = start * window;
    const limit = Math.min(data.length, onset + window);
    for (let i = onset; i < limit; i += 1) {
      if (Math.abs(data[i]) >= peak * 0.05) {
        onset = i;
        break;
      }
    }
    // 绝不裁进枪响本体：音头保留两毫秒的助跑，
    // 这样它听起来仍是利落的硬边，而不是被截断的咔哒声。
    onset = Math.max(0, onset - Math.round(rate * 0.002));
    return { buffer, onset: onset / rate, peak };
  }

  /**
   * 播放一段录音素材，声像对准它在屏幕上发生的位置。素材尚未
   * 流入时返回 false（并为下次预热），让调用方可以回退到
   * 合成声线。
   *
   * 对每段素材应用两项修正，两者都从音频实测而非手工标注：
   * 播放从枪响自身的起点开始，让爆音精确落在调用方请求的
   * 瞬间；电平做归一化，让 `volume` 无论出自哪根枪管
   * 都表示同样的响度。
   */
  private playTake(
    url: string,
    options: { pan?: number; volume?: number; delay?: number; rate?: number } = {},
  ): boolean {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return false;
    const take = this.shots.get(url);
    if (!take) {
      void this.loadShot(url);
      return false;
    }
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = take.buffer;
    source.playbackRate.value = options.rate ?? 1;
    const gain = ctx.createGain();
    const match = Math.max(TAKE_GAIN_RANGE[0], Math.min(TAKE_GAIN_RANGE[1], TAKE_PEAK / take.peak));
    gain.gain.value = (options.volume ?? 1) * match;
    source.connect(gain);
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.6;
      gain.connect(panner);
      panner.connect(master);
    } else {
      gain.connect(master);
    }
    // 这个偏移正是全部意义所在：瞬态从这里开始，而不是从文件开头。
    source.start(when, take.onset);
    return true;
  }

  private async primeDeathCries(): Promise<void> {
    const factions: Faction[] = ["w", "b"];
    const kinds: PieceKind[] = ["k", "q", "b", "n", "r", "p"];
    for (const faction of factions) {
      await Promise.all(kinds.map((kind) => this.loadDeathCry(faction, kind)));
    }
  }

  private loadDeathCry(faction: Faction, kind: PieceKind): Promise<void> {
    const url = this.cries[faction]?.[kind];
    if (!url) return Promise.resolve();
    const pending = this.voiceLoads.get(url);
    if (pending) return pending;
    const job = (async () => {
      try {
        const response = await fetch(url);
        const raw = await response.arrayBuffer();
        const ctx = this.ctx;
        if (!ctx) {
          // 混音器在加载途中消失了 —— 让之后的吃子再试一次。
          this.voiceLoads.delete(url);
          return;
        }
        this.voices.set(url, await ctx.decodeAudioData(raw));
      } catch (error) {
        console.warn(`[audio] death cry "${faction}${kind}" failed to load`, error);
      }
    })();
    this.voiceLoads.set(url, job);
    return job;
  }

  /**
   * 一枚棋子的濒死之声：它自己的录音哀嚎，声像对准尸体在
   * 屏幕上的位置，音高带抖动，身后拖着一小段石厅余响，
   * 音乐在其下被压低。素材尚未流入完成时保持静默
   * （并为下次预热）。
   */
  deathCry(faction: Faction, kind: PieceKind, options: DeathCryOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const url = this.cries[faction]?.[kind];
    const buffer = url ? this.voices.get(url) : undefined;
    if (!buffer) {
      void this.loadDeathCry(faction, kind);
      return;
    }
    if (this.activeVoices >= MAX_VOICES) return;

    const ctx = this.ctx;
    const master = this.master;
    // 以原始速度播放 —— 采样本身就是一秒长的录音，
    // 唯一的速率变化是按兵种的音高抖动。
    const rate = options.rate ?? 1;
    const played = Math.min(MAX_CRY_SECONDS, buffer.duration / rate);
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = CRY_VOLUME * (options.volume ?? 1);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    // 削掉低频轰响，让人声浮在倒地的闷响之上。
    const body = ctx.createBiquadFilter();
    body.type = "highpass";
    body.frequency.value = 165;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, when);
    const fade = Math.min(CRY_FADE, played * 0.4);
    gain.gain.setValueAtTime(level, when + played - fade);
    gain.gain.linearRampToValueAtTime(0.0001, when + played);

    let tail: AudioNode = gain;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.7;
      gain.connect(panner);
      tail = panner;
    }
    source.connect(body);
    body.connect(gain);
    tail.connect(master);

    // 廉价的拍背回声，让嘶吼听起来像发生在大空间里。
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = "lowpass";
    echoTone.frequency.value = 1900;
    const echo = ctx.createDelay(0.5);
    echo.delayTime.value = 0.13;
    const echoGain = ctx.createGain();
    echoGain.gain.value = level * 0.26;
    gain.connect(echoTone);
    echoTone.connect(echo);
    echo.connect(echoGain);
    echoGain.connect(master);

    this.activeVoices += 1;
    source.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    source.start(when);
    source.stop(when + played + 0.02);

    this.duckBeds(0.55, played + 0.25);
  }

  /**
   * 一步排入队列的棋留下的音符：一记小小的击钟声，
   * 明显低于它依托的木叩声。
   *
   * 木叩声本身扛不起这个信息。为预排着法拿起棋子与真正
   * 排入队列，用的是 0.5 与 0.42 处*同样*的干叩声 ——
   * 近到耳朵分不清“听到了”与“已入队”，也没有任何
   * 东西说明*哪一环*刚刚落下。所以确认音要有自己的
   * 声线：一个柔和的正弦，上方叠一个安静的高八度，
   * 12ms 的起音让它缓缓荡开而不是咔哒一响，
   * 再加半秒的尾音。
   *
   * 它沿五音大调五声音阶上行 —— 这架梯子没有半音，
   * 所以快速排成的一串是一句话而不是一锅粥，音高本身
   * 就能告诉玩家计划有多深，不必把视线从战局上移开。
   * 峰值电平只有满幅的二十分之一：它必须待在*引擎*
   * 走棋声的下面，那才是真正在棋盘上发生的事情。
   */
  premoveChime(options: PremoveChimeOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const ladder = [523.25, 587.33, 698.46, 783.99, 880.0];
    const step = Math.max(0, Math.min(ladder.length - 1, Math.round(options.index ?? 0)));
    const root = ladder[step];
    const level = 0.05 * (options.volume ?? 1);

    const bus = ctx.createGain();
    bus.gain.value = level;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    bus.connect(tone);
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.5;
      tone.connect(panner);
      panner.connect(this.master);
    } else {
      tone.connect(this.master);
    }

    const partials: { ratio: number; gain: number; decay: number }[] = [
      { ratio: 1, gain: 1, decay: 0.52 },
      { ratio: 2, gain: 0.28, decay: 0.3 },
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(root * partial.ratio, now);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(partial.gain, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(now);
      osc.stop(now + partial.decay + 0.05);
    }
  }

  /**
   * 合成的倒地声：一声低闷响，垫在一小段滤波噪声之下，
   * 当被击中的棋子砸上石板时播放。
   */
  bodyFall(volume = 1): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(42, now + 0.22);
    thumpGain.gain.setValueAtTime(0.34 * volume, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    thump.connect(thumpGain);
    thumpGain.connect(this.master);
    thump.start(now);
    thump.stop(now + 0.4);

    const length = Math.floor(ctx.sampleRate * 0.25);
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.16 * volume;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.master);
    noise.start(now);
  }

  /**
   * 一枚棋子落上棋盘：底座碰在盘面上的一声干响，下面垫着
   * 三个阻尼木质体鸣模态。越重的棋子落得越低、余响稍长；
   * 每次叩击都带音高抖动，让对局永不变成节拍器。
   * 完全合成 —— 无素材、无延迟。
   */
  woodTap(options: WoodTapOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const lift = options.lift === true;
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.5));
    const level = 0.5 * (options.volume ?? 1) * (lift ? 0.55 : 1);
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);

    // 整个叩击共用一条总线，声像与电平在一处处理。
    const bus = ctx.createGain();
    bus.gain.value = level;
    // 木头是温暖的，不是脆亮的 —— 把整体的最高频滚降掉。
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = lift ? 5200 : 4200;
    bus.connect(tone);
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.55;
      tone.connect(panner);
      panner.connect(this.master);
    } else {
      tone.connect(this.master);
    }

    // 体鸣模态：一个基频加两个不谐和泛音，如同被敲击的木块。
    const jitter = 0.94 + Math.random() * 0.12;
    const root = (lift ? 620 : 430 - weight * 165) * jitter;
    const ring = (lift ? 0.085 : 0.13 + weight * 0.075);
    const modes: { ratio: number; gain: number; decay: number }[] = [
      { ratio: 1, gain: 1, decay: 1 },
      { ratio: 2.06, gain: 0.42, decay: 0.62 },
      { ratio: 3.41, gain: 0.19, decay: 0.38 },
    ];
    for (const mode of modes) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const frequency = root * mode.ratio;
      osc.frequency.setValueAtTime(frequency, when);
      // 轻微的下滑 —— 敲击落定过程中，叩声的音高会下沉。
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.94, when + ring * mode.decay);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(mode.gain, when + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + ring * mode.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + ring + 0.05);
    }

    // 接触本身：几毫秒的滤波噪声，做出“嗒”的一声。
    const clickLength = Math.max(1, Math.floor(ctx.sampleRate * 0.02));
    const noiseBuffer = ctx.createBuffer(1, clickLength, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < clickLength; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / clickLength, 6);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const click = ctx.createBiquadFilter();
    click.type = "bandpass";
    click.frequency.value = lift ? 2600 : 1750 - weight * 350;
    click.Q.value = 0.9;
    const clickGain = ctx.createGain();
    clickGain.gain.value = lift ? 0.5 : 0.72;
    noise.connect(click);
    click.connect(clickGain);
    clickGain.connect(bus);
    noise.start(when);

    // 只有真正的落定才会把重量砸进桌面。
    if (!lift) {
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      body.type = "sine";
      body.frequency.setValueAtTime(150 - weight * 45, when);
      body.frequency.exponentialRampToValueAtTime(78 - weight * 20, when + 0.1);
      bodyGain.gain.setValueAtTime(0.0001, when);
      bodyGain.gain.exponentialRampToValueAtTime(0.22 + weight * 0.2, when + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13 + weight * 0.05);
      body.connect(bodyGain);
      bodyGain.connect(bus);
      body.start(when);
      body.stop(when + 0.25);
    }
  }

  /**
   * 石板上的一次脚步：一记短促的低频体鸣表现重量，
   * 一段带通噪声表现鞋底下的砂砾，再为甲胄叠上
   * 一缕挽具与板甲的金属余响。完全合成，所以一整个
   * 行军不费任何流量，且精确落在步伐时钟请求的那一帧。
   */
  footstep(options: FootstepOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const timbre = options.timbre ?? "scuff";
    const voice = FOOTSTEP_VOICES[timbre];
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const jitter = 1 + (options.jitter ?? (Math.random() - 0.5) * 0.16);
    const level = 0.42 * voice.level * (options.volume ?? 1);

    const bus = ctx.createGain();
    bus.gain.value = level;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0)) * 0.6;
      bus.connect(panner);
      panner.connect(this.master);
    } else {
      bus.connect(this.master);
    }

    // 重量透过鞋底砸进地板。
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(voice.body * jitter, when);
    thump.frequency.exponentialRampToValueAtTime(voice.body * 0.55 * jitter, when + voice.decay);
    thumpGain.gain.setValueAtTime(0.0001, when);
    thumpGain.gain.exponentialRampToValueAtTime(voice.weight, when + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + voice.decay);
    thump.connect(thumpGain);
    thumpGain.connect(bus);
    thump.start(when);
    thump.stop(when + voice.decay + 0.05);

    // 砂砾与皮革：由鞋底材质塑形的快速噪声瞬态。
    const length = Math.max(1, Math.floor(ctx.sampleRate * voice.scuff));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, voice.grit);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = voice.noise * jitter;
    band.Q.value = voice.q;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = voice.hiss;
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);

    // 挽具、锁子甲与胫甲应声而动。
    if (voice.ring > 0) {
      const ring = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ring.type = "triangle";
      ring.frequency.setValueAtTime(voice.ringHz * jitter, when);
      ringGain.gain.setValueAtTime(0.0001, when + 0.008);
      ringGain.gain.exponentialRampToValueAtTime(voice.ring, when + 0.016);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      ring.connect(ringGain);
      ringGain.connect(bus);
      ring.start(when);
      ring.stop(when + 0.2);
    }
  }

  /**
   * 火焰在法杖顶端汇聚：两个失谐锯齿声部在一段随蓄力
   * 逐渐张开的噪声带下爬升一个八度，让耳朵在法弹飞出
   * 之前就听到力量正在被拉进来。
   */
  spellCharge(options: SpellOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const span = Math.max(0.18, options.duration ?? 0.5);
    const level = 0.2 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.6);

    for (const detune of [1, 1.008, 0.5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = detune === 0.5 ? "triangle" : "sawtooth";
      osc.frequency.setValueAtTime(96 * detune, when);
      osc.frequency.exponentialRampToValueAtTime(340 * detune, when + span);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level * (detune === 0.5 ? 0.7 : 1), when + span * 0.92);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.06);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + span + 0.12);
    }

    // 空气被拖入水晶的声音。
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(span + 0.1, 0.35);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(420, when);
    band.frequency.exponentialRampToValueAtTime(2600, when + span);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.exponentialRampToValueAtTime(level * 1.5, when + span * 0.95);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.08);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);
  }

  /** 法弹离杖：一记明亮的脆响，接一段下坠的呼啸。 */
  spellCast(options: SpellOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.42 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.7);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.42, 1.6);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(3200, when);
    band.frequency.exponentialRampToValueAtTime(380, when + 0.36);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(level, when);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(when);

    // 脱手时的后坐。
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(220, when);
    thump.frequency.exponentialRampToValueAtTime(58, when + 0.24);
    thumpGain.gain.setValueAtTime(0.0001, when);
    thumpGain.gain.exponentialRampToValueAtTime(level * 0.7, when + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
    thump.connect(thumpGain);
    thumpGain.connect(bus);
    thump.start(when);
    thump.stop(when + 0.36);
  }

  /**
   * 法弹命中躯体：一记硬脆的炸响，底下一段渐渐沉去的
   * 低频轰隆，以及火焰吞噬残余的长长噼啪。
   */
  spellImpact(options: SpellOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.5 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.45);

    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = "sine";
    boom.frequency.setValueAtTime(140, when);
    boom.frequency.exponentialRampToValueAtTime(32, when + 0.5);
    boomGain.gain.setValueAtTime(0.0001, when);
    boomGain.gain.exponentialRampToValueAtTime(level, when + 0.008);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
    boom.connect(boomGain);
    boomGain.connect(bus);
    boom.start(when);
    boom.stop(when + 0.7);

    // 外壳破开的炸响。
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.12, 5);
    const snap = ctx.createBiquadFilter();
    snap.type = "highpass";
    snap.frequency.value = 1400;
    const crackGain = ctx.createGain();
    crackGain.gain.value = level * 0.55;
    crack.connect(snap);
    snap.connect(crackGain);
    crackGain.connect(bus);
    crack.start(when);

    // 留在石板上继续燃烧的火焰。
    const fire = ctx.createBufferSource();
    fire.buffer = this.noiseBuffer(0.85, 1.1);
    const body = ctx.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.setValueAtTime(2600, when);
    body.frequency.exponentialRampToValueAtTime(520, when + 0.8);
    const fireGain = ctx.createGain();
    fireGain.gain.setValueAtTime(level * 0.5, when + 0.02);
    fireGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    fire.connect(body);
    body.connect(fireGain);
    fireGain.connect(bus);
    fire.start(when);
  }

  /**
   * 钢铁破空：挥击抡圆时一段向下扫掠的噪声带，
   * 凡重到足以带动重心的兵器，下面再垫一阵低吼。
   * `weight` 从轻刃一路覆盖到双手攻城锤。
   */
  bladeWhoosh(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.5));
    const level = 0.3 * (options.volume ?? 1);
    const span = 0.22 + weight * 0.16;
    const bus = this.spellBus(options.pan ?? 0, 0.55);

    // 被劈开的空气。越重的兵器扫过的频段越低、越长。
    const air = ctx.createBufferSource();
    air.buffer = this.noiseBuffer(span + 0.08, 1.4);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.1 + weight * 0.6;
    band.frequency.setValueAtTime(2600 - weight * 900, when);
    band.frequency.exponentialRampToValueAtTime(380 - weight * 180, when + span);
    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0001, when);
    airGain.gain.exponentialRampToValueAtTime(level, when + span * 0.62);
    airGain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.06);
    air.connect(band);
    band.connect(airGain);
    airGain.connect(bus);
    air.start(when);

    if (weight <= 0.2) return;
    // 被抡圆的质量：拖在挥击之后的一阵短促低吼。
    const gust = ctx.createOscillator();
    const gustGain = ctx.createGain();
    gust.type = "sine";
    gust.frequency.setValueAtTime(150 - weight * 60, when + span * 0.3);
    gust.frequency.exponentialRampToValueAtTime(62 - weight * 18, when + span);
    gustGain.gain.setValueAtTime(0.0001, when + span * 0.3);
    gustGain.gain.exponentialRampToValueAtTime(level * 0.55 * weight, when + span * 0.55);
    gustGain.gain.exponentialRampToValueAtTime(0.0001, when + span + 0.1);
    gust.connect(gustGain);
    gustGain.connect(bus);
    gust.start(when + span * 0.28);
    gust.stop(when + span + 0.16);
  }

  /**
   * 穿透躯体、砸进地板的一击：一段次低音下坠，
   * 石头让路的崩裂声，以及碎石落定的尾声。
   * 高塔守卫与王冠才会留下的动静 —— 步兵永远没有。
   */
  groundSlam(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.46 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.4);

    // 地板承受这一击。
    for (const [start, end, gain, span] of [
      [96, 26, 1, 0.62],
      [58, 19, 0.55, 0.9],
    ] as const) {
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(start, when);
      sub.frequency.exponentialRampToValueAtTime(end, when + span);
      subGain.gain.setValueAtTime(0.0001, when);
      subGain.gain.exponentialRampToValueAtTime(level * gain, when + 0.012);
      subGain.gain.exponentialRampToValueAtTime(0.0001, when + span);
      sub.connect(subGain);
      subGain.connect(bus);
      sub.start(when);
      sub.stop(when + span + 0.08);
    }

    // 石头在武器头下绽裂。
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.16, 4.5);
    const shape = ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.Q.value = 0.7;
    shape.frequency.setValueAtTime(900, when);
    shape.frequency.exponentialRampToValueAtTime(240, when + 0.15);
    const crackGain = ctx.createGain();
    crackGain.gain.value = level * 0.7;
    crack.connect(shape);
    shape.connect(crackGain);
    crackGain.connect(bus);
    crack.start(when);

    // 砂砾与崩屑纷纷落回。
    const rubble = ctx.createBufferSource();
    rubble.buffer = this.noiseBuffer(0.55, 2.2);
    const grit = ctx.createBiquadFilter();
    grit.type = "highpass";
    grit.frequency.value = 1800;
    const rubbleGain = ctx.createGain();
    rubbleGain.gain.setValueAtTime(0.0001, when + 0.05);
    rubbleGain.gain.exponentialRampToValueAtTime(level * 0.3, when + 0.1);
    rubbleGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
    rubble.connect(grit);
    grit.connect(rubbleGain);
    rubbleGain.connect(bus);
    rubble.start(when + 0.04);

    this.duckBeds(0.7, 0.7);
  }

  /**
   * 宣判之音：由不谐和泛音构成的一记击钟，
   * 底下垫着缓慢荡开的气流。只有王冠才敲得响它。
   */
  judgementToll(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const level = 0.26 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.35);
    const root = 196;

    // 真正的钟不是谐波序列 —— 正是这些比例让它听起来像金属。
    const partials: { ratio: number; gain: number; decay: number }[] = [
      { ratio: 0.5, gain: 0.7, decay: 2.6 },
      { ratio: 1, gain: 1, decay: 2.2 },
      { ratio: 2.02, gain: 0.5, decay: 1.6 },
      { ratio: 2.98, gain: 0.28, decay: 1.1 },
      { ratio: 4.07, gain: 0.15, decay: 0.7 },
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = root * partial.ratio;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level * partial.gain, when + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + partial.decay);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(when);
      osc.stop(when + partial.decay + 0.1);
    }

    // 气流绕着光芒被卷起。
    const swell = ctx.createBufferSource();
    swell.buffer = this.noiseBuffer(0.9, 0.6);
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.Q.value = 0.8;
    body.frequency.setValueAtTime(520, when);
    body.frequency.exponentialRampToValueAtTime(2200, when + 0.7);
    const swellGain = ctx.createGain();
    swellGain.gain.setValueAtTime(0.0001, when);
    swellGain.gain.exponentialRampToValueAtTime(level * 0.55, when + 0.5);
    swellGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.95);
    swell.connect(body);
    body.connect(swellGain);
    swellGain.connect(bus);
    swell.start(when);

    this.duckBeds(0.6, 1.1);
  }

  /**
   * 黑火药爆发。一条声线按 `calibre`（口径）覆盖全军：
   *
   * - `0` —— 军官的燧发手枪：一声干亮的脆响，转瞬即逝。
   * - `0.5` —— 夏勒维尔火枪：更硬的脆响，下面垫一记
   *   短促的胸腔闷击。
   * - `1` —— 野战炮：脆响被埋在次低音重锤之下，
   *   沿厅堂滚远，炮声从远端墙面反弹回来。
   *
   * 合成的那一半从不等待下载，所以即使录音仍在流入，
   * 齐射也永远准时打响。
   */
  gunshot(options: GunSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const calibre = Math.max(0, Math.min(1, options.weight ?? 0.5));
    // 录音枪管扛起爆响；合成声线随后只需补足底下的
    // 重量，两者永远不会互相打架。
    const mix = options.voice !== undefined ? SHOT_VOICES[options.voice] : null;
    const recorded =
      options.voice !== undefined &&
      mix !== null &&
      this.playTake(GUN_AUDIO_URLS[options.voice], {
        pan: options.pan,
        volume: mix.take * (0.9 + calibre * 0.25) * (options.volume ?? 1),
        delay: options.delay,
        // 一点点失谐，让齐射永不逐字重复同一段录音。
        // 幅度压得很小：大的变速会把瞬态拖离扳机扣下的
        // 那一帧，而这正是绝不能发生的事。
        rate: 0.98 + Math.random() * 0.045,
      });
    const level = (0.34 + calibre * 0.3) * (options.volume ?? 1) * (recorded && mix ? mix.synth : 1);
    const bus = this.spellBus(options.pan ?? 0, 0.5);

    // 爆响本身：一段极短、极响的噪声爆发，
    // 口径越大，滤波压得越低。
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer(0.09 + calibre * 0.14, 5.5 - calibre * 2.6);
    const shape = ctx.createBiquadFilter();
    shape.type = "bandpass";
    shape.Q.value = 0.55;
    shape.frequency.setValueAtTime(3400 - calibre * 2200, when);
    shape.frequency.exponentialRampToValueAtTime(520 - calibre * 340, when + 0.09 + calibre * 0.1);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(level * 1.15, when);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12 + calibre * 0.16);
    crack.connect(shape);
    shape.connect(crackGain);
    crackGain.connect(bus);
    crack.start(when);

    // 垫在爆响之下的装药冲击。手枪几乎没有；大炮几乎全是闷击。
    const punch = ctx.createOscillator();
    const punchGain = ctx.createGain();
    const span = 0.16 + calibre * 0.6;
    punch.type = "sine";
    punch.frequency.setValueAtTime(220 - calibre * 130, when);
    punch.frequency.exponentialRampToValueAtTime(52 - calibre * 26, when + span);
    punchGain.gain.setValueAtTime(0.0001, when);
    punchGain.gain.exponentialRampToValueAtTime(level * (0.5 + calibre * 0.9), when + 0.012);
    punchGain.gain.exponentialRampToValueAtTime(0.0001, when + span);
    punch.connect(punchGain);
    punchGain.connect(bus);
    punch.start(when);
    punch.stop(when + span + 0.1);

    // 火药烟与炮塞：拖在枪声之后的一缕轻嘶。
    const smoke = ctx.createBufferSource();
    smoke.buffer = this.noiseBuffer(0.4 + calibre * 0.5, 1.8);
    const air = ctx.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = 2400 - calibre * 900;
    const smokeGain = ctx.createGain();
    smokeGain.gain.setValueAtTime(0.0001, when + 0.02);
    smokeGain.gain.exponentialRampToValueAtTime(level * 0.22, when + 0.07);
    smokeGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.45 + calibre * 0.4);
    smoke.connect(air);
    air.connect(smokeGain);
    smokeGain.connect(bus);
    smoke.start(when + 0.02);

    // 只有大炮才大到配得上厅堂的回应。录音火炮自带回声，
    // 再加合成的回声只会把它糊掉。
    if (calibre > 0.6 && !recorded) {
      const echo = ctx.createBufferSource();
      echo.buffer = this.noiseBuffer(0.7, 1.2);
      const walls = ctx.createBiquadFilter();
      walls.type = "bandpass";
      walls.Q.value = 0.4;
      walls.frequency.value = 420;
      const echoGain = ctx.createGain();
      echoGain.gain.setValueAtTime(0.0001, when + 0.14);
      echoGain.gain.exponentialRampToValueAtTime(level * 0.3, when + 0.22);
      echoGain.gain.exponentialRampToValueAtTime(0.0001, when + 1.05);
      echo.connect(walls);
      walls.connect(echoGain);
      echoGain.connect(bus);
      echo.start(when + 0.13);
    }

    this.duckBeds(0.78 - calibre * 0.2, 0.5 + calibre * 0.7);
  }

  /**
   * 射击前的操典动作：击锤被扳起、通条探入枪管、
   * 火绳杆碰在炮身上的轻响。一组细小、干燥的机械
   * 咔嗒声，让蓄势听起来像火器而不是法术。
   *
   * @param options `weight` 0 是手枪枪机，1 是野战炮上的铁件
   */
  gunLock(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
    const level = 0.2 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.45);

    for (const step of [0, 0.07 + weight * 0.05]) {
      const tick = ctx.createBufferSource();
      tick.buffer = this.noiseBuffer(0.05, 7);
      const metal = ctx.createBiquadFilter();
      metal.type = "bandpass";
      metal.Q.value = 5 + weight * 4;
      metal.frequency.value = 2600 - weight * 1200 + (step > 0 ? 380 : 0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level * (step > 0 ? 0.75 : 1), when + step);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + step + 0.07);
      tick.connect(metal);
      metal.connect(gain);
      gain.connect(bus);
      tick.start(when + step);
    }
  }

  /**
   * 扳机扣下，引药在其后点燃。
   *
   * 前装枪不会在手指动的一瞬间就打响。阻铁脱开、
   * 燧石刮过火镰、药池闪燃，枪管里的主装药才
   * 跟着点燃 —— 燧发枪上要晚四十到七十毫秒，
   * 用点火杆点的火炮则更久。这段间隙就是枪机延迟，
   * 也是真实的枪声听起来像*两个*事件而非一个的
   * 原因：先一声小而干的机械响，然后才是爆响。
   *
   * 本方法是两者中的第一个。它在扣扳机的那一帧播放；
   * {@link gunshot} 落后一个枪机延迟，在画出枪口焰的
   * 那一帧跟上。没有它，耳朵只能听到爆响，
   * 手指动的那一刻就听不见了。
   *
   * @param options `weight` 0 是手枪枪机，1 是野战炮的火门
   */
  triggerPull(options: StrikeSoundOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
    const level = 0.16 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.5);
    // 大炮不是端在手里打的：它在火门处被点燃，
    // 所以是铁件加导火索，而不是阻铁加弹簧。
    const gun = weight > 0.75;

    // 阻铁脱开：整段节拍中最短、最干的声音。
    const sear = ctx.createBufferSource();
    sear.buffer = this.noiseBuffer(0.018, 9);
    const snap = ctx.createBiquadFilter();
    snap.type = "bandpass";
    snap.Q.value = 6.5;
    snap.frequency.value = gun ? 1500 : 4300 - weight * 1100;
    const searGain = ctx.createGain();
    searGain.gain.setValueAtTime(level * (gun ? 1.2 : 0.9), when);
    searGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    sear.connect(snap);
    snap.connect(searGain);
    searGain.connect(bus);
    sear.start(when);

    // 燧石刮过火镰 —— 仅限轻型火器。一段极短而明亮的
    // 刮擦，随击锤挥过而下滑。
    if (!gun) {
      const scrape = ctx.createBufferSource();
      scrape.buffer = this.noiseBuffer(0.026, 2.2);
      const steel = ctx.createBiquadFilter();
      steel.type = "bandpass";
      steel.Q.value = 1.6;
      steel.frequency.setValueAtTime(6200, when + 0.004);
      steel.frequency.exponentialRampToValueAtTime(2800, when + 0.03);
      const scrapeGain = ctx.createGain();
      scrapeGain.gain.setValueAtTime(0.0001, when + 0.004);
      scrapeGain.gain.exponentialRampToValueAtTime(level * 0.55, when + 0.009);
      scrapeGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.032);
      scrape.connect(steel);
      steel.connect(scrapeGain);
      scrapeGain.connect(bus);
      scrape.start(when + 0.004);
    }

    // 引药点燃：一缕细嘶一路烧到爆响跟前，
    // 让两者听作同一串事件，而不是两个独立的声音。
    // 大炮的导火索比药池里闪燃的火药烧得更低、更久。
    const flash = ctx.createBufferSource();
    const span = gun ? 0.075 : 0.03;
    flash.buffer = this.noiseBuffer(span + 0.01, 0.7);
    const air = ctx.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = gun ? 1700 : 3100;
    const flashGain = ctx.createGain();
    flashGain.gain.setValueAtTime(0.0001, when + 0.008);
    flashGain.gain.exponentialRampToValueAtTime(level * (gun ? 0.7 : 0.5), when + 0.008 + span * 0.7);
    flashGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.012 + span);
    flash.connect(air);
    air.connect(flashGain);
    flashGain.connect(bus);
    flash.start(when + 0.008);
  }

  /**
   * 弹丸命中：一段录音的跳弹啸音，被没入躯体的闷响
   * 截断。录音流入完成前保持静默（并在后台预热），
   * 因为吃子命中本身已有合成的重量垫底。
   */
  ballImpact(options: StrikeSoundOptions = {}): void {
    this.playTake(GUN_AUDIO_URLS.impact, {
      pan: options.pan,
      volume: 0.85 * (options.volume ?? 1),
      delay: options.delay,
      rate: 0.95 + Math.random() * 0.1,
    });
  }

  /**
   * 从敌人手中夺下一格 —— 整个游戏里唯一意味着*征服*
   * 而非暴力的声音，在胜者的靴子踏上刚清出的那格瓷砖
   * 的一帧播放。
   *
   * 三层，按耳朵应当接收的顺序：
   *
   * 1. **靴子宣示石板主权。** 一声干砂砾瞬态压在一记
   *    低沉跺脚之上 —— 重量被从容放下，而非躯体倒落。
   * 2. **宣示本身。** 一段短小的铜管动机，上行纯五度
   *    （吃掉大件时顶部再加一个八度），每个音都从略低于
   *    音高处滑入，滤波器在起音处张开。这就是标志：
   *    两个音，上行，它永远只意味着一件事。
   * 3. **军旗插下。** 两个高频不谐和泛音在顶部鸣响
   *    片刻，让整体衰减进金属而不是戛然而止。
   *
   * 这里没有任何下载内容，所以即使在冷缓存下，
   * 吃子也在它完成的那一帧被精确标出。
   */
  conquest(options: ConquestOptions = {}): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
    const level = 0.28 * (options.volume ?? 1);
    const bus = this.spellBus(options.pan ?? 0, 0.5);

    // ---- 靴子踏上被夺下的那格 ---------------------------------------
    const heel = ctx.createBufferSource();
    heel.buffer = this.noiseBuffer(0.05, 6);
    const grit = ctx.createBiquadFilter();
    grit.type = "bandpass";
    grit.Q.value = 0.85;
    grit.frequency.value = 1550 - weight * 420;
    const heelGain = ctx.createGain();
    heelGain.gain.value = level * 0.55;
    heel.connect(grit);
    grit.connect(heelGain);
    heelGain.connect(bus);
    heel.start(when);

    const stamp = ctx.createOscillator();
    const stampGain = ctx.createGain();
    stamp.type = "sine";
    stamp.frequency.setValueAtTime(134 - weight * 42, when);
    stamp.frequency.exponentialRampToValueAtTime(48 - weight * 13, when + 0.2);
    stampGain.gain.setValueAtTime(0.0001, when);
    stampGain.gain.exponentialRampToValueAtTime(level * (0.68 + weight * 0.5), when + 0.008);
    stampGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.26 + weight * 0.12);
    stamp.connect(stampGain);
    stampGain.connect(bus);
    stamp.start(when);
    stamp.stop(when + 0.42);

    // ---- 宣示：根音、五度，重杀再加一个八度 -------------------------
    // 吃掉的棋子越大，声音越低、越缓。整个区间内半个八度的
    // 下压让每个兵种都留在同一个动机里，而不是给王后单独
    // 配一首曲子。
    const root = CLAIM_ROOT * Math.pow(2, -weight * 0.5);
    const gap = 0.08 + weight * 0.042;
    const notes: number[] = weight > 0.62 ? [1, 1.5, 2] : [1, 1.5];
    notes.forEach((ratio, index) => {
      const last = index === notes.length - 1;
      const at = when + index * gap;
      const span = last ? 0.42 + weight * 0.36 : gap * 1.6;
      const peak = level * (last ? 0.6 : 0.4);

      // 铜管是滤波器的张开，而不是某种波形：咬感总比
      // 音符本身晚到一瞬。
      const bell = ctx.createBiquadFilter();
      bell.type = "lowpass";
      bell.Q.value = 0.9;
      bell.frequency.setValueAtTime(760, at);
      bell.frequency.exponentialRampToValueAtTime(2900, at + 0.05);
      bell.frequency.exponentialRampToValueAtTime(880, at + span);
      const voice = ctx.createGain();
      voice.gain.setValueAtTime(0.0001, at);
      voice.gain.exponentialRampToValueAtTime(peak, at + 0.022);
      voice.gain.exponentialRampToValueAtTime(0.0001, at + span);
      bell.connect(voice);
      voice.connect(bus);

      for (const detune of [0.996, 1.004]) {
        const brass = ctx.createOscillator();
        brass.type = "sawtooth";
        const pitch = root * ratio * detune;
        // 从下方滑入：号角被用力吹响时的样子。
        brass.frequency.setValueAtTime(pitch * 0.985, at);
        brass.frequency.exponentialRampToValueAtTime(pitch, at + 0.03);
        brass.connect(bell);
        brass.start(at);
        brass.stop(at + span + 0.06);
      }
    });

    // ---- 军旗插下：金属余音在格子上鸣响 ------------------------------
    for (const partial of [
      { ratio: 4.03, gain: 0.14, decay: 0.85 },
      { ratio: 6.11, gain: 0.07, decay: 0.6 },
    ]) {
      const ring = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ring.type = "sine";
      ring.frequency.value = root * partial.ratio;
      ringGain.gain.setValueAtTime(0.0001, when + 0.012);
      ringGain.gain.exponentialRampToValueAtTime(level * partial.gain, when + 0.03);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, when + partial.decay);
      ring.connect(ringGain);
      ringGain.connect(bus);
      ring.start(when + 0.012);
      ring.stop(when + partial.decay + 0.08);
    }

    this.duckBeds(0.76, 0.5 + weight * 0.45);
  }

  /** 各法术声线共用的带声像输入总线。 */
  private spellBus(pan: number, width: number): GainNode {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) throw new Error("mixer not started");
    const bus = ctx.createGain();
    bus.gain.value = 1;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan)) * width;
      bus.connect(panner);
      panner.connect(master);
    } else {
      bus.connect(master);
    }
    return bus;
  }

  /**
   * 指定长度的衰减白噪声。
   *
   * @param falloff 包络指数 —— 1 为均匀淡出，越大爆发越急促
   */
  private noiseBuffer(seconds: number, falloff: number): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error("mixer not started");
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, falloff);
    }
    return buffer;
  }

  /** 合成的 UI 反馈音 —— 廉价、即时、无素材。 */
  blip(kind: "hover" | "press" | "deny" = "press"): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "deny" ? 700 : 2400;

    if (kind === "hover") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.035, now);
    } else if (kind === "press") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.09);
      gain.gain.setValueAtTime(0.09, now);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.16);
      gain.gain.setValueAtTime(0.1, now);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "hover" ? 0.09 : 0.22));
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.35);
  }

  dispose(): void {
    for (const bed of this.beds.values()) bed.source?.stop();
    this.beds.clear();
    this.voices.clear();
    this.voiceLoads.clear();
    this.shots.clear();
    this.shotLoads.clear();
    this.activeVoices = 0;
    this.bedBus = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioManager();
