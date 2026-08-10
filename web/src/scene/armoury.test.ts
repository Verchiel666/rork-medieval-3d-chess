import * as THREE from "three";

import { fitArmSculpt, type ArmSculptSource } from "./armoury";

/**
 * 拟合器是军械库里唯一必须在无人查看的情况下也保持正确的部分：生成的
 * 武器到来时姿态任意，拟合错了人形就会握着刺刀端拿枪。这些假模型用来
 * 顶替真实雕塑——用图元拼出已知形状，再像生成器交回真实雕塑那样丢进
 * 一个随机朝向。
 */

/** 一个已拟合道具的每一个顶点，在拳头所见的坐标系中。 */
function vertices(object: THREE.Object3D): THREE.Vector3[] {
  object.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
    }
  });
  return points;
}

/** 武器某一端 `span` 范围内最宽的横截面。 */
function endSpan(points: THREE.Vector3[], from: "bottom" | "top", span: number): number {
  const heights = points.map((point) => point.y);
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  const slice = points.filter((point) =>
    from === "bottom" ? point.y < low + span : point.y > high - span,
  );
  const box = new THREE.Box3().setFromPoints(slice);
  const size = new THREE.Vector3();
  box.getSize(size);
  return Math.max(size.x, size.z);
}

function fitted(scene: THREE.Object3D, source: ArmSculptSource): {
  points: THREE.Vector3[];
  grip: number;
  muzzle: number | null;
} {
  const sculpt = fitArmSculpt(scene, source);
  const holder = new THREE.Group();
  holder.add(sculpt.group);
  return { points: vertices(holder), grip: sculpt.grip, muzzle: sculpt.muzzle };
}

/** 一把剑：细长的渐收剑刃、宽大的护手、短握柄——躺在对角线上。 */
function fakeSword(): THREE.Object3D {
  const group = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.03, 1.2, 4));
  blade.rotation.z = -Math.PI / 2;
  blade.position.set(0.62, 0, 0);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.05));
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.05));
  grip.position.set(-0.1, 0, 0);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6));
  pommel.position.set(-0.2, 0, 0);
  group.add(blade, guard, grip, pommel);
  group.rotation.set(0.4, 0.8, 1.1);
  return group;
}

/**
 * 一把军刀：肥大的剑柄，以及向 +X 扫出的分段刀刃，好让弧形的弓腹落在
 * 已知的一侧——即 `curvedBlade` 所制作的形状。`spin` 是绕自身长度额外
 * 转半圈，正是这个翻转决定窄主轴从特征值求解器里以哪个符号返回。
 */
function fakeSabre(spin: boolean): THREE.Object3D {
  const blade = new THREE.Group();
  let x = 0;
  let y = 0.16;
  for (let index = 0; index < 6; index += 1) {
    const angle = 0.34 * (index / 6);
    const segment = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.014));
    segment.position.set(x, y + 0.08, 0);
    segment.rotation.z = -angle;
    blade.add(segment);
    x += Math.sin(angle) * 0.16;
    y += Math.cos(angle) * 0.16;
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03));
  grip.position.set(0, 0.07, 0);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.04));
  guard.position.set(0, 0.155, 0);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6));
  blade.add(grip, guard, pommel);

  const group = new THREE.Group();
  group.add(blade);
  if (spin) blade.rotation.y = Math.PI;
  // 像生成器交回它们时那样，躺在对角线上返回。
  group.rotation.set(0.5, -1.2, 0.9);
  return group;
}

/** 已拟合刀刃的中段沿 X 偏离自身弦的距离。 */
function bellySide(points: THREE.Vector3[], length: number): number {
  const band = (from: number, to: number): { x: number; y: number } => {
    const slice = points.filter((point) => point.y >= length * from && point.y < length * to);
    const count = Math.max(1, slice.length);
    return {
      x: slice.reduce((sum, point) => sum + point.x, 0) / count,
      y: slice.reduce((sum, point) => sum + point.y, 0) / count,
    };
  };
  const ricasso = band(0.3, 0.45);
  const middle = band(0.6, 0.75);
  const point = band(0.92, 1.01);
  const along = (middle.y - ricasso.y) / (point.y - ricasso.y);
  return middle.x - (ricasso.x + (point.x - ricasso.x) * along);
}

/** 一把长枪：细枪管、深枪托，以及膛线下方的扳机护圈。 */
function fakeMusket(): THREE.Object3D {
  const group = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 1, 8));
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.5, 0, 0);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.05));
  stock.position.set(-0.12, -0.055, 0);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.03));
  guard.position.set(0.04, -0.09, 0);
  group.add(barrel, stock, guard);
  group.rotation.set(0.2, -0.6, 0.9);
  return group;
}

/**
 * 同一把长枪，加上一条松弛的背带——真实的凡尔赛步枪到来时就是这样：
 * 一条皮带远远荡出枪身底侧之外——一件横向厚度只有 0.09 的武器，背带
 * 环出自身长度的 0.34。整个环都在*护圈*一侧，所以会把点云质心拖过
 * 膛线，任何从质心读滚转的测试都会选错边，把枪倒装。
 */
