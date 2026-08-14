import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useAssetStore } from '../stores/assetStore'
import ToastProgress from '../components/common/ToastProgress'

/**
 * Subscribes to `assetStore.deleteJob` and `assetStore.uploads` and renders
 * a single react-hot-toast.custom instance per job kind (stable toast id).
 * Each store transition updates the same toast in place rather than
 * spawning a new one, so the user sees a moving progress bar instead of a
 * stack.
 *
 * Replaces the in-page `<DeleteProgressPanel>` and `<UploadProgressPanel>`
 * components from the previous layout (spec §4.3).
 *
 * @param onShowFailDetails Called when the user clicks "查看详情" on a
 *   finished delete job that has at least one failure. The host page is
 *   responsible for opening a modal that lists the failed items + offers
 *   a "重试失败项" action.
 */
export function useAssetJobToasts(onShowFailDetails: () => void) {
  const deleteJob = useAssetStore((s) => s.deleteJob)
  const uploads = useAssetStore((s) => s.uploads)

  // Delete-job toast.
  useEffect(() => {
    const id = 'asset-delete-job'
    if (!deleteJob) {
      toast.dismiss(id)
      return
    }
    const total = deleteJob.total
    const failedCount = deleteJob.failed.length
    const current = deleteJob.succeeded + failedCount

    if (deleteJob.status === 'running') {
      toast.custom(
        () => (
          <ToastProgress
            kind="delete"
            title="删除中"
            current={current}
            total={total}
            status="running"
          />
        ),
        { id, duration: Infinity, position: 'bottom-right' },
      )
      return
    }

    if (deleteJob.status === 'aborted' || failedCount > 0) {
      const subtitle =
        deleteJob.status === 'aborted'
          ? deleteJob.abortReason
          : `成功 ${deleteJob.succeeded}，失败 ${failedCount}`
      toast.custom(
        () => (
          <ToastProgress
            kind="delete"
            title={
              deleteJob.status === 'aborted'
                ? `已中止（${deleteJob.succeeded}/${total}）`
                : `${failedCount} 个失败`
            }
            current={current}
            total={total}
            status="error"
            subtitle={subtitle}
            errorAction={
              failedCount > 0
                ? { label: '查看详情', onClick: onShowFailDetails }
                : undefined
            }
            onDismiss={() => useAssetStore.getState().clearDeleteJob()}
          />
        ),
        { id, duration: Infinity, position: 'bottom-right' },
      )
      return
    }

    // Terminal success (status === 'done' && no failures).
    toast.custom(
      () => (
        <ToastProgress
          kind="delete"
          title={`已删除 ${deleteJob.succeeded} 个`}
          current={total}
          total={total}
          status="success"
          onDismiss={() => useAssetStore.getState().clearDeleteJob()}
        />
      ),
      { id, duration: 4000, position: 'bottom-right' },
    )
  }, [deleteJob, onShowFailDetails])

  // Upload-job toast.
  useEffect(() => {
    const id = 'asset-upload-job'
    if (uploads.length === 0) {
      toast.dismiss(id)
      return
    }
    const done = uploads.filter(
      (u) => u.stage === 'done' || u.stage === 'error',
    ).length
    const total = uploads.length
    toast.custom(
      () => (
        <ToastProgress
          kind="upload"
          title={`上传中（${uploads.length}）`}
          current={done}
          total={total}
          status="running"
        />
      ),
      { id, duration: Infinity, position: 'bottom-right' },
    )
  }, [uploads])
}
