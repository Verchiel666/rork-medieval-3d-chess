/**
 * 所有拉取 GLB 的模块共用一个下载窗口。
 *
 * 十二套骨骼各有五个剪辑，已超过七十个文件，雕塑手臂
 * 还要再添上一批。一次性全部发起会让浏览器丢弃请求
 * （`TypeError: Failed to fetch`），棋子因此悄悄丢失
 * 攻击与死亡剪辑——吃子时便会完全跳过攻击动画。因此
 * 每次 fetch 都排入一个小窗口，失败时重试后才放弃；
 * 而且这个窗口是*全局*的：两个子系统各自礼貌地限制在
 * 四个下载，叠加起来仍会突发八个。
 */

import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type LoadedGltf = Awaited<ReturnType<GLTFLoader["loadAsync"]>>;

const MAX_PARALLEL_DOWNLOADS = 4;

let activeDownloads = 0;
const downloadQueue: (() => void)[] = [];

export async function withDownloadSlot<T>(job: () => Promise<T>): Promise<T> {
  while (activeDownloads >= MAX_PARALLEL_DOWNLOADS) {
    await new Promise<void>((resolve) => downloadQueue.push(resolve));
  }
  activeDownloads += 1;
  try {
    return await job();
  } finally {
    activeDownloads -= 1;
    downloadQueue.shift()?.();
  }
}

/** 带指数退避的排队 GLB 拉取——瞬时失败会被重试。 */
export async function loadGltf(
  loader: GLTFLoader,
  url: string,
  attempts = 4,
): Promise<LoadedGltf> {
  let last: unknown = new Error(`could not load ${url}`);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withDownloadSlot(() => loader.loadAsync(url));
    } catch (error) {
      last = error;
      if (attempt === attempts - 1) break;
      // 加入抖动的退避，避免整支军队在同一帧上重试。
      const delay = 240 * 2 ** attempt + Math.random() * 200;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}
