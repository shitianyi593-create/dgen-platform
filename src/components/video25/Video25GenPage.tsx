// Seedance 2.5 頁面殼層 — copy-fork 自 video/VideoGenPage.tsx。
// 差異只有兩處：參數欄換成 Video25Params，且共用的 Preview / History
// 必須以 useStore prop 綁 2.5 store（不傳就會讀到 2.0 的紀錄與預覽）。
// 欄寬用獨立的 storage key，兩頁的拖曳寬度互不影響。
import Video25Params, { VIDEO25_PARAMS_DEFAULT_WIDTH } from './Video25Params'
import VideoPreview from '../video/VideoPreview'
import VideoHistory, { VIDEO_HISTORY_DEFAULT_WIDTH } from '../video/VideoHistory'
import ResizeHandle from '../common/ResizeHandle'
import { useResizableWidth } from '../../hooks/useResizableWidth'
import { useVideo25Store } from '../../stores/video25Store'

const PARAMS_MIN = 240
const PARAMS_MAX = 520
const HISTORY_MIN = 220
const HISTORY_MAX = 520

export default function Video25GenPage() {
  const [paramsWidth, setParamsWidth] = useResizableWidth({
    storageKey: 'video25GenPage.paramsWidth',
    defaultWidth: VIDEO25_PARAMS_DEFAULT_WIDTH,
    min: PARAMS_MIN,
    max: PARAMS_MAX,
  })
  const [historyWidth, setHistoryWidth] = useResizableWidth({
    storageKey: 'video25GenPage.historyWidth',
    defaultWidth: VIDEO_HISTORY_DEFAULT_WIDTH,
    min: HISTORY_MIN,
    max: HISTORY_MAX,
  })

  return (
    <div style={{
      display: 'flex',
      height: '100%',
    }}>
      {/* Left: Parameters */}
      <Video25Params width={paramsWidth} />
      <ResizeHandle
        side="left"
        ariaLabel="拖曳調整參數欄寬度"
        getCurrentWidth={() => paramsWidth}
        onResize={setParamsWidth}
        resetWidth={VIDEO25_PARAMS_DEFAULT_WIDTH}
      />

      {/* Center: Preview */}
      <VideoPreview useStore={useVideo25Store} />

      {/* Right: History */}
      <ResizeHandle
        side="right"
        ariaLabel="拖曳調整任務紀錄寬度"
        getCurrentWidth={() => historyWidth}
        onResize={setHistoryWidth}
        resetWidth={VIDEO_HISTORY_DEFAULT_WIDTH}
      />
      <VideoHistory width={historyWidth} useStore={useVideo25Store} />
    </div>
  )
}
