import { getAssetInfo, type AssetResponseDto } from '@immich/sdk';
import type { ZoomImageWheelState } from '@zoom-image/core';
import { cubicOut } from 'svelte/easing';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type { ImageLoaderStatus } from '$lib/utils/adaptive-image-loader.svelte';
import { canCopyImageToClipboard } from '$lib/utils/asset-utils';
import { BaseEventManager } from '$lib/utils/base-event-manager.svelte';
import type { AssetGridRouteSearchParams } from '$lib/utils/navigation';
import { PersistedLocalStorage } from '$lib/utils/persisted';

export interface Faces {
  id: string;
  imageHeight: number;
  imageWidth: number;
  boundingBoxX1: number;
  boundingBoxX2: number;
  boundingBoxY1: number;
  boundingBoxY2: number;
}

const isShowDetailPanel = new PersistedLocalStorage<boolean>('asset-viewer-state', false);
const isShowAssetPath = new PersistedLocalStorage<boolean>('asset-viewer-show-path', false);

const createDefaultZoomState = (): ZoomImageWheelState => ({
  currentRotation: 0,
  currentZoom: 1,
  enable: true,
  currentPositionX: 0,
  currentPositionY: 0,
});

export type Events = {
  Zoom: [];
  ZoomChange: [ZoomImageWheelState];
  Copy: [];
  FaceEditModeChange: [boolean];
};

class AssetViewerManager extends BaseEventManager<Events> {
  #zoomState = $state(createDefaultZoomState());
  #animationFrameId: number | null = null;

