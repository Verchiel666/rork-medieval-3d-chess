/**
 * 雕塑兵器：大军团的武器，以真实生成的网格呈现。
 *
 * 其他军队的武器都由 `scene/weapons.ts` 里的图元拼成——对一把无人能考证的
 * 奇幻刀剑来说这是正确答案，但对 1800 年就是错误答案：一把 Charleville
 * 滑膛枪、一把 An XI 胸甲骑兵剑、一支燧发手枪都是*有据可查的实物*，用
 * 盒子和圆柱去近似它们，看上去就是玩具。因此拿破仑军队的武器都是生成的
 * 雕塑，而本模块负责把下载到的网格变成可用的手中道具。
 *
 * 难点不在加载——在于生成的武器到来时姿态是任意的。Meshy 交回来的剑躺在
 * 自己包围盒的对角线上（那把胸甲骑兵剑的尺寸是 0.97 x 1.00 x 0.96），
 * 文件里没有任何信息说明刃朝哪边、哪头是尖、扳机护圈在哪一侧。与其为每个
 * 模型目测一个旋转，不如把每件雕塑*测量*出来，拟合进与程序化道具相同的
 * 局部坐标系——长度沿 +Y、柄端在原点、枪机平面在 ±Z：
 *
 *  1. **长轴**取自顶点云的主轴，这样斜放的模型与轴向对齐的模型被
 *     一视同仁地处理。
 *  2. **哪头是尖**由两端的横截面判断：枪口、刺刀尖和剑尖都是细的，
 *     枪托底板和剑柄都是粗的。Marengo 佩剑到来时柄在前、手枪到来时
 *     枪口在前，两者都不需要特判。
 *  3. **滚转**取自剩下两条主轴。剑刃的扁平面横在挥砍方向上（±X，正如
 *     {@link curvedBlade} 所制作的那样）；火器的枪机平面立在枪管自身的
 *     平面内（±Z），扳机护圈一侧的判断方法是问*枪管*在质量的哪一边——
 *     枪托、枪机和护圈都吊在膛线下方，所以细端的质心指向枪的顶部。
 *  4. **正反方向**——即滚转的符号，这是特征向量给不出来的：±窄轴都是
 *     "扁平面朝前"。火器靠枪托来定；刀剑靠*自身弧形的弓腹*来定（见
 *     {@link fitArmSculpt}），因为对军刀来说，这个符号就是军刀与镰刀
 *     的区别。
 *
 * 只有握点和枪口是手工标注的（以武器长度的分数表示），因为没有任何测量
 * 能找到扳机。两者都从每件雕塑的横截面剖面读出，并与它们所替代的
 * 手工道具交叉核对，误差在百分之几以内。
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { ARM_SCULPTS } from "../assets/generated";
import type { Faction } from "../core/types";
import { loadGltf } from "./gltfQueue";
import type { WeaponId } from "./weapons";

/** 雕塑的横截面如何映射到道具自身的轴。 */
export type ArmFamily =
  /** 刃器：剑刃的扁平面横在挥砍方向上。 */
  | "blade"
  /** 枪管类：枪机、枪托和扳机护圈立在枪管的平面内。 */
  | "firearm";

export interface ArmSculptSource {
  /** 生成的 GLB。 */
  url: string;
  /** 柄端到尖的长度，以人形身高计——雕塑要被拟合到的尺寸。 */
  length: number;
  /**
   * 拳头握合的位置，以自柄端向上量取的 {@link length} 的分数表示。
   * 从雕塑的横截面剖面读出：长枪取枪机上方的枪托腕部，刀剑取
   * 柄首与护手之间握柄的中点。
   */
  grip: number;
  /**
   * 枪口，单位与 {@link grip} 相同。刃器省略。在滑膛枪上这是刺刀
   * *套座*而不是刺刀尖——火焰必须离开膛口，而不是离开膛口之外的刀刃。
   */
  muzzle?: number;
  family: ArmFamily;
}

