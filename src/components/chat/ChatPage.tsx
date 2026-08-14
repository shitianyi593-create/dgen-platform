// src/components/chat/ChatPage.tsx
// 两栏：ChatParams | (ChatToolbar / MessageList / ChatComposer)
import ChatParams, { CHAT_PARAMS_DEFAULT_WIDTH } from './ChatParams'
import ChatToolbar from './ChatToolbar'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import ResizeHandle from '../common/ResizeHandle'
import { useResizableWidth } from '../../hooks/useResizableWidth'
import { useChatGeneration } from '../../hooks/useChatGeneration'

const PARAMS_MIN = 240
const PARAMS_MAX = 480

export default function ChatPage() {
  const [paramsWidth, setParamsWidth] = useResizableWidth({
    storageKey: 'chatPage.paramsWidth',
    defaultWidth: CHAT_PARAMS_DEFAULT_WIDTH,
    min: PARAMS_MIN,
    max: PARAMS_MAX,
  })
  const { send, resendLast, stop } = useChatGeneration()

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <ChatParams width={paramsWidth} />
      <ResizeHandle
        side="left"
        ariaLabel="拖拽调整参数栏宽度"
        getCurrentWidth={() => paramsWidth}
        onResize={setParamsWidth}
        resetWidth={CHAT_PARAMS_DEFAULT_WIDTH}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ChatToolbar />
        <MessageList onResendLast={() => void resendLast()} />
        <ChatComposer onSend={(t) => void send(t)} onStop={stop} />
      </div>
    </div>
  )
}
