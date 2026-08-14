// Seedance 2.5 页面壳层 — copy-fork 自 video/VideoGenPage.tsx。
// 差异只有两处：参数栏换成 Video25Params，且共用的 Preview / History
// 必须以 useStore prop 绑 2.5 store（不传就会读到 2.0 的记录与预览）。
// 栏宽用独立的 storage key，两页的拖拽宽度互不影响。
import Video25Params, { VIDEO25_PARAMS_DEFAULT_WIDTH } from './Video25Params'
import VideoPreview from '../video/VideoPreview'
import VideoHistory, { VIDEO_HISTORY_DEFAULT_WIDTH } from '../video/VideoHistory'
import ResizeHandle from '../common/ResizeHandle'
import { useResizableWidth } from '../../hooks/useResizableWidth'
import { useVideo25Store } from '../../stores/video25Store'
import { useOptionalI18n } from '../../i18n/useOptionalI18n'

const PARAMS_MIN = 240
const PARAMS_MAX = 520
const HISTORY_MIN = 220
const HISTORY_MAX = 520

export default function Video25GenPage() {
  const { t } = useOptionalI18n()
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
        ariaLabel={t('video.resize.params')}
        getCurrentWidth={() => paramsWidth}
        onResize={setParamsWidth}
        resetWidth={VIDEO25_PARAMS_DEFAULT_WIDTH}
      />

      {/* Center: Preview */}
      <VideoPreview useStore={useVideo25Store} />

      {/* Right: History */}
      <ResizeHandle
        side="right"
        ariaLabel={t('video.resize.history')}
        getCurrentWidth={() => historyWidth}
        onResize={setHistoryWidth}
        resetWidth={VIDEO_HISTORY_DEFAULT_WIDTH}
      />
      <VideoHistory width={historyWidth} useStore={useVideo25Store} />
    </div>
  )
}
