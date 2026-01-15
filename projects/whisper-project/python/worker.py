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
    
    model = whisperx.load_model(model_name, device, compute_type=compute_type)
    
    log("Loading alignment model...")
    model_a, metadata = whisperx.load_align_model(language_code="en", device=device)

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
            
            # Allow overriding batch_size and compute_type per request if needed, 
            # though model reload is expensive. For now just use them if provided 
            # and they match current load.
            req_batch_size = data.get("batch_size", batch_size)
            
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
            
            result = model.transcribe(audio, batch_size=req_batch_size)
            
            # 2. Align
            log("Aligning...")
            result = whisperx.align(result["segments"], model_a, metadata, audio, device, return_char_alignments=False)
            
            # 3. Save artifacts
            base_name = os.path.basename(audio_path).rsplit('.', 1)[0]
            
            # Save JSON
            json_path = os.path.join(output_dir, f"{base_name}.json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            # Save TXT (Simple)
            txt_path = os.path.join(output_dir, f"{base_name}.txt")
            with open(txt_path, "w", encoding="utf-8") as f:
                for segment in result["segments"]:
                    f.write(f"[{segment['start']:.2f} -> {segment['end']:.2f}] {segment['text']}\n")

            log(f"Finished: {audio_path}")
            print(json.dumps({"id": file_id, "status": "completed", "artifacts": [json_path, txt_path]}), flush=True)
            
            # Cleanup VRAM
            gc.collect()
            torch.cuda.empty_cache()

        except Exception as e:
            log(f"Error: {str(e)}")
            print(json.dumps({"id": file_id, "status": "error", "message": str(e)}), flush=True)

if __name__ == "__main__":
    main()
