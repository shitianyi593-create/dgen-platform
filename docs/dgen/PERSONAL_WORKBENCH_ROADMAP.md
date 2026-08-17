# DGen Personal Workbench And Multi-Provider Roadmap

## Goal

Turn DGen into a personal AI creation workbench first, then evolve it into a multi-provider productivity product.

The intended usage model is:

- The app runs locally or on a private machine.
- The owner buys and configures API accounts.
- Creative projects, prompts, generated outputs, and reusable local assets are stored locally by default.
- Cloud object storage is used only when a remote model must fetch large reference media.
- BytePlus becomes one provider implementation, not the core product architecture.

## Difficulty Assessment

The initial personal-workbench version is moderate difficulty, not high difficulty.

Why:

- The current app already has working text, image, video, credential, upload, polling, and history flows.
- Recent persistence work already separated runtime metadata from large media payloads.
- The next step can be incremental: add local project persistence and storage configuration without rewriting model APIs.

The multi-provider product version is higher difficulty.

Why:

- Providers differ in authentication, model names, payload shape, async task model, file upload rules, result URL lifetime, rate limits, and billing behavior.
- Video providers are much less standardized than text providers.
- A clean adapter layer is required before adding many providers.

## Cost Assessment

### Development Cost

Personal workbench:

- Low to moderate.
- Most work is local persistence, file organization, settings UX, and safer credential handling.
- Estimated implementation effort: 1-2 focused weeks for a solid local workbench.

Multi-provider workbench:

- Moderate to high.
- Requires provider abstraction, dynamic model capabilities, dynamic credential schemas, and adapter-specific tests.
- Estimated implementation effort: 3-6 additional weeks depending on provider count and video-model complexity.

Production SaaS:

- High.
- Requires user accounts, server-side credential vaulting, database, storage isolation, billing, audit logs, rate limiting, deployment, monitoring, and support workflows.
- This should be treated as a separate productization phase.

### Runtime Cost

For personal use, ongoing cost should be controllable:

- Local disk: low cost.
- API usage: depends on provider and model. Video generation will dominate cost.
- Cloud object storage: usually low for storage, potentially higher for egress if large videos are frequently downloaded by model providers.
- Database: not needed at first if using local files or SQLite.

Recommended cost-control rules:

- Store all outputs locally after generation.
- Use cloud object storage only for files that must be read by remote models.
- Generate temporary signed URLs with short TTLs.
- Keep a local cache and avoid re-uploading identical reference files.
- Start with a single storage bucket/prefix for personal use.

## Storage Planning

### Local Storage

Local storage should be the default source of truth for a personal workbench.

Recommended directory layout:

```text
~/DGen/
  projects/
    <project-id>/
      project.json
      prompts/
      inputs/
      outputs/
      runs/
  library/
    images/
    videos/
    audio/
  cache/
    uploads/
    thumbnails/
  exports/
```

Recommended local database:

- Start with JSON files for project metadata if speed matters.
- Move to SQLite when project search, filtering, tagging, and large history become important.

Local storage is suitable for:

- Prompts.
- Parameters.
- Task metadata.
- Downloaded final images and videos.
- Local asset library.
- Exports and project archives.

Local storage is not enough when:

- A cloud model must read a local reference video/audio/image.
- A provider requires remote URL input instead of file upload or base64.

### Cloud Object Storage

Cloud object storage should be an optional advanced feature.

Use it for:

- Reference videos.
- Reference audio.
- Large reference images.
- Provider input files that must be fetched by URL.

Supported storage targets to consider:

- BytePlus TOS.
- AWS S3.
- Cloudflare R2.
- MinIO with public or tunnel access.
- Aliyun OSS.
- Tencent COS.

Minimum storage abstraction:

```ts
interface StorageProvider {
  id: string
  name: string
  upload(file: File, options: UploadOptions): Promise<StoredObject>
  signGet(objectKey: string, ttlSeconds: number): Promise<string>
  delete(objectKey: string): Promise<void>
}
```

For personal use, only one storage provider needs to be active at a time.

### Provider Asset Libraries

Vendor asset libraries, such as BytePlus ARK Asset Library, should be optional.

Use them only when:

- The provider requires its own asset IDs.
- The user wants long-term provider-side asset reuse.
- Provider-side moderation or preprocessing is required.

For the personal workbench, do not make vendor asset libraries mandatory. Support direct URL and object-storage references first.

## Do We Still Need Nodes, Regions, Buckets, And Validation?

Not always.

They are not login requirements. They are storage and provider configuration requirements.

Text generation:

- Usually needs only API key, base URL, and model.

Image generation:

- Often needs API key, base URL, and model.
- Some providers also support input images through base64 or file upload.

Video generation:

- Often needs cloud-readable reference media URLs.
- This is where bucket, region, endpoint, and signed URL configuration become useful.

