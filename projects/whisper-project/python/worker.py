import sys
import json
import os
import warnings

# Suppress common warnings from dependencies
warnings.filterwarnings('ignore', category=UserWarning)
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', category=DeprecationWarning)
warnings.filterwarnings('ignore', message='.*torchaudio.*deprecated.*')
warnings.filterwarnings('ignore', message='.*TensorFloat-32.*')
warnings.filterwarnings('ignore', message='.*pyannote.audio.*')
warnings.filterwarnings('ignore', message='.*Lightning automatically upgraded.*')
warnings.filterwarnings('ignore', message='.*Model was trained with.*')

# Suppress PyTorch Lightning upgrade messages
import os as _os
_os.environ['PL_DISABLE_VERSION_CHECK'] = '1'

import torch
import lightning_fabric.utilities.cloud_io as cloud_io

# Targeted patch for lightning_fabric to force weights_only=False
# This is required for PyTorch 2.6+ compatibility with pyannote models.
_original_pl_load = cloud_io._load
def _patched_pl_load(*args, **kwargs):
    kwargs['weights_only'] = False
    return _original_pl_load(*args, **kwargs)
cloud_io._load = _patched_pl_load

import whisperx
import gc
import logging
from whisperx.utils import get_writer
from whisperx.diarize import DiarizationPipeline, assign_word_speakers

# Suppress verbose logging from whisperx and pyannote
logging.getLogger('whisperx').setLevel(logging.WARNING)
logging.getLogger('pyannote').setLevel(logging.WARNING)
logging.getLogger('lightning_fabric').setLevel(logging.ERROR)

def log(msg):
    print(f"LOG: {msg}", file=sys.stderr, flush=True)

def main():
    device = "cuda"
    
    # Load model on startup with defaults, but will re-read for each file if needed?
    # Actually, let's load it once with config from the first line or env.
    log(f"Loading WhisperX model (large-v3) on {device}...")
    
    # Defaults
    model_name = "large-v3"
    compute_type = "float16"
    batch_size = 16
    output_format = "all"

    model = whisperx.load_model(model_name, device, compute_type=compute_type)

    log("Loading alignment model...")
    align_language = "en"
    model_a, metadata = whisperx.load_align_model(language_code=align_language, device=device)

    diarize_model = None
    diarize_model_name = None
    diarize_token = None

    writer_options = {
        "highlight_words": False,
        "max_line_count": None,
        "max_line_width": None,
    }

    log("Worker ready. Waiting for input (JSON)...")
    
    for line in sys.stdin:
        file_id = None
        try:
            line = line.strip()
            if not line:
                continue
                
            data = json.loads(line)
            audio_path = data.get("audio_path")
            output_dir = data.get("output_dir")
            file_id = data.get("id")
            req_model_name = data.get("model_name", model_name)
            req_compute_type = data.get("compute_type", compute_type)
            req_output_format = data.get("output_format", output_format)
            req_language = data.get("language")

            enable_diarization = bool(data.get("enable_diarization", False))
            hf_token = data.get("hf_token")
            min_speakers = data.get("min_speakers")
            max_speakers = data.get("max_speakers")
            req_diarize_model = data.get("diarize_model", "pyannote/speaker-diarization-community-1")
            
            # Allow overriding batch_size and compute_type per request if needed, 
            # though model reload is expensive. For now just use them if provided 
            # and they match current load.
            req_batch_size = data.get("batch_size", batch_size)

            if req_model_name != model_name or req_compute_type != compute_type:
                log(f"Reloading WhisperX model ({req_model_name}) with compute_type={req_compute_type}...")
                model = whisperx.load_model(req_model_name, device, compute_type=req_compute_type)
                model_name = req_model_name
                compute_type = req_compute_type
            
            if not audio_path or not os.path.exists(audio_path):
                print(json.dumps({"id": file_id, "status": "error", "message": f"File not found: {audio_path}"}), flush=True)
                continue

            log(f"Processing: {audio_path} (batch_size={req_batch_size})")
            
            # 1. Transcribe
            audio = whisperx.load_audio(audio_path)
            duration = len(audio) / 16000 # Whisper audio is 16kHz
            
            # WhisperX doesn't have a direct callback for progress per segment in the .transcribe call easily,
            # but we can log that we are starting.
            log(f"Audio duration: {duration:.2f}s")

            transcribe_kwargs = {"batch_size": req_batch_size}
            if req_language:
                transcribe_kwargs["language"] = req_language

            result = model.transcribe(audio, **transcribe_kwargs)

            # 2. Align
            log("Aligning...")
            detected_language = result.get("language") or req_language or "en"
            if detected_language != align_language:
                log(f"Loading alignment model for language: {detected_language}")
                model_a, metadata = whisperx.load_align_model(language_code=detected_language, device=device)
                align_language = detected_language

            result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)

            # 3. Diarize (optional)
            if enable_diarization:
                if not hf_token:
                    raise RuntimeError("ENABLE_DIARIZATION is true, but no Hugging Face token was provided.")

                if (
                    diarize_model is None
                    or diarize_model_name != req_diarize_model
                    or diarize_token != hf_token
                ):
                    log(f"Loading diarization model: {req_diarize_model}")
                    diarize_model = DiarizationPipeline(model_name=req_diarize_model, token=hf_token, device=device)
                    diarize_model_name = req_diarize_model
                    diarize_token = hf_token

                log("Diarizing...")
                diarize_segments = diarize_model(
                    audio_path,
                    min_speakers=min_speakers,
                    max_speakers=max_speakers,
                )
                result = assign_word_speakers(diarize_segments, result)

            # 4. Save artifacts
            base_name = os.path.basename(audio_path).rsplit('.', 1)[0]

            writer = get_writer(req_output_format, output_dir)
            result["language"] = detected_language
            writer(result, audio_path, writer_options)

            if req_output_format == "all":
                extensions = [".json", ".srt", ".vtt", ".txt", ".tsv"]
            else:
                extensions = [f".{req_output_format}"]

            artifacts = [os.path.join(output_dir, f"{base_name}{ext}") for ext in extensions]

            log(f"Finished: {audio_path}")
            print(json.dumps({"id": file_id, "status": "completed", "artifacts": artifacts}), flush=True)

            # Cleanup VRAM
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        except Exception as e:
            log(f"Error: {str(e)}")
            print(json.dumps({"id": file_id, "status": "error", "message": str(e)}), flush=True)

if __name__ == "__main__":
    main()
