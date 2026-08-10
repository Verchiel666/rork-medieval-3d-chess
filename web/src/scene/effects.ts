import * as THREE from "three";

import { radialTexture, smokeTexture, sparkTexture } from "./textures";

interface Burst {
  points: THREE.Points;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  size: number;
  growth: number;
  drag: number;
}

export interface BurstOptions {
  speed?: number;
  life?: number;
  /** 向下的拉力。负值让微粒像灰烬一样向上飘。 */
  gravity?: number;
  /** 出生点周围的散布半径。 */
  radius?: number;
  /** 起始的点大小。 */
  size?: number;
  /** 生命结束时达到的大小倍率。 */
  growth?: number;
  /** 加到每个微粒上的恒定向上推力。 */
  rise?: number;
  /** 空气阻力；0 表示全程保持初始冲量。 */
  drag?: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  scale: number;
}

/** 一团广告牌烟雾瓣。烟柱就是一小把这种东西。 */
interface Puff {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  spin: number;
  delay: number;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  peak: number;
  buoyancy: number;
}

export interface SmokeOptions {
  /** 烟柱中烟瓣的数量。 */
  count?: number;
  /** 烟瓣散布的半径。 */
  radius?: number;
  /** 初始精灵尺寸。 */
  scale?: number;
  /** 每瓣在生命期内的膨胀程度。 */
  growth?: number;
  life?: number;
  /** 向外的推力。 */
  speed?: number;
  /** 向上的加速度——烟柱向上翻滚的猛烈程度。 */
  rise?: number;
  color?: number;
  opacity?: number;
  /** 加到每瓣上的恒定漂移（风、击退方向）。 */
  drift?: THREE.Vector3;
}

/** 硬性上限，一连串快速吃子永远不可能淹没场景。 */
const MAX_PUFFS = 220;

/**
 * 短暂的战斗特效：尘土、火花与冲击闪光。
 * 一切都池化回场景图，并在拆除时统一释放。
 */
export class EffectsSystem {
  readonly group = new THREE.Group();

  private bursts: Burst[] = [];
  private flashes: Flash[] = [];
  private puffs: Puff[] = [];
  private sparkMap = sparkTexture();
  private flashMap = radialTexture("rgba(255,240,200,0.95)", "rgba(255,150,60,0)");
  private smokeMap = smokeTexture();

  constructor() {
    this.group.name = "effects";
  }