/** 已拟合进道具坐标系的雕塑，随时可以克隆进一只拳头。 */
export interface ArmSculpt {
  /** 准备好的组：柄端在原点、长度沿 +Y、变换已烘焙。 */
  group: THREE.Group;
  /** 握点在道具自身坐标中的高度。 */
  grip: number;
  /** 枪口在道具自身坐标中的高度，刀剑为 null。 */
  muzzle: number | null;
}

/** 一个人形持有的雕塑副本——共享几何体，独立材质。 */
export interface ArmInstance {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
}

/**
 * 雕塑兵器的静置自发光。武器由大厅照明而不是自己发光，所以这个值只高到
 * 足以让 `PieceView.update` 里的选中高亮有东西可以提亮。
 */
const RESTING_EMISSIVE = 0.12;

/** 高亮辉光所用的军队色调，与人形自身的制服色一致。 */
const LIVERY: Record<Faction, number> = { w: 0x223d75, b: 0x611710 };

const loader = new GLTFLoader();
const templates = new Map<WeaponId, ArmSculpt>();
const jobs = new Map<WeaponId, Promise<void>>();

/** 一件武器的雕塑；仍在下载中（或不存在）时为 null。 */
export function armSculpt(id: WeaponId): ArmSculpt | null {
  return templates.get(id) ?? null;
}

/** 这件武器是否有雕塑，无论下载与否。 */
export function hasArmSculpt(id: WeaponId): boolean {
  return ARM_SCULPTS[id] !== undefined;
}

/**
 * 下载并拟合一件雕塑。从不抛错，也绝不会对同一件武器运行两次：失败时
 * {@link armSculpt} 保持 null，人形改用图元武装——一把朴素的滑膛枪
 * 总好过一个手无寸铁的士兵。
 */
export function warmArmSculpt(id: WeaponId): Promise<void> {
  const running = jobs.get(id);
  if (running) return running;
  const source = ARM_SCULPTS[id];
  if (!source) return Promise.resolve();

  const job = (async () => {
    try {
      const gltf = await loadGltf(loader, source.url, 3);
      templates.set(id, fitArmSculpt(gltf.scene, source));
    } catch (error) {
      console.warn(`[armoury] 没有 "${id}" 的雕塑，回退到图元武器`, error);
    }
  })();
  jobs.set(id, job);
  return job;
}

/**
 * 一个人形自己的副本。几何体与纹理与所有持同种武器的人形共享；材质是
 * 克隆的，因为高亮、淡出和溶解都会按人形写入材质。
 */
export function instanceArmSculpt(id: WeaponId, color: Faction): ArmInstance | null {
  const template = templates.get(id);
  if (!template) return null;

  const group = template.group.clone(true);
  const instance: ArmInstance = { group, meshes: [], materials: [] };
  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    const material = source.clone();
    material.emissive = new THREE.Color(LIVERY[color]);
    material.emissiveIntensity = RESTING_EMISSIVE;
    material.envMapIntensity = 1.15;
    mesh.material = material;
    instance.meshes.push(mesh);
    instance.materials.push(material);
  });
  return instance;
}

/** 每件雕塑材质分发时所使用的静置自发光。 */
export function armSculptEmissive(): number {
  return RESTING_EMISSIVE;
}

// ---------------------------------------------------------------- 测量

/** `object` 的每一个顶点，在 `object` 自身的坐标系中。 */
function collectVertices(object: THREE.Object3D): THREE.Vector3[] {
  object.updateMatrixWorld(true);
  const rootInverse = object.matrixWorld.clone().invert();
  const toRoot = new THREE.Matrix4();
  const points: THREE.Vector3[] = [];
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    for (let index = 0; index < position.count; index += 1) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(toRoot));
    }
  });
  return points;
}

/**
 * 用 Jacobi 旋转对角化一个对称 3x3 矩阵。
 *
 * @param m 上三角，形如 [xx, xy, xz, yy, yz, zz]
 * @returns 特征值及其特征向量（以矩阵列的形式）
 */