  imgRef = $state<HTMLImageElement | undefined>();
  videoPlayer = $state<HTMLVideoElement | undefined>();
  imageLoaderStatus = $state<ImageLoaderStatus | undefined>();
  #isImageLoading = $derived.by(() => {
    const quality = this.imageLoaderStatus?.quality;
    if (!quality || this.imageLoaderStatus?.hasError) {
      return false;
    }
    const previewOrOriginalReady = quality.preview === 'success' || quality.original === 'success';
    const loadingOriginal = this.zoom > 1 && quality.original !== 'success';
    return !previewOrOriginalReady || loadingOriginal;
  });
  isShowActivityPanel = $state(false);
  isPlayingMotionPhoto = $state(false);
  isShowEditor = $state(false);
  #isFaceEditMode = $state(false);
  #isPeopleEditMode = $state(false);
  #viewingAssetStoreState = $state<AssetResponseDto>();
  #viewState = $state<boolean>(false);
  #highlightedFaces = $state<Faces[]>([]);
  // Separate from #highlightedFaces (which is also driven by photo-hover previews): a video
  // bounding box is only valid at the exact timestamp it was detected on, so it must only ever
  // be set alongside an explicit seek-and-pause to that same face's timestamp, never on hover.
  #confirmedFaceBox = $state<{ face: Faces; timestampMs: number } | undefined>();
  #showingHiddenPeople = $state(false);
  gridScrollTarget = $state<AssetGridRouteSearchParams | null | undefined>();

  get asset() {
    return this.#viewingAssetStoreState;
  }

  get isViewing() {
    return this.#viewState;
  }

  get isImageLoading() {
    return this.#isImageLoading;
  }

  get isShowDetailPanel() {
    return isShowDetailPanel.current;
  }

  get isShowAssetPath() {
    return isShowAssetPath.current;
  }

  get isFaceEditMode() {
    return this.#isFaceEditMode;
  }

  get isPeopleEditMode() {
    return this.#isPeopleEditMode;
  }

  get zoomState() {
    return this.#zoomState;
  }

  set zoomState(state: ZoomImageWheelState) {
    this.#zoomState = state;
    this.emit('ZoomChange', state);
  }

  get zoom() {
    return this.#zoomState.currentZoom;
  }

  set zoom(zoom: number) {
    this.cancelZoomAnimation();
    this.zoomState = { ...this.zoomState, currentZoom: zoom };
  }

  canZoomIn() {
    return this.hasListeners('Zoom') && this.zoom <= 1;
  }

  canZoomOut() {
    return this.hasListeners('Zoom') && this.zoom > 1;
  }

  canCopyImage() {
    return canCopyImageToClipboard() && !!assetViewerManager.imgRef;
  }

  private set isShowDetailPanel(value: boolean) {
    isShowDetailPanel.current = value;
  }

  private set isShowAssetPath(value: boolean) {
    isShowAssetPath.current = value;
  }

  onZoomChange(state: ZoomImageWheelState) {
    // bypass event emitter to avoid loop
    this.#zoomState = state;
  }

  cancelZoomAnimation() {
    if (this.#animationFrameId !== null) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
  }

  animatedZoom(targetZoom: number, duration = 300) {
    this.cancelZoomAnimation();

    const startZoom = this.#zoomState.currentZoom;
    const startTime = performance.now();

    const frame = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const linearProgress = Math.min(elapsed / duration, 1);
      const easedProgress = cubicOut(linearProgress);
      const interpolatedZoom = startZoom + (targetZoom - startZoom) * easedProgress;

      this.zoomState = { ...this.#zoomState, currentZoom: interpolatedZoom };

      this.#animationFrameId = linearProgress < 1 ? requestAnimationFrame(frame) : null;
    };

    this.#animationFrameId = requestAnimationFrame(frame);
  }

  resetZoomState() {
    this.cancelZoomAnimation();
    this.zoomState = createDefaultZoomState();
  }

  toggleActivityPanel() {
    this.closeDetailPanel();
    this.isShowActivityPanel = !this.isShowActivityPanel;
  }

  closeActivityPanel() {
    this.isShowActivityPanel = false;
  }

  toggleAssetPath() {
    this.isShowAssetPath = !this.isShowAssetPath;
  }

  toggleDetailPanel() {
    this.closeActivityPanel();
    this.isShowDetailPanel = !this.isShowDetailPanel;
  }

  closeDetailPanel() {
    this.isShowDetailPanel = false;
  }

  openEditor() {
    this.closeActivityPanel();
    this.isShowEditor = true;
  }

  closeEditor() {
    this.isShowEditor = false;
  }

  toggleFaceEditMode() {
    this.#isFaceEditMode = !this.#isFaceEditMode;
    this.emit('FaceEditModeChange', this.#isFaceEditMode);
  }

  closeFaceEditMode() {
    if (this.#isFaceEditMode) {
      this.emit('FaceEditModeChange', false);
    }
    this.#isFaceEditMode = false;
  }

  togglePeopleEditMode() {
    this.#isPeopleEditMode = !this.#isPeopleEditMode;
    if (!this.#isPeopleEditMode) {
      this.clearConfirmedFaceBox();
    }
  }

  closePeopleEditMode() {
    this.#isPeopleEditMode = false;
    this.clearConfirmedFaceBox();
  }

  resetPanelState() {
    this.closeEditor();
    this.closeFaceEditMode();
    this.closePeopleEditMode();
  }

  get highlightedFaces() {
    return this.#highlightedFaces;
  }

  setHighlightedFaces(faces: Faces[]) {
    this.#highlightedFaces = faces;
  }

  clearHighlightedFaces() {
    this.#highlightedFaces = [];
  }

  get isShowingHiddenPeople() {
    return this.#showingHiddenPeople;
  }

  toggleHiddenPeople() {
    this.#showingHiddenPeople = !this.#showingHiddenPeople;
  }

  hideHiddenPeople() {
    this.#showingHiddenPeople = false;
  }

  seekVideoTo(ms: number) {
    const video = this.videoPlayer;
    if (!video) {
      return;
    }
    video.currentTime = ms / 1000;
    if (video.paused) {
      void video.play().catch(() => {});
    }
  }

  get confirmedFaceBox() {
    return this.#confirmedFaceBox;
  }

  #cancelPendingSeek?: () => void;

  // True while confirmFaceAtTimestamp's own seek is in flight, so VideoNativeViewer's
  // "user scrubbed away manually" listener can tell that seek apart from a real manual scrub
  // and not cancel it out from under us.
  get hasPendingConfirmSeek() {
    return this.#cancelPendingSeek !== undefined;
  }

  // Seeks to and pauses on the exact frame a face was detected on, and records that face so its
  // bounding box can be drawn -- used to let a user visually confirm which face they're about to
  // act on before reassigning/deleting it, rather than guessing from a timestamp label alone.
  //
  // Seeking is asynchronous, so the box is only shown once the 'seeked' event confirms the target
  // frame has actually decoded -- otherwise it briefly overlays whatever frame was on screen
  // before the seek, which is exactly the wrong info for a confirmation UI to show.
  confirmFaceAtTimestamp(face: Faces, timestampMs: number) {
    const video = this.videoPlayer;
    if (!video) {
      return;
    }

    this.#cancelPendingSeek?.();
    this.#cancelPendingSeek = undefined;
    video.pause();

    if (Math.abs(video.currentTime * 1000 - timestampMs) < 50) {
      this.#confirmedFaceBox = { face, timestampMs };
      return;
    }

    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      this.#cancelPendingSeek = undefined;
      this.#confirmedFaceBox = { face, timestampMs };
    };
    video.addEventListener('seeked', onSeeked);
    this.#cancelPendingSeek = () => video.removeEventListener('seeked', onSeeked);
    video.currentTime = timestampMs / 1000;
  }

  clearConfirmedFaceBox() {
    this.#cancelPendingSeek?.();
    this.#cancelPendingSeek = undefined;
    this.#confirmedFaceBox = undefined;
  }

  setAsset(asset: AssetResponseDto) {
    this.#viewingAssetStoreState = asset;
    this.#viewState = true;
  }

  async setAssetId(id: string): Promise<AssetResponseDto> {
    const asset = await getAssetInfo({ ...authManager.params, id });
    this.setAsset(asset);
    return asset;
  }

  showAssetViewer(show: boolean) {
    this.#viewState = show;
  }
}

export const assetViewerManager = new AssetViewerManager();
