import { AssetTypeEnum } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import DetailPanelTranscript from './DetailPanelTranscript.svelte';

describe('DetailPanelTranscript', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('lists what was said with timestamps, and plays from a line when it is clicked', async () => {
    const user = userEvent.setup();
    const seek = vi.spyOn(assetViewerManager, 'seekVideoTo').mockImplementation(() => {});
    sdkMock.getAssetTranscript.mockResolvedValue([
      { startMs: 1500, endMs: 3000, text: 'Hello there.' },
      { startMs: 3_725_000, endMs: 3_727_000, text: 'An hour in.' },
    ]);

    render(DetailPanelTranscript, { asset: assetFactory.build({ id: 'video-1', type: AssetTypeEnum.Video }) });

    expect(await screen.findByText('Hello there.')).toBeInTheDocument();
    expect(screen.getByText('0:01')).toBeInTheDocument();
    expect(screen.getByText('1:02:05')).toBeInTheDocument();
    expect(sdkMock.getAssetTranscript).toHaveBeenCalledWith(expect.objectContaining({ id: 'video-1' }));

    await user.click(screen.getByText('An hour in.'));
    expect(seek).toHaveBeenCalledWith(3_725_000);
  });

  it('shows nothing for a video with no transcript', async () => {
    sdkMock.getAssetTranscript.mockResolvedValue([]);

    render(DetailPanelTranscript, { asset: assetFactory.build({ type: AssetTypeEnum.Video }) });

    await waitFor(() => expect(sdkMock.getAssetTranscript).toHaveBeenCalled());
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('does not look for a transcript on a photo', () => {
    render(DetailPanelTranscript, { asset: assetFactory.build({ type: AssetTypeEnum.Image }) });

    expect(sdkMock.getAssetTranscript).not.toHaveBeenCalled();
  });

  it("does not show the previous video's transcript after moving to another video", async () => {
    let resolveFirst: (lines: { startMs: number; endMs: number; text: string }[]) => void = () => {};
    sdkMock.getAssetTranscript
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([{ startMs: 0, endMs: 1000, text: 'Second video.' }]);

    const { rerender } = render(DetailPanelTranscript, {
      asset: assetFactory.build({ id: 'video-1', type: AssetTypeEnum.Video }),
    });
    await rerender({ asset: assetFactory.build({ id: 'video-2', type: AssetTypeEnum.Video }) });
    expect(await screen.findByText('Second video.')).toBeInTheDocument();

    resolveFirst([{ startMs: 0, endMs: 1000, text: 'First video.' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('First video.')).not.toBeInTheDocument();
  });
});
