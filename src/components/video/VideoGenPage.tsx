import VideoParams, { VIDEO_PARAMS_DEFAULT_WIDTH } from './VideoParams'
import VideoPreview from './VideoPreview'
import VideoHistory, { VIDEO_HISTORY_DEFAULT_WIDTH } from './VideoHistory'
import ResizeHandle from '../common/ResizeHandle'
import { useResizableWidth } from '../../hooks/useResizableWidth'

const PARAMS_MIN = 240
const PARAMS_MAX = 520
const HISTORY_MIN = 220
const HISTORY_MAX = 520

export default function VideoGenPage() {
  const [paramsWidth, setParamsWidth] = useResizableWidth({
    storageKey: 'videoGenPage.paramsWidth',
    defaultWidth: VIDEO_PARAMS_DEFAULT_WIDTH,
    min: PARAMS_MIN,
    max: PARAMS_MAX,
  })
  const [historyWidth, setHistoryWidth] = useResizableWidth({
    storageKey: 'videoGenPage.historyWidth',
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
      <VideoParams width={paramsWidth} />
      <ResizeHandle
        side="left"
        ariaLabel="拖曳調整參數欄寬度"
        getCurrentWidth={() => paramsWidth}
        onResize={setParamsWidth}
        resetWidth={VIDEO_PARAMS_DEFAULT_WIDTH}
      />

      {/* Center: Preview */}
      <VideoPreview />

      {/* Right: History */}
      <ResizeHandle
        side="right"
        ariaLabel="拖曳調整任務紀錄寬度"
        getCurrentWidth={() => historyWidth}
        onResize={setHistoryWidth}
        resetWidth={VIDEO_HISTORY_DEFAULT_WIDTH}
      />
      <VideoHistory width={historyWidth} />
    </div>
  )
}
