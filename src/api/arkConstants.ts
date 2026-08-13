/**
 * Single source of truth for the BytePlus ARK endpoint coordinates we send
 * with every signed request. ARK is currently only available in the
 * `ap-southeast-1` region; if BytePlus adds a second region we'll want to
 * make this a per-user setting, but until then keeping it in one file
 * prevents the drift we previously had between asset.ts, verify.ts, and
 * the server-side proxy target.
 */
export const ARK_REGION = 'ap-southeast-1'
export const ARK_SERVICE = 'ark'
export const ARK_OPEN_API_HOST = 'ark.ap-southeast-1.byteplusapi.com'
/** Inference (model invocation) endpoint, used by the server-side proxy. */
export const ARK_INFERENCE_BASE_URL = 'https://ark.ap-southeast.bytepluses.com'
