import { useEffect, useRef, useState } from "react";
import {
  Box,
  Camera,
  ChevronRight,
  Clapperboard,
  Crosshair,
  EyeOff,
  Flag,
  LayoutGrid,
  Maximize,
  Orbit,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  ScrollText,
  Settings as SettingsIcon,
  Skull,
  Swords,
  Timer,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import type { ElapsedState, Faction, GameSnapshot, LedgerMove, PieceKind } from "../core/types";
import type { CameraPreset, ShowcaseCamera } from "../scene/sceneEngine";
import { Crest, Hourglass, pieceGlyph } from "./Heraldry";
import { useHasKeyboard } from "./inputMode";
import { MoveLedger } from "./MoveLedger";
import { Tooltip, type TooltipSide } from "./Tooltip";

interface HudProps {
  snapshot: GameSnapshot;
  muted: boolean;
  fps: number;
  onNewGame: () => void;
  onUndo: () => void;
  onResign: () => void;
  onToggleSound: () => void;
  onFullscreen: () => void;
  onSettings: () => void;
  onCamera: (preset: CameraPreset) => void;
  onFlipCamera: () => void;
  cameraFlipped: boolean;
  tactical: boolean;
  onToggleTactical: () => void;
  onPreviewMove: (move: LedgerMove | null) => void;
  onTogglePause: () => void;
  onDemoSpeed: (speed: number) => void;
  onDemoLoop: (loop: boolean) => void;
  onDemoRestart: () => void;
  showcaseCamera: ShowcaseCamera;
  onShowcaseCamera: (mode: ShowcaseCamera) => void;
  onToggleCinema: () => void;
  /** 双方各自的实时耗时，由战况栏按自己的节拍读取。 */
  getElapsed: () => ElapsedState;
}

const DEMO_SPEEDS: { label: string; value: number }[] = [
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

/** AI 对战的镜头行为，按其在控制栏上出现的顺序排列。 */
const SHOWCASE_CAMERAS: { key: ShowcaseCamera; label: string; hint: string; icon: typeof Camera }[] = [
  { key: "still", label: "固定", hint: "保持一个角度——镜头绝不自行移动", icon: Camera },
  { key: "follow", label: "跟随", hint: "追踪正在行动的棋子，推近战斗", icon: Crosshair },
  { key: "orbit", label: "环绕", hint: "绕棋盘缓缓漂移", icon: Orbit },
];

const DIFFICULTY_SHORT: Record<string, string> = {
  easy: "侍从",
  medium: "骑士",
  hard: "战将",
};

const CAMERA_BUTTONS: { key: CameraPreset; label: string }[] = [
  { key: "white", label: "白曜" },
  { key: "black", label: "黑曜" },
  { key: "top", label: "俯瞰" },
  { key: "cinematic", label: "电影" },
];

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * 耗时的读法与倒计时相反：向下取整，因此第一秒内仪表显示
 * 0:00 而不是直接跳到 0:01；只有当一场战斗真的打到一小时以上，
 * 才会长出小时位。
 */
/**
 * 棋盘旁边是否有空间容纳棋谱。
 *
 * 棋谱同一时间只挂载在一个位置——宽屏时停靠在侧边栏，
 * 窄屏时折叠进左下角面板。如果两处都渲染再用 CSS 隐藏其一，
 * 两个活的棋谱会争夺棋盘预览和滚动钉住状态，因此取舍在 JS 中完成。
 */
function useRoomForRail(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (event: MediaQueryListEvent): void => setWide(event.matches);
    // 初始值已在 useState 初始化器中读取，这里只订阅变化。
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? minutes.toString().padStart(2, "0") : minutes.toString();
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${seconds.toString().padStart(2, "0")}`;
}

export function Hud({
  snapshot,
  muted,
  fps,
  onNewGame,
  onUndo,
  onResign,
  onToggleSound,
  onFullscreen,
  onSettings,
  onCamera,
  onFlipCamera,
  cameraFlipped,
  tactical,
  onToggleTactical,
  onPreviewMove,
  onTogglePause,
  onDemoSpeed,
  onDemoLoop,
  onDemoRestart,
  showcaseCamera,
  onShowcaseCamera,
  onToggleCinema,
  getElapsed,
}: HudProps) {
  const railRoom = useRoomForRail();
  /** 只在真正有键可按的地方才印出按键提示。 */
  const hasKeyboard = useHasKeyboard();
  // 在棋盘旁边，棋谱不占用玩家任何东西，所以从第一步起就保持展开；
  // 在手机上它会盖住棋盘横排，所以在那里保持折叠。
  const [chronicleOpen, setChronicleOpen] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 1024px)").matches,
  );
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [transportOpen, setTransportOpen] = useState(true);
  const [activePreset, setActivePreset] = useState<CameraPreset>(() =>
    snapshot.mode === "ai" && snapshot.playerColor === "b" ? "black" : "white",
  );
  const cameraMenuRef = useRef<HTMLDivElement | null>(null);
  const chronicleRef = useRef<HTMLDivElement | null>(null);

  // 点击外部或按 Escape 关闭镜头菜单，但不在棋盘上铺设
  // 隐形遮罩（那会吃掉下一次棋盘点击）。
  useEffect(() => {
    if (!cameraMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      const node = cameraMenuRef.current;
      if (node && !node.contains(event.target as Node)) setCameraMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setCameraMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [cameraMenuOpen]);

  // 棋谱默认收缩为角落按钮，让棋盘占满整个屏幕。任何位置按
  // Escape 都能关闭；窄屏上展开的面板会盖住棋盘的一大块，
  // 所以点击外部也会把它折回去。
  useEffect(() => {
    if (!chronicleOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setChronicleOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (window.innerWidth >= 1024) return;
      const node = chronicleRef.current;
      if (node && !node.contains(event.target as Node)) setChronicleOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [chronicleOpen]);

  // "H" 键无需伸向角落即可开合棋谱。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "h" && event.key !== "H") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = target ? /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable : false;
      if (typing) return;
      setChronicleOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickCamera = (preset: CameraPreset): void => {
    setActivePreset(preset);
    setCameraMenuOpen(false);
    onCamera(preset);
  };

  const demo = snapshot.demo;
  const whiteTaken = snapshot.captured.filter((piece) => piece.color === "b");
  const blackTaken = snapshot.captured.filter((piece) => piece.color === "w");
  const diff = snapshot.materialDiff;

  const ledger = (
    <MoveLedger
      moves={snapshot.moves}
      pgn={snapshot.pgn}
      result={snapshot.result}
      turn={snapshot.turn}
      thinking={snapshot.thinking}
      playing={snapshot.status === "playing"}
      onPreview={onPreviewMove}
    />
  );

  const spoils = (
    <div className="mc-slate mc-goldleaf px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="mc-display text-[0.6rem] tracking-[0.34em] text-[#a89268]">战果</p>
        <span className="mc-display text-[0.72rem] text-[#e2c98f]">
          {diff === 0 ? "持平" : diff > 0 ? `白曜 +${diff}` : `黑曜 +${-diff}`}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        <CapturedRow label="w" pieces={whiteTaken.map((piece) => piece.kind)} />
        <CapturedRow label="b" pieces={blackTaken.map((piece) => piece.kind)} />
      </div>
    </div>
  );

  return (
    <>
      {/* 顶栏 */}
      {/* 内边距（含刘海/Home 条安全区）定义在 `.mc-hud-top` 中。 */}
      <div className="mc-hud-top pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <div className="mc-hud-status mc-slate mc-goldleaf pointer-events-auto flex items-center gap-3 px-3 py-2.5">
            <Crest faction={snapshot.turn} size={26} active />
            <div>
              <p className="mc-display text-[0.58rem] tracking-[0.3em] text-[#a89268]">
                {demo
                  ? `AI 对战 · 第 ${snapshot.demoRound} 局`
                  : snapshot.status === "over"
                    ? "战斗结束"
                    : snapshot.thinking
                      ? "军议中"
                      : "轮到走子"}
              </p>
              <p className="mc-display text-sm text-[#f2e2bd]">
                {snapshot.status === "over"
                  ? "—"
                  : snapshot.thinking
                    ? "思考中…"
                    : snapshot.turn === "w"
                      ? "白曜"
                      : "黑曜"}
              </p>
            </div>
            {snapshot.inCheck && snapshot.status === "playing" ? (
              <span className="mc-danger-flash mc-display rounded-sm border border-[#a8342a] px-2 py-1 text-[0.6rem] tracking-[0.24em] text-[#ff9a8a]">
                将军
              </span>
            ) : null}
            {snapshot.thinking ? (
              <span className="mc-pulse ml-1 h-2 w-2 rounded-full bg-[#d8b163]" aria-hidden="true" />
            ) : null}
          </div>

          <FieldTally snapshot={snapshot} getElapsed={getElapsed} />
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          {snapshot.clock.enabled ? (
            <div className="mc-slate flex items-center gap-3 px-3 py-1.5">
              <ClockFace
                ms={snapshot.clock.whiteMs}
                initial={snapshot.clock.initialMs}
                active={snapshot.turn === "w" && snapshot.status === "playing"}
                faction="w"
              />
              <div className="h-6 w-px bg-[#8a652244]" />
              <ClockFace
                ms={snapshot.clock.blackMs}
                initial={snapshot.clock.initialMs}
                active={snapshot.turn === "b" && snapshot.status === "playing"}
                faction="b"
              />
            </div>
          ) : null}

          {demo ? (
            <IconButton
              label="纯净录屏"
              hint="隐藏全部界面以便录制——只留棋盘。"
              keys="C"
              onClick={onToggleCinema}
            >
              <EyeOff size={16} />
            </IconButton>
          ) : (
            <>
              <IconButton
                label="悔棋"
                hint={
                  snapshot.canUndo
                    ? "撤销你的上一步以及对方的应手。"
                    : "目前还没有可悔的棋。"
                }
                onClick={onUndo}
                disabled={!snapshot.canUndo}
              >
                <RotateCcw size={16} />
              </IconButton>
              <IconButton
                label="认输"
                hint={
                  snapshot.status === "playing"
                    ? "降下军旗——对方立即获胜。"
                    : "战斗已经结束。"
                }
                onClick={onResign}
                disabled={snapshot.status !== "playing"}
                danger
              >
                <Flag size={16} />
              </IconButton>
            </>
          )}
          <IconButton label="新的一局" hint="放弃本局战斗，重新摆开棋盘。" onClick={onNewGame}>
            <Swords size={16} />
          </IconButton>
          <IconButton
            label={muted ? "音效已关" : "音效已开"}
            hint={muted ? "找回配乐、打击与脚步声。" : "让配乐与全部战斗音效静默。"}
            onClick={onToggleSound}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </IconButton>
          <IconButton label="全屏" hint="让大厅铺满整个屏幕。" onClick={onFullscreen} wideOnly>
            <Maximize size={16} />
          </IconButton>
          <IconButton
            label="翻转阵营"
            hint="镜头旋转 180°，从对面一端观战。"
            keys="F"
            onClick={onFlipCamera}
            active={cameraFlipped}
            wideOnly
          >
            <Repeat size={16} />
          </IconButton>
          <IconButton
            label={tactical ? "返回 3D" : "战术地图"}
            hint={
              tactical
                ? "回到有立体棋子的 3D 大厅。"
                : "平面俯瞰棋盘——每一格一目了然。"
            }
            keys="T"
            onClick={onToggleTactical}
            active={tactical}
          >
            {tactical ? <Box size={16} /> : <LayoutGrid size={16} />}
          </IconButton>

          {/* 镜头视角收在下拉菜单里，棋盘上不悬浮任何东西 */}
          <div className="relative" ref={cameraMenuRef}>
            <IconButton
              label="镜头"
              hint="选择观看战斗的视角。"
              onClick={() => setCameraMenuOpen((open) => !open)}
              active={cameraMenuOpen}
            >
              <Video size={16} />
            </IconButton>
            {cameraMenuOpen ? (
              <div className="mc-cam-menu mc-slate absolute right-0 top-[calc(100%+0.4rem)] z-30 w-44 p-2">
                <p className="mc-display px-1 pb-1.5 text-[0.52rem] tracking-[0.3em] text-[#a89268]">镜头</p>
                <div className="flex flex-col gap-1">
                  {CAMERA_BUTTONS.map((button) => (
                    <button
                      key={button.key}
                      type="button"
                      className="mc-chip w-full text-left"
                      data-active={!tactical && activePreset === button.key}
                      onClick={() => pickCamera(button.key)}
                    >
                      {button.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="mc-chip flex w-full items-center gap-1.5 text-left"
                    data-active={tactical}
                    onClick={() => {
                      setCameraMenuOpen(false);
                      onToggleTactical();
                    }}
                    title={
                      hasKeyboard
                        ? "平面俯瞰地图——没有棋子遮挡（T）"
                        : "平面俯瞰地图——没有棋子遮挡"
                    }
                    aria-pressed={tactical}
                  >
                    <LayoutGrid size={13} />
                    战术 2D
                  </button>
                  <div className="mc-rule my-1 opacity-60" />
                  <button
                    type="button"
                    className="mc-chip mc-chip-flip flex w-full items-center gap-1.5"
                    data-active={cameraFlipped}
                    onClick={onFlipCamera}
                    title={
                      hasKeyboard
                        ? "镜头转向对面一侧（F）"
                        : "镜头转向对面一侧"
                    }
                    aria-pressed={cameraFlipped}
                  >
                    <Repeat
                      size={13}
                      className="mc-flip-icon"
                      style={{ transform: cameraFlipped ? "rotate(180deg)" : "none" }}
                    />
                    翻转 180°
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <IconButton
            label="设置"
            hint="画面、音效、计时与对手强度。"
            onClick={onSettings}
          >
            <SettingsIcon size={16} />
          </IconButton>
        </div>
      </div>

      {/* 侧边栏：战果位于顶栏下方，棋谱沿侧翼其余部分向下延伸，
          贴在棋盘旁边，回看战局不会遮住任何一条横排。仅限桌面与平板。 */}
      <div className="mc-side-rail mc-rise pointer-events-none absolute hidden w-56 flex-col gap-2 lg:flex xl:w-60">
        <div className="pointer-events-auto">{spoils}</div>
        {railRoom && chronicleOpen ? (
          <div className="mc-rail-ledger pointer-events-auto min-h-0 flex-1">{ledger}</div>
        ) : null}
      </div>

      {/* 棋谱：一枚角落小印记，按需展开记录。外层容器保持点击穿透，
          不指向按钮或展开面板的每次点按都仍然属于棋盘。 */}
      <div
        ref={chronicleRef}
        className="mc-hud-corner pointer-events-none absolute bottom-0 left-0 z-30 flex flex-col items-start gap-2"
      >
        {chronicleOpen && !railRoom ? (
          <div className="mc-chronicle-panel pointer-events-auto flex h-[min(56vh,460px)] w-[min(84vw,18.5rem)] flex-col gap-2">
            <div className="min-h-0 flex-1">{ledger}</div>
            <div>{spoils}</div>
          </div>
        ) : null}

        <Tooltip
          label={chronicleOpen ? "收起棋谱" : "棋谱"}
          hint={
            chronicleOpen
              ? railRoom
                ? "把棋谱从侧翼撤下，让大厅占满整个屏幕。"
                : "把棋谱折回角落。"
              : railRoom
                ? "在棋盘旁显示着法记录。"
                : "完整的着法记录与斩获战果。"
          }
          keys="H"
          side="top"
        >
          <button
            type="button"
            className="mc-chronicle-fab pointer-events-auto"
            data-open={chronicleOpen || undefined}
            onClick={() => setChronicleOpen((open) => !open)}
            aria-label="开合棋谱"
            aria-expanded={chronicleOpen}
          >
            {chronicleOpen ? <X size={16} /> : <ScrollText size={16} />}
            {!chronicleOpen && snapshot.moves.length > 0 ? (
              <span key={snapshot.moves.length} className="mc-chronicle-badge">
                {snapshot.moves.length}
              </span>
            ) : null}
          </button>
        </Tooltip>
      </div>

      {/* AI 对战控制栏——一条纤细的控制轨，收在右下角，
          纯图标，可折叠成单枚印记，绝不遮挡棋盘。 */}
      {demo ? (
        <div className="mc-demo-dock pointer-events-auto">
          {transportOpen ? (
            <div className="mc-demo-bar">
              <Tooltip
                label={snapshot.paused ? "继续" : "暂停"}
                hint={snapshot.paused ? "让对局继续推演。" : "将对局冻结在此刻。"}
                keys="空格"
                side="top"
              >
                <button
                  type="button"
                  className="mc-demo-play"
                  data-paused={snapshot.paused || undefined}
                  onClick={onTogglePause}
                  aria-label={snapshot.paused ? "继续 AI 对战" : "暂停 AI 对战"}
                >
                  {snapshot.paused ? <Play size={13} /> : <Pause size={13} />}
                </button>
              </Tooltip>

              <div className="mc-demo-sep" />

              <div className="flex items-center gap-[0.15rem]">
                {DEMO_SPEEDS.map((option) => (
                  <Tooltip key={option.label} label={`速度 ${option.label}`} hint="对局推演的快慢。" side="top">
                    <button
                      type="button"
                      className="mc-chip mc-demo-speed"
                      data-active={demo.speed === option.value}
                      onClick={() => onDemoSpeed(option.value)}
                    >
                      {option.label}
                    </button>
                  </Tooltip>
                ))}
              </div>

              <div className="mc-demo-sep" />

              {/* 镜头行为：对局是用来观赏的，所以拍摄方式与
                  推演速度同等重要。只用图标——文字放在提示里。 */}
              <div className="flex items-center gap-[0.15rem]">
                {SHOWCASE_CAMERAS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <Tooltip key={option.key} label={`镜头：${option.label}`} hint={option.hint} side="top">
                      <button
                        type="button"
                        className="mc-chip mc-demo-icon"
                        data-active={showcaseCamera === option.key}
                        onClick={() => onShowcaseCamera(option.key)}
                        aria-label={`镜头：${option.label}`}
                        aria-pressed={showcaseCamera === option.key}
                      >
                        <Icon size={13} />
                      </button>
                    </Tooltip>
                  );
                })}
              </div>

              <div className="mc-demo-sep" />

              <Tooltip label="循环" hint="本局结束后自动开启新的一局。" side="top">
                <button
                  type="button"
                  className="mc-chip mc-demo-icon"
                  data-active={demo.autoRematch}
                  onClick={() => onDemoLoop(!demo.autoRematch)}
                  aria-label="循环对局"
                  aria-pressed={demo.autoRematch}
                >
                  <Repeat size={13} />
                </button>
              </Tooltip>
              <Tooltip
                label="新的一局"
                hint={`重置棋盘——${DIFFICULTY_SHORT[demo.white] ?? demo.white} vs ${
                  DIFFICULTY_SHORT[demo.black] ?? demo.black
                }。`}
                side="top"
              >
                <button
                  type="button"
                  className="mc-chip mc-demo-icon"
                  onClick={onDemoRestart}
                  aria-label="重新开始对局"
                >
                  <RotateCw size={13} />
                </button>
              </Tooltip>

              <Tooltip label="隐藏控制" hint="把控制栏折叠成单枚印记。" side="left">
                <button
                  type="button"
                  className="mc-demo-fold"
                  onClick={() => setTransportOpen(false)}
                  aria-label="隐藏 AI 对战控制栏"
                >
                  <ChevronRight size={13} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <Tooltip
              label="AI 对战控制"
              hint={`${DIFFICULTY_SHORT[demo.white] ?? demo.white} vs ${
                DIFFICULTY_SHORT[demo.black] ?? demo.black
              }${snapshot.paused ? " — 已暂停" : ""}。速度、镜头与循环。`}
              side="top"
            >
              <button
                type="button"
                className="mc-demo-tab"
                data-paused={snapshot.paused || undefined}
                onClick={() => setTransportOpen(true)}
                aria-label="显示 AI 对战控制栏"
              >
                <Clapperboard size={14} />
              </button>
            </Tooltip>
          )}

          {snapshot.paused ? <span className="mc-demo-flag mc-pulse">已暂停</span> : null}
          {snapshot.status === "over" && demo.autoRematch ? (
            <span className="mc-demo-flag mc-pulse">下一局…</span>
          ) : null}
        </div>
      ) : null}

      {fps > 0 ? (
        <span className="mc-fps pointer-events-none absolute hidden text-[0.62rem] tracking-widest text-[#5f5747] lg:block">
          {fps} FPS
        </span>
      ) : null}
    </>
  );
}

/**
 * 战况统计：每支军队各折损了多少棋子，以及各自在棋盘上
 * 耗时多久。
 *
 * 它按自己的计时器跳动，而不是依赖快照：控制器只在真实事件
 * （走子、暂停）时发布更新，因此这里每过一秒绝不允许
 * 触发整个界面每秒重渲染一次。
 */
function FieldTally({ snapshot, getElapsed }: { snapshot: GameSnapshot; getElapsed: () => ElapsedState }) {
  const running = snapshot.status === "playing" && !snapshot.paused;
  const [elapsed, setElapsed] = useState<ElapsedState>(() => getElapsed());

  // 渲染期调整：回合/运行状态变化时立即同步一次读数，effect 只负责节拍。
  const turnKey = `${running}:${snapshot.turn}:${snapshot.moves.length}`;
  const [prevTurnKey, setPrevTurnKey] = useState(turnKey);
  if (turnKey !== prevTurnKey) {
    setPrevTurnKey(turnKey);
    setElapsed(getElapsed());
  }

  // 半秒节拍，让秒位翻转看不到延迟。
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(getElapsed()), 500);
    return () => clearInterval(id);
  }, [getElapsed, running]);

  const losses: Record<Faction, number> = { w: 0, b: 0 };
  for (const piece of snapshot.captured) losses[piece.color] += 1;

  return (
    <div
      className="mc-tally mc-slate pointer-events-none"
      aria-label={`战况统计。白曜：折损 ${losses.w} 子，在场 ${formatElapsed(elapsed.whiteMs)}。黑曜：折损 ${
        losses.b
      } 子，在场 ${formatElapsed(elapsed.blackMs)}。`}
    >
      <div className="mc-tally-head">
        <span>战况统计</span>
        <span className="mc-tally-total">
          <Timer size={9} strokeWidth={2.4} />
          {formatElapsed(elapsed.totalMs)}
        </span>
      </div>
      <TallyRow
        faction="w"
        lost={losses.w}
        ms={elapsed.whiteMs}
        onMove={running && snapshot.turn === "w"}
      />
      <TallyRow
        faction="b"
        lost={losses.b}
        ms={elapsed.blackMs}
        onMove={running && snapshot.turn === "b"}
      />
    </div>
  );
}

function TallyRow({
  faction,
  lost,
  ms,
  onMove,
}: {
  faction: Faction;
  lost: number;
  ms: number;
  onMove: boolean;
}) {
  return (
    <div className="mc-tally-row" data-faction={faction} data-live={onMove || undefined}>
      <Crest faction={faction} size={12} active={onMove} />
      <span className="mc-tally-name">{faction === "w" ? "白曜" : "黑曜"}</span>
      {/* 以计数为 key，每次新的折损都会让数字闪烁一次。 */}
      <span key={lost} className="mc-tally-lost">
        <Skull size={10} strokeWidth={2.2} />
        {lost}
      </span>
      <span className="mc-tally-time">{formatElapsed(ms)}</span>
    </div>
  );
}

function CapturedRow({ label, pieces }: { label: "w" | "b"; pieces: PieceKind[] }) {
  return (
    <div className="flex items-center gap-2">
      <Crest faction={label} size={14} />
      <div className="flex flex-wrap gap-0.5 text-lg leading-none" style={{ color: label === "w" ? "#f0e3c6" : "#b9838a" }}>
        {pieces.length === 0 ? <span className="text-xs italic text-[#7d6f57]">—</span> : null}
        {pieces.map((kind, index) => (
          <span key={`${kind}-${index}`}>{pieceGlyph(kind)}</span>
        ))}
      </div>
    </div>
  );
}

function ClockFace({
  ms,
  initial,
  active,
  faction,
}: {
  ms: number;
  initial: number;
  active: boolean;
  faction: "w" | "b";
}) {
  const urgent = ms < 30_000;
  return (
    <div className="flex items-center gap-1.5" style={{ opacity: active ? 1 : 0.55 }}>
      <Hourglass ratio={initial > 0 ? ms / initial : 0} urgent={urgent} />
      <div>
        <p className="mc-display text-[0.5rem] tracking-[0.2em] text-[#a89268]">{faction === "w" ? "白曜" : "黑曜"}</p>
        <p className={`mc-display text-sm ${urgent ? "text-[#ff8f7d]" : "text-[#f2e2bd]"}`}>{formatClock(ms)}</p>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  hint,
  keys,
  side = "bottom",
  onClick,
  disabled,
  danger,
  active,
  wideOnly,
}: {
  children: React.ReactNode;
  /** 显示在提示框第一行的短名称，也会被屏幕阅读器朗读。 */
  label: string;
  /** 一句话说明这个控件的作用。 */
  hint?: string;
  /** 键盘快捷键，渲染为键帽样式。 */
  keys?: string;
  side?: TooltipSide;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  /**
   * 在手机上舍弃（该行必须保持单行）：要么控件已在镜头菜单中
   * 重复存在（翻转），要么平台本身就忽略它（iOS 的全屏）。
   */
  wideOnly?: boolean;
}) {
  return (
    <Tooltip label={label} hint={hint} keys={keys} side={side}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        data-active={active ? "true" : undefined}
        data-wide-only={wideOnly ? "true" : undefined}
        className={`mc-btn mc-icon-btn ${danger ? "mc-btn-danger" : ""}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
