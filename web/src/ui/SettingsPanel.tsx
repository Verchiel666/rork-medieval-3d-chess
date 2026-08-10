import { X } from "lucide-react";

import type { ArmySkinId } from "../assets/generated";
import type { Faction } from "../core/types";
import type { ArenaTheme } from "../scene/arena";
import type { QualityPreset } from "../scene/quality";
import { useHasKeyboard } from "./inputMode";
import { MusterLocked, MusterSection } from "./Muster";

export interface GameSettings {
  quality: QualityPreset;
  /** 棋盘搭建在哪张地图上。 */
  arena: ArenaTheme;
  /** 双方各自召集哪支军队。 */
  skins: Record<Faction, ArmySkinId>;
  captureCinematics: boolean;
  rotateBoard: boolean;
  /** 机器还在计时时预排一步棋。 */
  premoves: boolean;
  /** 队列中一次最多叠几步棋。 */
  premoveDepth: number;
  /** 电脑应手耗时的下限，单位毫秒。 */
  thinkFloorMs: number;
  /** 每枚棋子头顶悬浮的军衔纹章。 */
  rankBadges: boolean;
  muted: boolean;
  /**
   * 安全渲染：无合成器、无反射探针、无阴影贴图。这是那些
   * 会把大厅渲染成全黑的驱动（多为 Linux/Mesa 软件光栅器）
   * 的出路。
   */
  safeMode: boolean;
  /** 曝光倍数，0.6–1.8。 */
  brightness: number;
}

interface SettingsPanelProps {
  settings: GameSettings;
  autoDetected: QualityPreset;
  /** 驱动信息行，例如 `llvmpipe · WebGL2 · software`。 */
  gpu: string;
  fps: number;
  /**
   * 棋盘上有对局在进行时为 true。此时军队与战场显示为锁定：
   * 重新点将会换掉激战正酣的每一枚棋子，并在已在移动的
   * 棋子脚下重新搭建大厅。
   */
  matchInProgress: boolean;
  onChange: (settings: GameSettings) => void;
  onClose: () => void;
}

/**
 * 提供给玩家的应手时间下限，单位毫秒。
 *
 * 它不是难度旋钮——改变的只是机器*等待*多久，而非思考多深。
 * 较长下限存在的原因：它是简单难度下演练预排走子的唯一办法，
 * 简单难度的搜索 7 毫秒就结束了。
 */
const THINK_FLOORS: { ms: number; label: string }[] = [
  { ms: 0, label: "即刻" },
  { ms: 420, label: "0.4 秒" },
  { ms: 1500, label: "1.5 秒" },
  { ms: 3000, label: "3 秒" },
  { ms: 6000, label: "6 秒" },
];

/**
 * 提供给玩家的队列深度。
 *
 * 是实测出来的，而非拍脑袋：链首在机器应手中幸存的概率约为
 * 十之六，其后每一环的幸存率其实*更高*，但整条链的存活率
 * 仍在下滑——三步深约 30%，五步约 20%。三是默认值；
 * 一是旧行为，五适合快棋。
 */
const PREMOVE_DEPTHS: { count: number; label: string; note: string }[] = [
  { count: 1, label: "1 步", note: "一次一步" },
  { count: 3, label: "3 步", note: "十条链里约三条完整走完" },
  { count: 5, label: "5 步", note: "快棋专用——十条里约两条走完" },
];

const PRESETS: { key: QualityPreset; label: string; note: string }[] = [
  { key: "low", label: "低", note: "无后处理、无阴影——任何设备都能跑" },
  { key: "medium", label: "中", note: "辉光、阴影、光柱、少量尘埃" },
  { key: "high", label: "高", note: "增加景深、影调、2K 阴影" },
  { key: "ultra", label: "极致", note: "环境光遮蔽、4K 阴影、密集粒子" },
];

