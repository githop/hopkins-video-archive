{{- define "gnarlyvllm.resourceName" -}}
{{- . | replace "." "-" -}}
{{- end -}}

{{- define "gnarlyvllm.modelArgs" -}}
- {{ .repo | quote }}
- "--port"
- {{ .port | quote }}
- "--host"
- "0.0.0.0"
{{- if .enforce_eager }}
- "--enforce-eager"
{{- end }}
{{- if eq .task "embed" }}
- "--runner"
- "pooling"
- "--convert"
- "embed"
{{- end }}
{{- if eq .task "score" }}
- "--runner"
- "pooling"
- "--convert"
- "classify"
{{- end }}
{{- if .gpu_memory_utilization }}
- "--gpu-memory-utilization"
- {{ .gpu_memory_utilization | quote }}
{{- end }}
{{- if .max_model_len }}
- "--max-model-len"
- {{ .max_model_len | quote }}
{{- end }}
{{- if .quantization }}
- "--quantization"
- {{ .quantization | quote }}
{{- end }}
{{- if .performance_mode }}
- "--performance-mode"
- {{ .performance_mode | quote }}
{{- end }}
{{- if .kv_cache_dtype }}
- "--kv-cache-dtype"
- {{ .kv_cache_dtype | quote }}
{{- end }}
- "--trust-remote-code"
{{- if .enable_tool_calling }}
- "--enable-auto-tool-choice"
{{- end }}
{{- if .tool_call_parser }}
- "--tool-call-parser"
- {{ .tool_call_parser | quote }}
{{- end }}
{{- if .reasoning_parser }}
- "--reasoning-parser"
- {{ .reasoning_parser | quote }}
{{- end }}
{{- if .tokenizer }}
- "--tokenizer"
- {{ .tokenizer | quote }}
{{- end }}
{{- if .hf_config_path }}
- "--hf-config-path"
- {{ .hf_config_path | quote }}
{{- end }}
{{- if .enable_expert_parallel }}
- "--enable-expert-parallel"
{{- end }}
{{- if .swap_space }}
- "--swap-space"
- {{ .swap_space | quote }}
{{- end }}
{{- if .max_seq_len_to_capture }}
- "--max-seq-len-to-capture"
- {{ .max_seq_len_to_capture | quote }}
{{- end }}
{{- if .max_num_seqs }}
- "--max-num-seqs"
- {{ .max_num_seqs | quote }}
{{- end }}
{{- if .max_num_batched_tokens }}
- "--max-num-batched-tokens"
- {{ .max_num_batched_tokens | quote }}
{{- end }}
{{- if .num_scheduler_steps }}
- "--num-scheduler-steps"
- {{ .num_scheduler_steps | quote }}
{{- end }}
{{- if .tensor_parallel_size }}
- "--tensor-parallel-size"
- {{ .tensor_parallel_size | quote }}
{{- end }}
{{- if .speculative_config }}
- "--speculative-config"
- {{ .speculative_config | quote }}
{{- end }}
{{- if .language_model_only }}
- "--language-model-only"
{{- end }}
{{- if .default_chat_template_kwargs }}
- "--default-chat-template-kwargs"
- {{ .default_chat_template_kwargs | quote }}
{{- end }}
{{- if .chat_template }}
- "--chat-template"
- "/app/custom_chat_template.jinja"
{{- end }}
{{- if .enable_prefix_caching }}
- "--enable-prefix-caching"
{{- end }}
{{- if .hf_overrides }}
- "--hf-overrides"
- {{ .hf_overrides | quote }}
{{- end }}
{{- if .generation_config }}
- "--generation-config"
- {{ .generation_config | quote }}
{{- end }}
{{- if .override_generation_config }}
- "--override-generation-config"
- {{ toJson .override_generation_config | quote }}
{{- end }}
{{- end -}}

{{- define "gnarlyvllm.proxyRoutes" -}}
{{- $routes := dict -}}
{{- $namespace := .Release.Namespace -}}
{{- range $name, $model := .Values.models -}}
  {{- $host := printf "vllm-%s.%s.svc.cluster.local" (include "gnarlyvllm.resourceName" $name) $namespace -}}
  {{- $_ := set $routes $name (dict
    "port" $model.port
    "task" $model.task
    "repo" $model.repo
    "host" $host
  ) -}}
{{- end -}}
{{- $routes | toJson -}}
{{- end -}}
