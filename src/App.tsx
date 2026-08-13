import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import VideoGenPage from './components/video/VideoGenPage'
import Video25GenPage from './components/video25/Video25GenPage'
import ImageGenPage from './components/image/ImageGenPage'
import ChatPage from './components/chat/ChatPage'
import AssetLibraryPage from './components/assets/AssetLibraryPage'
import { useBackgroundPoller } from './hooks/useBackgroundPoller'

function App() {
  // Single mount point for the background polling loop. Every active task
  // in videoStore.activeTaskIds AND video25Store.activeTaskIds (whether
  // created in this session or restored from sessionStorage on refresh)
  // gets polled here.
  useBackgroundPoller()

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/video" element={<VideoGenPage />} />
          <Route path="/video-25" element={<Video25GenPage />} />
          <Route path="/image" element={<ImageGenPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/assets" element={<AssetLibraryPage />} />
          {/* Legacy redirect — preserves any bookmarks that hit /avatar */}
          <Route path="/avatar" element={<Navigate to="/assets" replace />} />
          {/* Catch-all sends everything else (including bookmarks to the
              not-yet-built /voice page) back to /video. */}
          <Route path="*" element={<Navigate to="/video" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