  /** 尘土/余烬喷溅——人形崩碎或一击命中时使用。 */
  spawnBurst(position: THREE.Vector3, color: number, count: number, options?: BurstOptions): void {
    if (count <= 0) return;
    const speed = options?.speed ?? 2.2;
    const life = options?.life ?? 0.9;
    const radius = options?.radius ?? 0;
    const rise = options?.rise ?? 0;
    const size = options?.size ?? 0.13;

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const scatterTheta = Math.random() * Math.PI * 2;
      const scatter = radius * Math.pow(Math.random(), 0.55);
      positions[i * 3] = position.x + Math.cos(scatterTheta) * scatter;
      positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * radius * 1.4;
      positions[i * 3 + 2] = position.z + Math.sin(scatterTheta) * scatter;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9);
      const magnitude = speed * (0.35 + Math.random() * 0.85);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * magnitude;
      velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * magnitude * 1.15 + rise * (0.5 + Math.random());
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * magnitude;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size,
      map: this.sparkMap,
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.group.add(points);
    this.bursts.push({
      points,
      velocities,
      life: 0,
      maxLife: life,
      gravity: options?.gravity ?? 3.4,
      size,
      growth: options?.growth ?? 1.9,
      drag: options?.drag ?? 0,
    });
  }

  /** 命中点上的明亮叠加闪光。 */
  spawnFlash(position: THREE.Vector3, scale = 1.6, life = 0.28): void {
    const material = new THREE.SpriteMaterial({
      map: this.flashMap,
      color: 0xfff0c8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.setScalar(scale * 0.4);
    this.group.add(sprite);
    this.flashes.push({ sprite, life: 0, maxLife: life, scale });
  }

  /**
   * 翻滚的烟柱：柔和的烟瓣一边膨胀、漂移、上升一边淡出。
   * 用于吃子时躯体被吞没/抛飞的画面。
   */
  spawnSmoke(position: THREE.Vector3, options?: SmokeOptions): void {
    const count = Math.max(0, Math.round(options?.count ?? 8));
    if (count <= 0) return;
    const radius = options?.radius ?? 0.3;
    const scale = options?.scale ?? 0.7;
    const growth = options?.growth ?? 2.4;
    const maxLife = options?.life ?? 1.1;
    const speed = options?.speed ?? 0.9;
    const rise = options?.rise ?? 0.7;
    const color = options?.color ?? 0x8b8175;
    const peak = options?.opacity ?? 0.85;
    const drift = options?.drift;

    for (let i = 0; i < count; i += 1) {
      if (this.puffs.length >= MAX_PUFFS) return;
      const theta = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.6);
      const offset = new THREE.Vector3(
        Math.cos(theta) * radius * spread,
        (Math.random() - 0.25) * radius * 0.8,
        Math.sin(theta) * radius * spread,
      );

      const material = new THREE.SpriteMaterial({
        map: this.smokeMap,
        color,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        rotation: Math.random() * Math.PI * 2,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position).add(offset);
      const size = scale * (0.7 + Math.random() * 0.6);
      sprite.scale.setScalar(size);
      sprite.renderOrder = 2;
      this.group.add(sprite);

      const velocity = new THREE.Vector3(offset.x, 0, offset.z)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      velocity.y = speed * (0.2 + Math.random() * 0.4);
      if (drift) velocity.add(drift);

      this.puffs.push({
        sprite,
        velocity,
        spin: (Math.random() - 0.5) * 1.5,
        delay: Math.random() * maxLife * 0.18,
        life: 0,
        maxLife: maxLife * (0.75 + Math.random() * 0.5),
        from: size,
        to: size * growth,
        peak: peak * (0.6 + Math.random() * 0.55),
        buoyancy: rise * (0.7 + Math.random() * 0.6),
      });
    }
  }

  update(delta: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i -= 1) {
      const puff = this.puffs[i];
      if (puff.delay > 0) {
        puff.delay -= delta;
        continue;
      }
      puff.life += delta;
      const t = Math.min(1, puff.life / puff.maxLife);
      // 空气阻力磨掉初始冲量，浮力让它持续攀升。
      const drag = Math.max(0, 1 - delta * 1.6);
      puff.velocity.multiplyScalar(drag);
      puff.velocity.y += puff.buoyancy * delta;
      puff.sprite.position.addScaledVector(puff.velocity, delta);

      const eased = 1 - Math.pow(1 - t, 2.2);
      puff.sprite.scale.setScalar(puff.from + (puff.to - puff.from) * eased);
      const material = puff.sprite.material as THREE.SpriteMaterial;
      // 快速膨胀进来，慢慢稀薄散去。
      const fade = t < 0.16 ? t / 0.16 : Math.pow(1 - (t - 0.16) / 0.84, 1.5);
      material.opacity = Math.max(0, puff.peak * fade);
      material.rotation += puff.spin * delta;

      if (t >= 1) {
        this.group.remove(puff.sprite);
        material.dispose();
        this.puffs.splice(i, 1);
      }
    }

    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      burst.life += delta;
      const t = burst.life / burst.maxLife;
      const attribute = burst.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      const drag = burst.drag > 0 ? Math.max(0, 1 - burst.drag * delta) : 1;
      for (let p = 0; p < burst.velocities.length; p += 3) {
        burst.velocities[p + 1] -= burst.gravity * delta;
        if (drag < 1) {
          burst.velocities[p] *= drag;
          burst.velocities[p + 1] *= drag;
          burst.velocities[p + 2] *= drag;
        }
        array[p] += burst.velocities[p] * delta;
        array[p + 1] += burst.velocities[p + 1] * delta;
        array[p + 2] += burst.velocities[p + 2] * delta;
      }
      attribute.needsUpdate = true;
      const material = burst.points.material as THREE.PointsMaterial;
      material.opacity = Math.max(0, 1 - t);
      material.size = burst.size * (1 + (burst.growth - 1) * t);
      if (t >= 1) {
        this.group.remove(burst.points);
        burst.points.geometry.dispose();
        material.dispose();
        this.bursts.splice(i, 1);
      }
    }

    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const flash = this.flashes[i];
      flash.life += delta;
      const t = flash.life / flash.maxLife;
      const material = flash.sprite.material as THREE.SpriteMaterial;
      material.opacity = Math.max(0, 1 - t);
      flash.sprite.scale.setScalar(flash.scale * (0.4 + t * 1.3));
      if (t >= 1) {
        this.group.remove(flash.sprite);
        material.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const burst of this.bursts) {
      burst.points.geometry.dispose();
      (burst.points.material as THREE.Material).dispose();
    }
    for (const flash of this.flashes) (flash.sprite.material as THREE.Material).dispose();
    for (const puff of this.puffs) (puff.sprite.material as THREE.Material).dispose();
    this.bursts = [];
    this.flashes = [];
    this.puffs = [];
    this.sparkMap.dispose();
    this.flashMap.dispose();
    this.smokeMap.dispose();
    this.group.clear();
  }
}