function fakeSlungMusket(): THREE.Object3D {
  const group = new THREE.Group();
  group.add(fakeMusket().children[0]);
  const musket = fakeMusket();
  for (const part of [...musket.children]) group.add(part);
  const sling = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 20, Math.PI * 1.3));
  sling.rotation.set(0, Math.PI / 2, 0.6);
  sling.position.set(0.1, -0.2, 0);
  group.add(sling);
  group.rotation.set(-0.7, 1.4, 0.35);
  return group;
}

describe("fitArmSculpt", () => {
  it("把一把斜放的剑立在柄端、剑尖朝上", () => {
    const source: ArmSculptSource = { url: "", length: 0.72, grip: 0.11, family: "blade" };
    const { points, grip, muzzle } = fitted(fakeSword(), source);
    const heights = points.map((point) => point.y);

    expect(Math.min(...heights)).toBeCloseTo(0, 2);
    expect(Math.max(...heights)).toBeCloseTo(source.length, 2);
    // 剑柄是粗的一端，而它必须是握在拳头里的那一端。
    expect(endSpan(points, "top", 0.07)).toBeLessThan(endSpan(points, "bottom", 0.07));
    expect(grip).toBeCloseTo(0.11 * 0.72, 4);
    expect(muzzle).toBeNull();
  });

  it("让剑刃的扁平面横在挥砍方向上", () => {
    const source: ArmSculptSource = { url: "", length: 0.72, grip: 0.11, family: "blade" };
    const { points } = fitted(fakeSword(), source);
    const blade = points.filter((point) => point.y > 0.3);
    const box = new THREE.Box3().setFromPoints(blade);
    const size = new THREE.Vector3();
    box.getSize(size);
    // 宽度在 X 上、厚度在 Z 上——这是程序化刀刃采用的约定，
    // 这样雕塑军刀挥起来就像手工打造的一样刃口朝前。
    expect(size.x).toBeGreaterThan(size.z);
  });

  it("无论军刀以哪个方向到来，都把弓腹放在 +X", () => {
    const source: ArmSculptSource = { url: "", length: 0.54, grip: 0.11, family: "blade" };
    // 两种朝向下扁平面都横在挥砍方向上，所以特征值求解器可以自由返回
    // 任意符号——而对弯刃来说，那个符号就是整个剪影：弓错了方向，刀尖
    // 就不再向前挥开，而是弯回主人的头顶。拟合必须靠测量来定夺。
    for (const spin of [false, true]) {
      const { points } = fitted(fakeSabre(spin), source);
      expect(bellySide(points, source.length)).toBeGreaterThan(0.004 * source.length);
    }
  });

  it("把长枪放平到枪口朝上、扳机护圈朝前", () => {
    const source: ArmSculptSource = {
      url: "",
      length: 0.86,
      grip: 0.19,
      muzzle: 0.8,
      family: "firearm",
    };
    const { points, grip, muzzle } = fitted(fakeMusket(), source);
    const heights = points.map((point) => point.y);

    expect(Math.min(...heights)).toBeCloseTo(0, 2);
    expect(Math.max(...heights)).toBeCloseTo(source.length, 2);
    expect(grip).toBeCloseTo(0.19 * 0.86, 4);
    expect(muzzle).toBeCloseTo(0.8 * 0.86, 4);

    // 枪管是细的一端，而它必须出在顶部：枪装倒了，人形就是握着
    // 枪口在拿枪。
    expect(endSpan(points, "top", 0.08)).toBeLessThan(endSpan(points, "bottom", 0.08));

    // 还有滚转：枪托和扳机护圈吊在膛线上，所以枪管自身最终必须落在
    // 道具正面之后（-Z）。正是这让护圈朝向人形的正面，也正是
    // `gunOrientation` 所假设的。
    const barrel = points.filter((point) => point.y > source.length * 0.7);
    const barrelZ = barrel.reduce((sum, point) => sum + point.z, 0) / barrel.length;
    expect(barrelZ).toBeLessThan(0);
  });

  it("让带背带的长枪保持正确的朝向", () => {
    const source: ArmSculptSource = {
      url: "",
      length: 0.85,
      grip: 0.3,
      muzzle: 0.985,
      family: "firearm",
    };
    const { points } = fitted(fakeSlungMusket(), source);

    // 无论背带在枪身侧面荡出多远，膛线都保持在枪托上方：
    // 滚转从两者之间的落差读出，而不是从质心读出。
    const bore = points.filter((point) => point.y > source.length * 0.86);
    const stock = points.filter((point) => point.y < source.length * 0.2);
    const meanZ = (slice: THREE.Vector3[]): number =>
      slice.reduce((sum, point) => sum + point.z, 0) / Math.max(1, slice.length);
    expect(meanZ(bore)).toBeLessThan(meanZ(stock));
  });
});