export function SettingsPanel({
  settings,
  autoDetected,
  gpu,
  fps,
  matchInProgress,
  onChange,
  onClose,
}: SettingsPanelProps) {
  /** 手机上没有 `F` 可按，所以说明文字点名按钮本身。 */
  const hasKeyboard = useHasKeyboard();
  return (
    <div className="mc-modal-pad pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden bg-black/60 backdrop-blur-sm">
      <div className="mc-slate mc-goldleaf mc-rise flex max-h-full w-full min-h-0 max-w-lg flex-col p-5 sm:p-6">
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="mc-display text-lg text-[#f2e2bd]">设置</h2>
          <button type="button" className="mc-btn mc-icon-btn" onClick={onClose} aria-label="关闭设置">
            <X size={16} />
          </button>
        </div>

        <div className="mc-scroll mc-scroll-shade -mr-2 min-h-0 flex-auto overflow-y-auto pb-1 pr-2">
        {matchInProgress ? (
          <MusterLocked choice={{ skins: settings.skins, arena: settings.arena }} />
        ) : (
          <MusterSection
            choice={{ skins: settings.skins, arena: settings.arena }}
            onChange={(choice) => onChange({ ...settings, skins: choice.skins, arena: choice.arena })}
          />
        )}

        <div className="mc-rule my-5" />

        <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">画质</p>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className="mc-chip py-2.5"
              data-active={settings.quality === preset.key}
              onClick={() => onChange({ ...settings, quality: preset.key })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs italic text-[#9c8b6c]">
          {PRESETS.find((preset) => preset.key === settings.quality)?.note}
        </p>
        <p className="mt-1 text-[0.68rem] text-[#7d6f57]">
          本设备自动检测：<span className="text-[#c8ab74]">{PRESETS.find((preset) => preset.key === autoDetected)?.label ?? autoDetected}</span>
          {fps > 0 ? ` · 当前 ${fps} 帧/秒` : ""}
        </p>
        {gpu ? <p className="mt-0.5 text-[0.68rem] text-[#6d6149]">渲染器：{gpu}</p> : null}

        <div className="mc-rule my-5" />

        <p className="mc-display mb-2 text-[0.6rem] tracking-[0.3em] text-[#a89268]">画面</p>
        <div className="flex items-center gap-3 py-1">
          <span className="mc-display w-24 shrink-0 text-[0.72rem] text-[#efe0c0]">亮度</span>
          <input
            type="range"
            className="mc-slider flex-auto"
            min={0.6}
            max={1.8}
            step={0.05}
            value={settings.brightness}
            onChange={(event) => onChange({ ...settings, brightness: Number(event.target.value) })}
            aria-label="亮度"
          />
          <span className="w-10 shrink-0 text-right text-xs text-[#c8ab74]">
            {Math.round(settings.brightness * 100)}%
          </span>
        </div>
        <Toggle
          label="安全渲染"
          note="用于大厅全黑或无光照的情况——舍弃特效、反射与阴影"
          value={settings.safeMode}
          onChange={(value) => onChange({ ...settings, safeMode: value })}
        />

        <div className="mc-rule my-5" />

        <Toggle
          label="吃子战斗运镜"
          note="镜头冲击、打击、火花与碎裂——不超过 1.5 秒"
          value={settings.captureCinematics}
          onChange={(value) => onChange({ ...settings, captureCinematics: value })}
        />
        <Toggle
          label="回合间转动镜头"
          note={`仅双人轮流对弈——默认关闭；每一步都转半圈运动量太大。随时可${
            hasKeyboard ? "按 F" : "从镜头菜单"
          }手动翻转`}
          value={settings.rotateBoard}
          onChange={(value) => onChange({ ...settings, rotateBoard: value })}
        />
        <Toggle
          label="机器思考时预排走子"
          note={`人机对战——在等待中瞄准棋子，回合一回来它立即落下。点击末格上的 X 可撤销一步${
            hasKeyboard ? "，或按 Esc 清空全部" : ""
          }`}
          value={settings.premoves}
          onChange={(value) => onChange({ ...settings, premoves: value })}
        />
        {settings.premoves ? (
          <div className="py-3">
            <p className="mc-display text-[0.78rem] text-[#efe0c0]">可叠加的步数</p>
            <p className="mb-2 text-xs italic text-[#9c8b6c]">
              每一步瞄准的都是上一步留下的棋盘。若链首死于机器的应手，其后各步一并作废——
              它们是为一个从未出现的局面准备的。
            </p>
            <div className="grid grid-cols-3 gap-2">
              {PREMOVE_DEPTHS.map((depth) => (
                <button
                  key={depth.count}
                  type="button"
                  className="mc-chip flex flex-col gap-0.5 py-2"
                  data-active={settings.premoveDepth === depth.count}
                  onClick={() => onChange({ ...settings, premoveDepth: depth.count })}
                >
                  <span>{depth.label}</span>
                  <span className="text-[0.6rem] normal-case italic opacity-70">{depth.note}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="py-3">
          <p className="mc-display text-[0.78rem] text-[#efe0c0]">电脑的思考时间</p>
          <p className="mb-2 text-xs italic text-[#9c8b6c]">
            这是下限，绝非上限——骑士难度的搜索本身已需约 0.6 秒，战将约 3.1 秒。调大可加宽
            预排走子的窗口；侍从 7 毫秒就应手，在那一档下限<em>本身</em>就是等待。
          </p>
          <div className="grid grid-cols-5 gap-2">
            {THINK_FLOORS.map((floor) => (
              <button
                key={floor.ms}
                type="button"
                className="mc-chip py-2"
                data-active={settings.thinkFloorMs === floor.ms}
                onClick={() => onChange({ ...settings, thinkFloorMs: floor.ms })}
              >
                {floor.label}
              </button>
            ))}
          </div>
        </div>
        <Toggle
          label="棋子头顶军衔纹章"
          note="悬浮的盾牌与日轮徽章，标明每一枚棋子"
          value={settings.rankBadges}
          onChange={(value) => onChange({ ...settings, rankBadges: value })}
        />
        <Toggle
          label="声音"
          note="配乐、环境音与音效"
          value={!settings.muted}
          onChange={(value) => onChange({ ...settings, muted: !value })}
        />
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 border-b border-[#8a652222] py-3 text-left last:border-b-0"
      onClick={() => onChange(!value)}
    >
      <span>
        <span className="mc-display block text-[0.78rem] text-[#efe0c0]">{label}</span>
        <span className="text-xs italic text-[#9c8b6c]">{note}</span>
      </span>
      <span
        className="relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200"
        style={{
          background: value ? "linear-gradient(180deg,#d8b163,#8a6522)" : "rgba(20,18,15,0.8)",
          borderColor: value ? "rgba(246,223,165,0.8)" : "rgba(216,177,99,0.3)",
        }}
      >
        <span
          className="absolute top-0.5 h-4.5 w-4.5 rounded-full bg-[#1a1710] transition-all duration-200"
          style={{ left: value ? "1.55rem" : "0.15rem", width: "1.1rem", height: "1.1rem" }}
        />
      </span>
    </button>
  );
}