/**
 * 相机抖动，两条独立衰减的通道。
 *
 * 它们被分开，因为两者所描述的东西手感完全不同。`add` 是一次**冲击**：
 * 火炮、刀刃落下、躯体砸在石面上——高频、转瞬即消。`tremor` 是
 * **轰鸣**：大厅本身在对什么做出反应，所以它是渐渐涌入而不是一上来
 * 就是全幅，慢一个数量级，并且持续到能被*感觉到*而不是被吓一跳。
 * 用 `add` 来驱动警报，读起来就是相机被人打了一拳。
 */
export class ShakeSystem {
  private trauma = 0;
  private elapsed = 0;
  /** 轰鸣振幅，0-1。 */
  private rumble = 0;
  /** 轰鸣消退的速度，振幅/秒。 */
  private rumbleDecay = 1;
  /** 轰鸣上的缓入包络，让它永远不会从硬边开始。 */
  private swell = 0;
  readonly offset = new THREE.Vector3();

  /** 一次打击：尖锐、高频、零点几秒内结束。 */
  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * 一次轰鸣：低频，渐渐涌入，用 `seconds` 秒缓缓滚出。
   * @param amount 峰值振幅，0-1。
   * @param seconds 大致衰减回静止所需的时间。
   */
  tremor(amount: number, seconds = 1): void {
    this.rumble = Math.min(1, Math.max(this.rumble, amount));
    this.rumbleDecay = 1 / Math.max(0.15, seconds);
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.offset.set(0, 0, 0);

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - delta * 1.9);
      const magnitude = this.trauma * this.trauma * 0.32;
      this.offset.set(
        Math.sin(this.elapsed * 47) * magnitude,
        Math.sin(this.elapsed * 61 + 1.3) * magnitude * 0.7,
        Math.sin(this.elapsed * 53 + 2.1) * magnitude,
      );
    }

    if (this.rumble > 0) {
      // 先涨两拍，然后随轰鸣本身一起退出：缓入正是让第一帧
      // 不跳变的东西。
      this.swell = Math.min(1, this.swell + delta * 7);
      this.rumble = Math.max(0, this.rumble - delta * this.rumbleDecay);
      const magnitude = this.rumble * this.swell * 0.075;
      // 缓慢漂移的频率，且以横向为主——是地板在骨骼下移动，
      // 而不是镜头挨了一击。
      this.offset.x += Math.sin(this.elapsed * 11.3) * magnitude;
      this.offset.y += Math.sin(this.elapsed * 8.1 + 0.7) * magnitude * 0.55;
      this.offset.z += Math.sin(this.elapsed * 9.7 + 2.4) * magnitude;
      if (this.rumble <= 0) this.swell = 0;
    }
  }
}
