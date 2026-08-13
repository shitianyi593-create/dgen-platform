import ImageParams, { IMAGE_PARAMS_DEFAULT_WIDTH } from './ImageParams'
import ImagePreview from './ImagePreview'
import ImageHistory, { IMAGE_HISTORY_DEFAULT_WIDTH } from './ImageHistory'
import ResizeHandle from '../common/ResizeHandle'
import { useResizableWidth } from '../../hooks/useResizableWidth'

const PARAMS_MIN = 240
const PARAMS_MAX = 520
const HISTORY_MIN = 220
const HISTORY_MAX = 520

export default function ImageGenPage() {
  const [paramsWidth, setParamsWidth] = useResizableWidth({
    storageKey: 'imageGenPage.paramsWidth',
    defaultWidth: IMAGE_PARAMS_DEFAULT_WIDTH,
    min: PARAMS_MIN,
    max: PARAMS_MAX,
  })
  const [historyWidth, setHistoryWidth] = useResizableWidth({
    storageKey: 'imageGenPage.historyWidth',
    defaultWidth: IMAGE_HISTORY_DEFAULT_WIDTH,
    min: HISTORY_MIN,
    max: HISTORY_MAX,
  })

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <ImageParams width={paramsWidth} />
      <ResizeHandle
        side="left"
        ariaLabel="拖曳調整參數欄寬度"
        getCurrentWidth={() => paramsWidth}
        onResize={setParamsWidth}
        resetWidth={IMAGE_PARAMS_DEFAULT_WIDTH}
      />
      <ImagePreview />
      <ResizeHandle
        side="right"
        ariaLabel="拖曳調整生成紀錄寬度"
        getCurrentWidth={() => historyWidth}
        onResize={setHistoryWidth}
        resetWidth={IMAGE_HISTORY_DEFAULT_WIDTH}
      />
      <ImageHistory width={historyWidth} />
    </div>
  )
}