The product should expose this as progressive configuration:

- Basic mode: provider, API key, base URL, model.
- Advanced media mode: storage provider, bucket, region, access key, secret key.
- Vendor asset-library mode: project/account-specific asset credentials.

## Provider Architecture

BytePlus should become a provider plugin.

The app should call provider adapters rather than directly encoding BytePlus-specific behavior in pages.

Recommended interfaces:

```ts
interface ModelProvider {
  id: string
  name: string
  authSchema: CredentialField[]
  models: ModelSpec[]
  capabilities: ProviderCapabilities
  text?: TextAdapter
  image?: ImageAdapter
  video?: VideoAdapter
  assets?: AssetAdapter
}

interface ModelSpec {
  id: string
  label: string
  modality: 'text' | 'image' | 'video'
  supportsReferences: boolean
  supportsPolling: boolean
  parameters: ModelParameterSchema
}
```

Initial providers:

- `byteplus`: current working implementation.
- `openai-compatible`: simplest validation target for text generation.
- `custom-http`: advanced user-defined endpoint later.

## Phased Plan

### Phase 1 - Personal Workbench Foundation

Target: make the app useful for daily personal creation.

Scope:

- Add local project workspace directory setting.
- Persist project metadata outside browser storage.
- Save generated outputs to local project folders.
- Add local asset library indexing.
- Keep current BytePlus provider working as default.
- Keep cloud storage optional.

Expected result:

- The user can create, revisit, and organize work locally.
- Browser storage is no longer the main long-term record.

Risk:

- File system permissions and cross-platform path handling.

### Phase 2 - Storage Provider Abstraction

Target: make reference-media upload independent from BytePlus TOS.

Scope:

- Add `StorageProvider` abstraction.
- Keep BytePlus TOS as one implementation.
- Add S3-compatible implementation.
- Add local-only asset records.
- Add URL-only reference media mode.

Expected result:

- The user can use local storage for organization and cloud storage only when remote models need file access.

Risk:

- Signed URL expiration and provider-specific CORS rules.

### Phase 3 - Model Provider Registry

Target: move BytePlus from core logic to provider plugin.

Scope:

- Add provider registry.
- Move BytePlus text/image/video definitions into `providers/byteplus`.
- Make credential drawer schema provider-driven.
- Make model selection capability-driven.
- Keep current route structure unchanged.

Expected result:

- Pages call generic adapters.
- BytePlus remains the default provider but no longer defines the product architecture.

Risk:

- Adapters must preserve current payload behavior for existing BytePlus flows.

### Phase 4 - OpenAI-Compatible Text Provider

Target: prove multi-provider architecture with low risk.

Scope:

- Add OpenAI-compatible text generation provider.
- Support API key, base URL, and model.
- Support streaming where compatible.
- Add provider-specific tests.

Expected result:

- Users can connect text models from multiple vendors that expose OpenAI-compatible APIs.

Risk:

- Streaming formats and error shapes differ between providers.

### Phase 5 - Image Provider Expansion

Target: support non-BytePlus image models.

Scope:

- Add image adapter contract.
- Normalize generated-image result records.
- Support URL and base64 result handling.
- Add per-model parameter schema.

Expected result:

- Users can switch image providers without changing workflow.

Risk:

- Reference image handling differs widely.

### Phase 6 - Video Provider Expansion

Target: support multiple video providers.

Scope:

- Add video adapter contract.
- Normalize async task creation, polling, cancellation, and result download.
- Normalize reference media requirements.
- Add provider capability warnings in UI.

Expected result:

- Users can evaluate multiple video models from one workbench.

Risk:

- Video APIs are inconsistent and costly to test.

### Phase 7 - Productization

Target: turn the workbench into a stronger productivity product.

Scope:

- Local project search.
- Tags, collections, favorites.
- Prompt/version history.
- Run comparison.
- Cost tracking per provider/model.
- Batch generation queues.
- Optional server-side credential vault for private deployment.

Expected result:

- DGen becomes a real creation operating surface, not only a demo UI.

Risk:

- Scope creep. Keep personal use first, SaaS later.

## Recommended Next Implementation Step

Start with Phase 1.

Concrete first task:

- Add a local workspace setting and define the project file schema.
- Keep all existing API behavior unchanged.
- Continue using browser storage for active session state only.
- Store durable project state in local files or SQLite.

This gives immediate productivity value without committing too early to every future provider.

## Decision Principles

- Do not force object storage for text or simple image generation.
- Do not force vendor asset libraries for personal workflows.
- Do not hard-code provider-specific fields into shared UI.
- Keep BytePlus working while extracting it into a provider.
- Prefer one stable adapter interface over many page-level conditional branches.
- Add providers in order of lowest risk: text first, image second, video last.