function jacobiEigen(m: number[]): { values: number[]; vectors: number[][] } {
  const a = [
    [m[0], m[1], m[2]],
    [m[1], m[3], m[4]],
    [m[2], m[4], m[5]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const offDiagonal: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (let sweep = 0; sweep < 32; sweep += 1) {
    let p = 0;
    let q = 1;
    let largest = 0;
    for (const [i, j] of offDiagonal) {
      if (Math.abs(a[i][j]) > largest) {
        largest = Math.abs(a[i][j]);
        p = i;
        q = j;
      }
    }
    if (largest < 1e-14) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // A <- A J，然后 A <- J^T A，然后 V <- V J。
    for (let k = 0; k < 3; k += 1) {
      const ap = a[k][p];
      const aq = a[k][q];
      a[k][p] = c * ap - s * aq;
      a[k][q] = s * ap + c * aq;
    }
    for (let k = 0; k < 3; k += 1) {
      const ap = a[p][k];
      const aq = a[q][k];
      a[p][k] = c * ap - s * aq;
      a[q][k] = s * ap + c * aq;
    }
    for (let k = 0; k < 3; k += 1) {
      const vp = v[k][p];
      const vq = v[k][q];
      v[k][p] = c * vp - s * vq;
      v[k][q] = s * vp + c * vq;
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: v };
}

/**
 * 点云的主轴，延展最长的在前。
 *
 * 包围盒回答不了这个问题：躺在自己包围盒对角线上的剑，三个方向的
 * 跨度几乎相等，根本没有一条长边。
 */
function principalAxes(points: THREE.Vector3[], centre: THREE.Vector3): THREE.Vector3[] {
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  const delta = new THREE.Vector3();
  for (const point of points) {
    delta.copy(point).sub(centre);
    xx += delta.x * delta.x;
    xy += delta.x * delta.y;
    xz += delta.x * delta.z;
    yy += delta.y * delta.y;
    yz += delta.y * delta.z;
    zz += delta.z * delta.z;
  }
  const scale = 1 / Math.max(1, points.length);
  const { values, vectors } = jacobiEigen([xx, xy, xz, yy, yz, zz].map((entry) => entry * scale));
  return values
    .map((value, index) => ({
      value,
      axis: new THREE.Vector3(vectors[0][index], vectors[1][index], vectors[2][index]).normalize(),
    }))
    .sort((first, second) => second.value - first.value)
    .map((entry) => entry.axis);
}

/** 武器沿长度方向每个切片的横截面跨度，柄端在前。 */
function crossSectionProfile(
  projected: { long: number; broad: number; narrow: number }[],
  min: number,
  span: number,
  slices: number,
): number[] {
  const bounds = Array.from({ length: slices }, () => ({
    broad: [Infinity, -Infinity],
    narrow: [Infinity, -Infinity],
  }));
  for (const point of projected) {
    const slot = bounds[Math.min(slices - 1, Math.max(0, Math.floor(((point.long - min) / span) * slices)))];
    slot.broad[0] = Math.min(slot.broad[0], point.broad);
    slot.broad[1] = Math.max(slot.broad[1], point.broad);
    slot.narrow[0] = Math.min(slot.narrow[0], point.narrow);
    slot.narrow[1] = Math.max(slot.narrow[1], point.narrow);
  }
  return bounds.map((slot) =>
    Number.isFinite(slot.broad[0])
      ? Math.max(slot.broad[1] - slot.broad[0], slot.narrow[1] - slot.narrow[0])
      : 0,
  );
}

const SLICES = 18;
/** 比较两端各多少个切片来判断哪头是尖。 */
const END_SLICES = 3;

/**
 * 把一件生成的武器拟合进手工道具所用的坐标系：柄端在原点、长度沿 +Y、
 * 缩放到 `source.length`。
 *
 * 导出给单元测试使用：测试用已知姿态的图元武器喂给它，检查它回来时
 * 方向是否正确。
 */
export function fitArmSculpt(scene: THREE.Object3D, source: ArmSculptSource): ArmSculpt {
  const group = new THREE.Group();
  group.name = "sculpt";
  group.add(scene);

  const points = collectVertices(group);
  if (points.length === 0) throw new Error("sculpt has no geometry");

  const centre = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .multiplyScalar(1 / points.length);
  const [longAxis, broadAxis, narrowAxis] = principalAxes(points, centre);

  const delta = new THREE.Vector3();
  const projected = points.map((point) => {
    delta.copy(point).sub(centre);
    return { long: delta.dot(longAxis), broad: delta.dot(broadAxis), narrow: delta.dot(narrowAxis) };
  });
  let min = Infinity;
  let max = -Infinity;
  for (const point of projected) {
    min = Math.min(min, point.long);
    max = Math.max(max, point.long);
  }
  const span = Math.max(1e-6, max - min);

  // 哪头是尖：细的那头。枪口、刺刀和剑尖都是收细的；
  // 枪托底板、碗形护手和手枪柄都不是。
  const profile = crossSectionProfile(projected, min, span, SLICES);
  const mean = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const lowEnd = mean(profile.slice(0, END_SLICES));
  const highEnd = mean(profile.slice(-END_SLICES));
  // 长轴远端是尖时为 +1，是柄端时为 -1。
  const towardPoint = highEnd <= lowEnd ? 1 : -1;

  const up = longAxis.clone().multiplyScalar(towardPoint);
  let front: THREE.Vector3;
  if (source.family === "firearm") {
    // 滚转从*枪托*读出，而不是从质心。枪的枪托、枪机和扳机护圈都吊在
    // 膛线下方，所以从枪管轴线指向枪托自身质量的那一步指向的是底面——
    // 而底面正是道具坐标系称为 +Z 的一侧（把枪管放平，
    // {@link gunOrientation} 会把它转向地面）。
    //
    // 拿枪口端去对比整个点云的质心，只有在没有别的东西把质心拉离膛线时
    // 才成立。凡尔赛步枪上就有这样的东西：它松弛的背带在枪身侧面荡出
    // 武器长度的 0.34——四倍于步枪自身的横向厚度——把质心拖过了枪管，
    // 导致雕塑被倒装，每个扛着它的人形都把枪护圈朝上、背带在枪管上方
    // 划出一道弧线。
    const bandBroad = (nearest: number, furthest: number): number | null => {
      let total = 0;
      let count = 0;
      for (const point of projected) {
        const fromPoint = (towardPoint > 0 ? max - point.long : point.long - min) / span;
        if (fromPoint < nearest || fromPoint > furthest) continue;
        total += point.broad;
        count += 1;
      }
      return count > 0 ? total / count : null;
    };
    // 膛线：紧邻尖端之后的那一段，在这些武器上都是光溜溜的枪管。
    // 枪托：柄端的四分之一，全是木头和配件。
    const bore = bandBroad(0, 0.16);
    const stock = bandBroad(0.75, 1);
    const underside = bore !== null && stock !== null ? stock - bore : 0;
    if (Math.abs(underside) > 0.004 * span) {
      front = broadAxis.clone().multiplyScalar(Math.sign(underside));
    } else {
      // 剖面上没有可读的偏移（一把德林加手枪、一根光管）：回退到
      // 用枪口端对比质心。
      const barrelBroad = bandBroad(0, 1 / 3) ?? 0;
      front = broadAxis.clone().multiplyScalar(barrelBroad < 0 ? 1 : -1);
    }
  } else {
    // 剑刃的扁平面横在挥砍方向上，所以窄的那条横轴才是朝向人形正面的轴。
    front = narrowAxis.clone();

    // 但两个方向里是哪一边？`narrowAxis` 是特征向量，而特征向量没有符号：
    // ±窄轴都把扁平面横在挥砍方向上，返回哪一个取决于 Jacobi 扫描恰好落在
    // 哪边。对直刃剑这无所谓。对弯刃剑这就是整个剪影——皇帝的仪仗军刀
    // 弓起自身长度的 2.1%，滚转方向错了，刀尖就不再向前挥开，而是弯回
    // 他自己的双角帽上方（在他的骨骼上实测：在 1.70 的人形上，刀尖落在
    // 外 0.80、高 1.68 处，切线在帽冠处开始向内拐）。
    //
    // 所以滚转也像这里的一切一样靠测量：**弧形的弓腹**——凸出的那一侧——
    // 被放到 +X，即 {@link curvedBlade} 挥向的一侧、{@link knuckleBow} 在这些
    // 雕塑所替代的程序化道具中鼓起的一侧。而它在*人形*手上该朝哪边取决于
    // 握它的拳头，属于挂载点的职责，不归这里管（见 `WeaponSpec.edged`）。
    const bladeBand = (from: number, to: number): { broad: number; height: number } | null => {
      let broad = 0;
      let height = 0;
      let count = 0;
      for (const entry of projected) {
        const along = (towardPoint > 0 ? entry.long - min : max - entry.long) / span;
        if (along < from || along > to) continue;
        broad += entry.broad;
        height += along;
        count += 1;
      }
      return count > 0 ? { broad: broad / count, height: height / count } : null;
    };
    // 弓度：刀刃中段偏离从刃根到刀尖这条弦的距离。沿 `broad` 测量，
    // 因为刀刃的弧度位于它的宽度平面内——窄轴是扁平面，这正是它是
    // `front` 的原因。
    const ricasso = bladeBand(0.3, 0.45);
    const middle = bladeBand(0.6, 0.75);
    const point = bladeBand(0.92, 1);
    let belly = 0;
    if (ricasso && middle && point && point.height - ricasso.height > 1e-6) {
      const along = (middle.height - ricasso.height) / (point.height - ricasso.height);
      belly = middle.broad - (ricasso.broad + (point.broad - ricasso.broad) * along);
    }
    // 笔直的宫廷佩剑（Marengo 佩剑只弓起自身长度的 0.03%）没有弧度可读，
    // 于是回退到剑柄自身的凸起：指节护弓——礼仪佩剑唯一能提供的不对称，
    // 而程序化道具把它放在与军刀弓腹相同的一侧。
    if (Math.abs(belly) < 0.005 * span) {
      const hilt = bladeBand(0, 0.25);
      const steel = bladeBand(0.35, 1);
      belly = hilt && steel ? hilt.broad - steel.broad : 0;
    }
    // `up × front` 是 ±broad，所以弓腹在道具自身 X 轴上的符号是精确的，
    // 而非近似。
    const sideways = new THREE.Vector3().crossVectors(up, front).dot(broadAxis);
    if (belly * sideways < 0) front.negate();
  }
  const lateral = new THREE.Vector3().crossVectors(up, front).normalize();

  const basis = new THREE.Matrix4().makeBasis(lateral, up, front);
  // 该基把道具轴映射到模型轴；道具需要的是反方向。
  const rotation = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
  const scale = source.length / span;

  // 柄端落在原点。X/Z 不需要居中：点云是绕自身质心旋转的，
  // 所以武器已经立在自己的轴线上。
  let lowest = Infinity;
  for (const point of points) {
    lowest = Math.min(lowest, delta.copy(point).sub(centre).applyQuaternion(rotation).y * scale);
  }

  group.quaternion.copy(rotation);
  group.scale.setScalar(scale);
  group.position.copy(centre).negate().applyQuaternion(rotation).multiplyScalar(scale);
  group.position.y -= lowest;

  group.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 道具挂在手部骨骼上：绑定姿态的包围盒完全说明不了手臂挥动后
    // 它们会在哪里。
    mesh.frustumCulled = false;
  });

  return {
    group,
    grip: source.grip * source.length,
    muzzle: source.muzzle === undefined ? null : source.muzzle * source.length,
  };
}
