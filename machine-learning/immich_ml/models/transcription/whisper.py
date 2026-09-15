import os
import shutil
from io import BytesIO
from pathlib import Path
from typing import Any

from huggingface_hub import snapshot_download

from immich_ml.config import log, settings
from immich_ml.models.base import InferenceModel
from immich_ml.models.constants import WHISPER_MODELS
from immich_ml.schemas import ModelFormat, ModelSession, ModelTask, ModelType


class WhisperTranscriber(InferenceModel):
    """Speech to text with faster-whisper, used to generate video subtitles.

    Unlike the other models this isn't an ONNX session: CTranslate2 owns the whole decode loop,
    including Whisper's built-in language detection and its translate-to-English task.
    """

    depends = []
    identity = (ModelType.RECOGNITION, ModelTask.TRANSCRIPTION)

    def __init__(self, model_name: str, **model_kwargs: Any) -> None:
        self.task = "translate"
        self.beam_size = 5
        # The format only picks file extensions for ONNX/ARMNN/RKNN sessions, none of which apply
        # here; pinning it stops the base class probing for accelerator runtimes.
        super().__init__(model_name, **model_kwargs, model_format=ModelFormat.ONNX)

    @property
    def model_path(self) -> Path:
        return self.model_dir / "model.bin"

    def _download(self) -> None:
        source = WHISPER_MODELS[self.model_name]
        staging = self.cache_dir / "download"
        snapshot_download(
            source["repo"],
            revision=source["revision"],
            allow_patterns=[f"{source['subfolder']}/*"],
            local_dir=staging,
        )
        self.model_dir.mkdir(parents=True, exist_ok=True)
        for file in (staging / source["subfolder"]).iterdir():
            shutil.move(str(file), self.model_dir / file.name)
        shutil.rmtree(staging, ignore_errors=True)

    def _load(self) -> ModelSession:
        # Imported lazily: faster-whisper is only installed in the CPU image, and importing CTranslate2
        # up front would slow every other model's startup for a feature that may well be switched off.
        from faster_whisper import WhisperModel

        threads = settings.model_intra_op_threads or os.cpu_count() or 4
        log.info(f"Using {threads} CPU threads for transcription model '{self.model_name}'")
        self.model = WhisperModel(str(self.model_dir), device="auto", compute_type="default", cpu_threads=threads)
        return self.model  # type: ignore[no-any-return]

    def configure(self, **kwargs: Any) -> None:
        self.task = kwargs.get("task", self.task)
        self.beam_size = int(kwargs.get("beamSize", self.beam_size))

    def _predict(self, audio: bytes, **kwargs: Any) -> dict[str, Any]:
        # language=None makes Whisper detect it per request. Each request is one chunk of a video, so a
        # video that switches language partway through is still detected chunk by chunk.
        segments, info = self.model.transcribe(
            BytesIO(audio),
            task=self.task,
            language=None,
            beam_size=self.beam_size,
            # Skips silence and music-only stretches, which Whisper otherwise tends to fill with invented
            # text. The VAD model ships inside faster-whisper itself, so this needs no download.
            vad_filter=True,
            # Per-word times let the server end each subtitle when its last word is spoken. Segment end
            # times alone often run on through the silence that follows, leaving a line up far too long.
            word_timestamps=True,
        )
        results = []
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            words = [{"start": word.start, "end": word.end, "word": word.word} for word in segment.words or []]
            results.append({"start": segment.start, "end": segment.end, "text": text, "words": words})
        return {
            "language": info.language,
            "languageProbability": info.language_probability,
            "segments": results,
        }
